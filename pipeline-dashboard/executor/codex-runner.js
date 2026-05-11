// CodexRunner — invokes `codex exec --full-auto` as a subprocess
// and parses its output into a critique structure.
//
// Features:
//   - Real-time output streaming via codex_progress broadcasts (live + bounded)
//   - Bounded final buffers (1MB stdout / 256KB stderr) with truncated flag
//   - Secret redaction on all broadcasts (HARNESS_TOKEN, sk-*, ghp_*, etc.)
//   - DI-friendly: spawnImpl + broadcast + redact overrideable for tests
//
// Output contract (enforced via prompt, parsed heuristically):
//   - Findings as bullet lines: "- [critical|high|medium|low] <message>"
//   - Final section "## Summary" containing a short verdict

const { spawn } = require("child_process");
const dangerGate = require("../src/policy/dangerGate");
const { filterSensitiveEnv } = require("../src/security/envFilter");
// Slice D1-d (Phase E1, 2026-04-29): same profileSpawn integration
// pattern as ClaudeRunner. See claude-runner.js for the full
// rationale; mirror summary here for grep-friendliness.
const { buildSpawnEnv } = require("../src/runtime/profileSpawn");
const { resolveDeploymentProfile } = require("../src/policy/deploymentProfile");
const {
  assertLocalExecutorAllowed,
  POLICY_BLOCK_CODES,
} = require("../src/policy/publicSectorPolicy");
// Slice GOV-PII-0 (Phase E1.5, 2026-04-29): mirror of ClaudeRunner.
// PII gate fires after env is built and before the codex stdin
// write. See claude-runner.js for the full design rationale.
const { enforcePiiGate } = require("../src/security/piiGate");
// Slice RR0-b (Phase 2 / RELEASE-READY-0, 2026-05-05): activity-based
// watchdog. Two-timer model — total cap + idle reset on stdout/stderr.
const { createActivityWatchdog, KILL_REASONS: WATCHDOG_KILL_REASONS } = require("../src/runtime/activityWatchdog");

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{20,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /gho_[A-Za-z0-9]{20,}/g,
  /xoxb-[A-Za-z0-9-]{20,}/g,
  /xoxp-[A-Za-z0-9-]{20,}/g,
  /HARNESS_TOKEN[=:]\s*["']?[A-Za-z0-9_-]+["']?/gi,
  /Authorization:\s*Bearer\s+[A-Za-z0-9._-]+/gi,
];

function defaultRedact(text) {
  let out = String(text);
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[REDACTED]");
  return out;
}

function resolveCommand(cmd) {
  if (process.platform !== "win32") return cmd;
  if (/\.(cmd|bat|exe)$/i.test(cmd)) return cmd;
  if (cmd === "npx" || cmd === "npm" || cmd === "codex") return `${cmd}.cmd`;
  return cmd;
}

class CodexRunner {
  constructor({
    codexCommand = "codex",
    fallbackCommands,
    defaultTimeoutMs = 120000,
    runRegistry,
    repoRoot,
    broadcast = () => {},
    spawnImpl = spawn,
    maxLiveBytes = 2000,
    maxFinalStdoutBytes = 1024 * 1024, // 1MB
    maxFinalStderrBytes = 256 * 1024,  // 256KB
    redact = defaultRedact,
    flushIntervalMs = 500,
    flushBytes = 4096,
    // Slice N (v6): shared child-process semaphore. Optional for backward
    // compatibility with existing tests that instantiate CodexRunner bare.
    childSemaphore = null,
    // Slice S3 (Phase 3-S): lifecycle registry — server.js graceful shutdown
    // calls registry.killAll('SIGTERM') so long-running codex critiques
    // (often 120s+) get a chance to wind down instead of orphaning.
    childRegistry = null,
    // Slice D1-d (Phase E1, 2026-04-29): profile + credential layer.
    // BOTH must be wired together for profileSpawn to engage.
    profileStore = null,
    credentialStore = null,
    // Audit handle for emitting profile_spawn_env_built when profile-
    // mode is active.
    ledger = null,
    // Slice UI-H7-d (Phase D / Phase E1.5, 2026-04-30): review-session
    // manager handle. When wired AND opts.reviewSessionId is provided,
    // exec() pipes stdout chunks to manager.recordCodexChunk() and
    // emits manager.recordCritiqueReceived() on close. Same pattern as
    // ClaudeRunner — see executor/claude-runner.js for the full
    // rationale. When either is absent, the runner behaves as before.
    reviewSessionManager = null,
    // Slice RR0-b (Phase 2 / RELEASE-READY-0, 2026-05-05): activity-
    // based watchdog injection. When idleTimeoutMs is set, exec() uses
    // activityWatchdog instead of the legacy single-setTimeout. Each
    // stdout/stderr chunk resets the idle timer so a long-but-streaming
    // Codex critique stays alive past defaultTimeoutMs as long as
    // output keeps flowing. Total cap is still enforced by the
    // watchdog's totalTimeoutMs.
    //
    // When idleTimeoutMs is null/missing (default), exec() preserves
    // pre-RR0-b single-timer behavior verbatim — backward compat for
    // every existing test + caller.
    //
    // setTimeoutFn / clearTimeoutFn / clockFn match activityWatchdog's
    // injection seam so tests can use a fake clock.
    idleTimeoutMs = null,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    clockFn = () => Date.now(),
  } = {}) {
    this.codexCommand = codexCommand;
    this.fallbackCommands = fallbackCommands || [
      { cmd: "codex", argsPrefix: [] },
      { cmd: "npx", argsPrefix: ["@openai/codex"] },
      { cmd: "npx", argsPrefix: ["-y", "@openai/codex"] },
    ];
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.runRegistry = runRegistry || null;
    this.repoRoot = repoRoot || process.cwd();
    this.broadcast = broadcast;
    this.spawn = spawnImpl;
    this.maxLiveBytes = maxLiveBytes;
    this.maxFinalStdoutBytes = maxFinalStdoutBytes;
    this.maxFinalStderrBytes = maxFinalStderrBytes;
    this.redact = redact;
    this.flushIntervalMs = flushIntervalMs;
    this.flushBytes = flushBytes;
    this.childSemaphore = childSemaphore;
    this.childRegistry = childRegistry;
    this.profileStore = profileStore;
    this.credentialStore = credentialStore;
    this.ledger = ledger;
    this.reviewSessionManager = reviewSessionManager;
    // Slice RR0-b: idle-based watchdog config. Null disables; positive
    // ms enables.
    this.idleTimeoutMs = (typeof idleTimeoutMs === "number" && idleTimeoutMs > 0)
      ? idleTimeoutMs : null;
    this._setTimeoutFn = setTimeoutFn;
    this._clearTimeoutFn = clearTimeoutFn;
    this._clockFn = clockFn;
    this._resolvedSpec = null;
  }

  async exec(prompt, opts = {}) {
    // Slice N (v6): acquire one child-process slot before spawning. If the
    // semaphore is absent (legacy tests) behavior is unchanged. Release is
    // guaranteed via try/finally even if _tryExec throws synchronously.
    let release = null;
    if (this.childSemaphore) {
      release = await this.childSemaphore.acquire({
        label: "codex",
        timeoutMs: opts.queueTimeoutMs,
      });
    }
    try {
      const specs = this._resolvedSpec ? [this._resolvedSpec] : this.fallbackCommands;
      let lastFailure = null;
      for (const spec of specs) {
        const result = await this._tryExec(spec, prompt, opts);
        if (result.ok || !result._enoent) {
          if (result.ok && !this._resolvedSpec) this._resolvedSpec = spec;
          return result;
        }
        lastFailure = result;
      }
      return lastFailure || this._failure("no codex launcher available");
    } finally {
      if (release) release();
    }
  }

  _tryExec(spec, prompt, opts = {}) {
    const {
      timeoutMs, cwd, phaseId = null, iteration = 0,
      source = "phase", profileId,
      // UI-H7-d: optional review-session hint. When present and the
      // runner has a reviewSessionManager wired, stdout chunks pipe
      // to manager.recordCodexChunk(reviewSessionId, {text}) and
      // close emits manager.recordCritiqueReceived(reviewSessionId,
      // {summary}). All wrapped in try/catch — never break the spawn.
      reviewSessionId = null,
      // PLS-0-followup (2026-05-08): optional ORCHESTRATION runId.
      // When set, the codex_progress broadcast uses THIS as data.runId
      // instead of the runner's internal runRegistry id. The product
      // shell's bridge keys synthetic streaming sessions on data.runId,
      // and the orchestration layer (generalPipelineRunner) needs them
      // to share a key with its other lifecycle events (pipeline_start,
      // phase_update, etc.) so harness-track + monitor-grid pick up the
      // same run. Without this, the bridge synthesizes one session per
      // codex invocation (codex-XXX) that's disconnected from the
      // orchestration run (gr-XXX), and the live tail card can't
      // attach to the active run. The internal runRegistry id is
      // unchanged — it stays the audit / lifecycle id for this codex
      // invocation specifically.
      broadcastRunId = null,
    } = opts;
    return new Promise((resolve) => {
      // Slice D1-d (Phase E1, 2026-04-29): wrap the body in an async
      // IIFE so we can `await buildSpawnEnv(...)` between dangerGate
      // and spawn(). Same pattern as ClaudeRunner; see claude-runner.js
      // for the full design rationale. The outer try/catch catches any
      // unexpected throw inside the async chain and resolves with a
      // structured failure (the Promise constructor exposes no
      // `reject`).
      (async () => {
        try {
          const args = [...spec.argsPrefix, "exec", "--full-auto", "--skip-git-repo-check"];
          const policyDecision = dangerGate.evaluate({
            type: "agent-run",
            cmd: spec.cmd,
            args,
            cwd,
            repoRoot: this.repoRoot,
          });
          if (policyDecision.decision === "block") {
            return resolve(this._failure(policyDecision.reason));
          }

          // Slice D1-d defense-in-depth: enforce public-sector policy
          // here in addition to inside profileSpawn. If a future refactor
          // bypasses profileSpawn, this catches it.
          let spawnEnv;
          let spawnEnvMeta = null;
          try {
            assertLocalExecutorAllowed(resolveDeploymentProfile());
            if (this.profileStore && this.credentialStore) {
              const resolvedProfileId = profileId || this.profileStore.getActiveId();
              const built = await buildSpawnEnv({
                parentEnv: process.env,
                profileId: resolvedProfileId,
                profileStore: this.profileStore,
                credentialStore: this.credentialStore,
              });
              spawnEnv = built.env;
              spawnEnvMeta = built;
            } else {
              spawnEnv = filterSensitiveEnv(process.env);
            }
          } catch (err) {
            const f = this._failure(`spawn env build failed: ${err.message}`);
            if (err.code) f.code = err.code;
            // Slice GOV-SB-0 (Phase E1.5, 2026-04-29): mirror of the
            // ClaudeRunner audit emit — public-sector policy block
            // turns into a stable `local_executor_blocked` ledger row
            // so the auditor evidence path can read deny-by-policy
            // events the same way for both runners.
            if (this.ledger && err.code && POLICY_BLOCK_CODES.has(err.code)) {
              try {
                this.ledger.append("system", {
                  type: "local_executor_blocked",
                  data: {
                    runner: "codex",
                    reason: err.code,
                    profileId: profileId
                      || (this.profileStore && this.profileStore.getActiveId()
                        ? this.profileStore.getActiveId()
                        : null),
                    policyMode: "public-sector",
                  },
                });
              } catch (_) { /* best-effort */ }
            }
            return resolve(f);
          }

          const runId = this.runRegistry?.start({
            kind: "codex",
            input: { prompt },
            policyDecision,
          });
          const startedAt = Date.now();

          // D1-d: emit profile_spawn_env_built audit when in profile mode.
          if (spawnEnvMeta && spawnEnvMeta.profileId && this.ledger) {
            try {
              this.ledger.append("system", {
                type: "profile_spawn_env_built",
                data: {
                  profileId: spawnEnvMeta.profileId,
                  workspacePath: spawnEnvMeta.workspacePath,
                  secretsInjected: spawnEnvMeta.secretsInjected,
                  runner: "codex",
                  runId: runId || null,
                },
              });
            } catch (_) { /* best-effort */ }
          }

          // Slice GOV-PII-0: same gate as ClaudeRunner. Public-sector
          // refuses the spawn when the prompt contains PII; standard
          // mode emits a warn-level audit but proceeds.
          const piiVerdict = enforcePiiGate(prompt, {
            deploymentProfile: resolveDeploymentProfile(),
            source: "codex_prompt",
          });
          if (this.ledger && piiVerdict.auditVerb) {
            try {
              this.ledger.append(runId || "system", {
                type: piiVerdict.auditVerb,
                data: {
                  runner: "codex",
                  runId: runId || null,
                  ...piiVerdict.auditData,
                },
              });
            } catch (_) { /* best-effort */ }
          }
          if (!piiVerdict.ok) {
            const f = this._failure(
              `blocked by PII scanner: types=${piiVerdict.scan.findings.map((x) => x.type).join(",")}`,
            );
            f.code = "PII_SCAN_BLOCKED";
            if (runId) this.runRegistry?.complete(runId, f);
            return resolve(f);
          }

          let child;
          try {
            child = this.spawn(resolveCommand(spec.cmd), args, {
              stdio: ["pipe", "pipe", "pipe"],
              windowsHide: true,
              cwd: cwd || process.cwd(),
              shell: process.platform === "win32",
              env: spawnEnv,
            });
          } catch (err) {
            const f = this._failure(`spawn failed (${spec.cmd}): ${err.message}`);
            f._enoent = /ENOENT/i.test(err.message);
            if (runId) this.runRegistry?.complete(runId, f);
            return resolve(f);
          }

          // Slice S3 (Phase 3-S): track this codex spawn so server.js graceful
          // shutdown can SIGTERM/SIGKILL it. Codex calls live up to 120s, so
          // without this an Electron / dashboard close would orphan them.
          this.childRegistry?.register(child, { label: "codex", runId });

          // Write prompt via stdin and close
          try {
            child.stdin.on("error", () => {});
            child.stdin.write(prompt);
            child.stdin.end();
          } catch (_) { /* close handler reports real reason */ }

          // Final (bounded) buffers
          const out = [];
          const errChunks = [];
          let finalOutBytes = 0;
          let finalErrBytes = 0;
          let stdoutTruncated = false;
          let stderrTruncated = false;
          // Live streaming buffers (cleared on each flush)
          let liveOut = "";
          let liveErr = "";
          let flushTimer = null;
          let settled = false;

          const flush = () => {
            if (!liveOut && !liveErr) return;
            const stdoutPayload = liveOut ? this.redact(liveOut).slice(-this.maxLiveBytes) : "";
            const stderrPayload = liveErr ? this.redact(liveErr).slice(-this.maxLiveBytes) : "";
            const stream = liveOut && liveErr ? "mixed" : liveErr ? "stderr" : "stdout";
            try {
              this.broadcast({
                type: "codex_progress",
                data: {
                  // PLS-0-followup: prefer the orchestration runId so
                  // the dashboard groups this stream with the same run
                  // it shows in harness-track. Fall back to the inner
                  // runRegistry id when there's no orchestration layer
                  // (legacy / direct-codex callers).
                  runId: broadcastRunId || runId,
                  phase: phaseId,
                  iteration,
                  source,
                  stdout: stdoutPayload,
                  stderr: stderrPayload,
                  stream,
                  truncated: stdoutTruncated || stderrTruncated,
                  elapsedMs: Date.now() - startedAt,
                },
              });
            } catch (_) { /* broadcast errors must not break codex execution */ }
            liveOut = "";
            liveErr = "";
          };

          const scheduleFlush = () => {
            if (flushTimer) return;
            flushTimer = setTimeout(() => { flushTimer = null; flush(); }, this.flushIntervalMs);
          };

          // Slice RR0-b: activity-based watchdog when idleTimeoutMs is
          // configured; legacy single-timer otherwise. The watchdog
          // path tick()s on each stdout/stderr chunk (handlers below)
          // and only kills when the child has been silent for
          // idleTimeoutMs OR the total cap fires.
          const totalTimeout = timeoutMs || this.defaultTimeoutMs;
          let watchdog = null;
          let timer = null;
          if (this.idleTimeoutMs && this.idleTimeoutMs < totalTimeout) {
            watchdog = createActivityWatchdog({
              totalTimeoutMs: totalTimeout,
              idleTimeoutMs: this.idleTimeoutMs,
              onIdleWarning: (info) => {
                if (settled) return;
                try {
                  this.broadcast({
                    type: "codex_idle_warning",
                    data: { runId, phase: phaseId, iteration, ...info },
                  });
                } catch (_) {}
              },
              onKill: ({ reason, msSinceLastTick, totalElapsedMs }) => {
                if (settled) return;
                try {
                  this.broadcast({
                    type: "codex_killed_for_idle",
                    data: {
                      runId, phase: phaseId, iteration,
                      reason, msSinceLastTick, totalElapsedMs,
                    },
                  });
                } catch (_) {}
                try { child.kill(); } catch (_) {}
              },
              clockFn: this._clockFn,
              setTimeoutFn: this._setTimeoutFn,
              clearTimeoutFn: this._clearTimeoutFn,
            });
            watchdog.start();
          } else {
            timer = setTimeout(() => {
              if (settled) return;
              try { child.kill(); } catch (_) {}
            }, totalTimeout);
          }
          const _disposeWatchdogOrTimer = () => {
            if (watchdog) {
              try { watchdog.clear(); } catch (_) {}
            } else if (timer) {
              clearTimeout(timer);
            }
          };

          // UI-H7-d: when both reviewSessionId + manager are present,
          // pipe each chunk to recordCodexChunk. Defensive try/catch
          // so a manager-side bug never breaks the spawn.
          const _hasReviewHint =
            reviewSessionId
            && this.reviewSessionManager
            && typeof this.reviewSessionManager.recordCodexChunk === "function";

          child.stdout.on("data", (chunk) => {
            // Slice RR0-b: activity tick — resets watchdog idle timer
            // when configured. No-op when watchdog isn't engaged.
            if (watchdog) watchdog.tick();
            const text = chunk.toString();
            if (finalOutBytes < this.maxFinalStdoutBytes) {
              out.push(chunk);
              finalOutBytes += chunk.length;
              if (finalOutBytes >= this.maxFinalStdoutBytes) stdoutTruncated = true;
            } else {
              stdoutTruncated = true;
            }
            liveOut += text;
            if (liveOut.length + liveErr.length >= this.flushBytes) flush();
            else scheduleFlush();
            if (_hasReviewHint) {
              try {
                this.reviewSessionManager.recordCodexChunk(
                  reviewSessionId, { text },
                );
              } catch (_) { /* never break spawn on manager fault */ }
            }
          });

          child.stderr.on("data", (chunk) => {
            // Slice RR0-b: activity tick on stderr too — Codex emits
            // progress on stderr in some scenarios.
            if (watchdog) watchdog.tick();
            const text = chunk.toString();
            if (finalErrBytes < this.maxFinalStderrBytes) {
              errChunks.push(chunk);
              finalErrBytes += chunk.length;
              if (finalErrBytes >= this.maxFinalStderrBytes) stderrTruncated = true;
            } else {
              stderrTruncated = true;
            }
            liveErr += text;
            if (liveOut.length + liveErr.length >= this.flushBytes) flush();
            else scheduleFlush();
          });

          child.on("error", (err) => {
            if (settled) return;
            settled = true;
            _disposeWatchdogOrTimer();
            if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
            // S3: drop registry entry — child is gone, no SIGTERM needed.
            this.childRegistry?.unregister(child);
            const f = this._failure(`spawn error (${spec.cmd}): ${err.message}`);
            f._enoent = /ENOENT/i.test(err.message);
            if (runId) this.runRegistry?.complete(runId, f);
            resolve(f);
          });

          child.on("close", (code) => {
            if (settled) return;
            settled = true;
            _disposeWatchdogOrTimer();
            if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
            // S3: codex completed normally — registry no longer tracks this child.
            this.childRegistry?.unregister(child);
            flush(); // final live flush
            const rawStdout = Buffer.concat(out).toString("utf-8");
            const rawStderr = Buffer.concat(errChunks).toString("utf-8");
            const stdout = this.redact(rawStdout);
            const stderr = this.redact(rawStderr);
            const enoentLike =
              code !== 0 &&
              /(is not recognized|command not found|ENOENT|not found|'codex'|no such file)/i.test(
                stderr + stdout
              ) && (stdout.length < 2000);
            const result = {
              ok: code === 0,
              exitCode: code,
              stdout,
              stderr,
              stdoutTruncated,
              stderrTruncated,
              summary: this._extractSummary(stdout),
              findings: this._extractFindings(stdout),
              _enoent: enoentLike,
            };
            // UI-H7-d: emit recordCritiqueReceived only on successful close,
            // and only when the review-session hint flow is active. The
            // codex runner already extracts summary + findings via
            // _extractSummary / _extractFindings — pass them through so
            // the manager's severityCounts mirror the CLI critique parser.
            // Defensive try/catch so a manager-side bug never breaks the
            // result resolution.
            if (
              code === 0
              && reviewSessionId
              && this.reviewSessionManager
              && typeof this.reviewSessionManager.recordCritiqueReceived === "function"
            ) {
              try {
                this.reviewSessionManager.recordCritiqueReceived(
                  reviewSessionId,
                  {
                    summary: result.summary || stdout.slice(0, 1024),
                    severityCounts: _severityCountsFromFindings(result.findings),
                  },
                );
              } catch (_) { /* never break result on manager fault */ }
            }
            if (runId) this.runRegistry?.complete(runId, result);
            resolve(result);
          });
        } catch (err) {
          // D1-d: catch-all for unexpected throws inside the async IIFE.
          resolve(this._failure(`unexpected error: ${err.message}`));
        }
      })();
    });
  }

  _failure(reason) {
    return {
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: reason,
      stdoutTruncated: false,
      stderrTruncated: false,
      summary: "",
      findings: [],
      error: reason,
      _enoent: false,
    };
  }

  _extractSummary(stdout) {
    if (!stdout) return "";
    const m = stdout.match(/##\s*Summary\s*\n([\s\S]*?)(?=\n##|\n*$)/i);
    if (m) return m[1].trim();
    return stdout.slice(-400).trim();
  }

  _extractFindings(stdout) {
    if (!stdout) return [];
    const findings = [];
    const re = /^\s*[-*]\s*\[(critical|high|medium|low)\]\s*(.+)$/gim;
    let m;
    while ((m = re.exec(stdout)) !== null) {
      findings.push({ severity: m[1].toLowerCase(), message: m[2].trim() });
    }
    return findings;
  }
}

// UI-H7-d helper: convert _extractFindings output into the
// severityCounts shape the reviewSessionManager expects:
//   { critical, high, medium, low, note }
// "note" is always 0 here — _extractFindings doesn't recognize it
// (the regex only matches critical|high|medium|low), but the manager
// stores it for consistency with other producers.
function _severityCountsFromFindings(findings) {
  const out = { critical: 0, high: 0, medium: 0, low: 0, note: 0 };
  if (!Array.isArray(findings)) return out;
  for (const f of findings) {
    if (f && typeof f.severity === "string"
        && Object.prototype.hasOwnProperty.call(out, f.severity)) {
      out[f.severity]++;
    }
  }
  return out;
}

module.exports = {
  CodexRunner,
  defaultRedact,
  SECRET_PATTERNS,
  // UI-H7-d test export
  _severityCountsFromFindings,
};
