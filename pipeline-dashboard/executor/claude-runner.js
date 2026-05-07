// ClaudeRunner — invokes `claude -p --bare <prompt>` as a subprocess.
// Mirrors the CodexRunner interface so PipelineExecutor can drive Claude-side
// planning/refinement the same way it drives Codex-side critique.
//
// --bare strips hooks/memory/auto-discovery so this call does NOT re-enter
// the harness and can't trigger recursion via Claude Code's own PreToolUse
// hooks. Still uses OAuth token from the environment for auth.
//
// ENOENT fallback: tries `claude`, then `npx @anthropic-ai/claude-code`.

const { spawn } = require("child_process");
const dangerGate = require("../src/policy/dangerGate");
const { filterSensitiveEnv } = require("../src/security/envFilter");
// Slice D1-d (Phase E1, 2026-04-29): profileSpawn composes P0-base
// env + profile-scoped credentials. The runner activates this layer
// when both profileStore and credentialStore are wired into the
// constructor; otherwise it falls back to the P0 base behavior
// shipped pre-D1 (no breaking change for existing callers).
const { buildSpawnEnv } = require("../src/runtime/profileSpawn");
// D1-d defense-in-depth (per docs/public-sector-hardening-plan.md
// §6 Task 2 Step 4): assertLocalExecutorAllowed fires from the
// runner itself, NOT just from profileSpawn. If a future refactor
// bypasses profileSpawn (e.g. a hot-path optimization that builds
// the env inline), the policy still gates the spawn.
const { resolveDeploymentProfile } = require("../src/policy/deploymentProfile");
const {
  assertLocalExecutorAllowed,
  POLICY_BLOCK_CODES,
} = require("../src/policy/publicSectorPolicy");
// Slice GOV-PII-0 (Phase E1.5, 2026-04-29): inline PII gate runs
// AFTER spawn env is built but BEFORE the actual spawn(). Public-
// sector mode refuses the spawn when the prompt contains PII;
// standard mode emits a warn-level audit but proceeds. The gate is
// a pure decision function — the runner owns the audit emit + the
// failure resolve.
const { enforcePiiGate } = require("../src/security/piiGate");
// Slice RR0-b (Phase 2 / RELEASE-READY-0, 2026-05-05): activity-based
// watchdog. Mirror of CodexRunner.
const { createActivityWatchdog } = require("../src/runtime/activityWatchdog");

function resolveCommand(cmd) {
  if (process.platform !== "win32") return cmd;
  if (/\.(cmd|bat|exe)$/i.test(cmd)) return cmd;
  if (cmd === "npx" || cmd === "npm" || cmd === "claude") return `${cmd}.cmd`;
  return cmd;
}

class ClaudeRunner {
  constructor({
    claudeCommand = "claude",
    fallbackCommands,
    defaultTimeoutMs = 180000,
    runRegistry,
    repoRoot,
    // Slice RR0-b: optional broadcast for claude_idle_warning /
    // claude_killed_for_idle WS events. When absent (legacy callers /
    // tests), the watchdog runs silently — kill behavior preserved
    // exactly via child.kill().
    broadcast,
    // Slice N (v6): shared child-process semaphore. Optional — when absent
    // the runner behaves as before.
    childSemaphore = null,
    // Slice S3 (Phase 3-S): lifecycle registry so server.js can killAll()
    // every active spawn during graceful shutdown. Optional for unit tests
    // that don't exercise real child processes.
    childRegistry = null,
    // Slice D1-d (Phase E1, 2026-04-29): profile + credential layer.
    // BOTH must be wired together for profileSpawn to engage. When
    // either is null, the runner falls back to P0 base only (the
    // pre-D1 single-user behavior). This lets server.js (or a test
    // harness) opt INTO profile-aware spawning without breaking
    // every existing test that constructs ClaudeRunner with the
    // old arg shape.
    profileStore = null,
    credentialStore = null,
    // EvidenceLedger handle for emitting profile_spawn_env_built
    // entries on successful profile-mode spawn. Optional — no audit
    // emitted when absent.
    ledger = null,
    // Slice UI-H7-d (Phase D / Phase E1.5, 2026-04-30): review-session
    // manager handle. When wired AND opts.reviewSessionId is provided,
    // exec() pipes stdout chunks to manager.recordClaudeChunk() and
    // emits manager.recordClaudeReceived() on close. When either is
    // absent, the runner behaves as before (no review-session events).
    // The hint flow: dashboard click → route handler → spawn hint →
    // manager updates state + WS broadcasts → store + dual-agent-console.
    reviewSessionManager = null,
    // Slice RR0-b (Phase 2 / RELEASE-READY-0, 2026-05-05): mirror of
    // CodexRunner — activity-based watchdog. When idleTimeoutMs is
    // set, _tryExec() uses activityWatchdog instead of the legacy
    // single-setTimeout. Each stdout/stderr chunk resets the idle
    // timer so a long Claude patch streaming output doesn't get
    // killed at defaultTimeoutMs while it's actively producing
    // changes. Total cap is still enforced.
    //
    // When idleTimeoutMs is null/missing (default), _tryExec()
    // preserves pre-RR0-b single-timer behavior verbatim.
    idleTimeoutMs = null,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    clockFn = () => Date.now(),
  } = {}) {
    this.claudeCommand = claudeCommand;
    this.fallbackCommands = fallbackCommands || [
      { cmd: "claude", argsPrefix: [] },
      { cmd: "npx", argsPrefix: ["@anthropic-ai/claude-code"] },
    ];
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.runRegistry = runRegistry || null;
    this.repoRoot = repoRoot || process.cwd();
    this.childSemaphore = childSemaphore;
    this.childRegistry = childRegistry;
    this.profileStore = profileStore;
    this.credentialStore = credentialStore;
    this.ledger = ledger;
    this.reviewSessionManager = reviewSessionManager;
    // Slice RR0-b: optional broadcast — present in production (server.js
    // wires it), absent in legacy unit tests. Optional chaining at the
    // emit sites keeps both paths safe.
    this.broadcast = broadcast || null;
    // Slice RR0-b: idle-based watchdog config (mirrors CodexRunner).
    this.idleTimeoutMs = (typeof idleTimeoutMs === "number" && idleTimeoutMs > 0)
      ? idleTimeoutMs : null;
    this._setTimeoutFn = setTimeoutFn;
    this._clearTimeoutFn = clearTimeoutFn;
    this._clockFn = clockFn;
    this._resolvedSpec = null;
  }

  async exec(prompt, opts = {}) {
    // Slice N (v6): acquire one slot before spawning. See CodexRunner.exec
    // for the guarantee: try/finally ensures release even on synchronous
    // throw inside _tryExec.
    let release = null;
    if (this.childSemaphore) {
      release = await this.childSemaphore.acquire({
        label: "claude",
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
      return lastFailure || this._failure("no claude launcher available");
    } finally {
      if (release) release();
    }
  }

  _tryExec(spec, prompt, opts = {}) {
    const {
      timeoutMs, cwd, onChild, explicitConfirmation = false, profileId,
      // UI-H7-d: optional review-session hint. When present and the
      // runner has a reviewSessionManager wired, stdout chunks pipe
      // to manager.recordClaudeChunk(reviewSessionId, {text}) and
      // close emits manager.recordClaudeReceived(reviewSessionId,
      // {summary}). All wrapped in try/catch — never break the spawn.
      reviewSessionId = null,
    } = opts;
    return new Promise((resolve) => {
      // Slice D1-d (Phase E1, 2026-04-29): wrap the body in an async
      // IIFE so we can `await buildSpawnEnv(...)` between dangerGate
      // and spawn(). Errors from buildSpawnEnv (missing credential,
      // public-sector block, deleted profile) resolve with a structured
      // failure — same shape as a dangerGate block — so callers don't
      // have to distinguish "policy block" from "env build failure"
      // beyond the error message.
      (async () => {
        try {
          // --bare: skip hooks, memory, auto-discovery
          // -p: print mode (non-interactive, exits after one response).
          //     With no positional argument, claude reads the prompt
          //     from stdin — matches CodexRunner pattern.
          // --dangerously-skip-permissions: allow tool use without prompting
          //    (no tools are actually invoked — the prompts we send are
          //    planning-only and do not ask Claude to touch the filesystem)
          //
          // AGENT-DESKTOP-0-shellfix2 (2026-05-07): prompt is fed via
          // stdin (NOT positional). Why: on Windows we set shell:true so
          // that .cmd shims are launchable (CVE-2024-27980 mitigation in
          // Node 20.12+/22+/24). With shell:true, args are concatenated
          // into a single command line and NOT escaped (DEP0190 deprec.
          // warning) — any user prompt containing cmd.exe metachars (
          // `(`, `)`, `&`, `|`, `^`, `>`, `<`, `"`, etc.) gets mis-
          // parsed by cmd.exe and the planner fails with exitCode=1
          // and a tiny stdout. The user surfaced this with a Korean
          // task containing `(하네스 엔진)` — the parens crashed the
          // command line. Codex runner has used the stdin pattern since
          // v6 (executor/codex-runner.js:326-330); Claude is now aligned.
          const args = [
            ...spec.argsPrefix,
            "-p",
            "--bare",
          ];
          if (process.env.HARNESS_ALLOW_DANGEROUS_AGENT === "1" && explicitConfirmation) {
            args.push("--dangerously-skip-permissions");
          }
          const policyDecision = dangerGate.evaluate({
            type: "agent-run",
            cmd: spec.cmd,
            args,
            cwd,
            repoRoot: this.repoRoot,
            explicitConfirmation,
          });
          if (policyDecision.decision === "block") {
            return resolve(this._failure(policyDecision.reason));
          }

          // Slice D1-d defense-in-depth: enforce public-sector policy
          // here in addition to inside profileSpawn. A future refactor
          // that bypasses profileSpawn (e.g. a hot-path optimization
          // that builds env inline) still gets caught.
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
              // Pre-D1 fallback: P0 base only. Same env as before D1
              // shipped — keeps tests + single-user installs working
              // without forcing a "must select a profile" change.
              spawnEnv = filterSensitiveEnv(process.env);
            }
          } catch (err) {
            // Public-sector block, missing credential, deleted profile,
            // etc. all funnel through here. Error code (when set by
            // policy) propagates onto the failure result so the caller
            // can map to an HTTP status if needed.
            const f = this._failure(`spawn env build failed: ${err.message}`);
            if (err.code) f.code = err.code;
            // Slice GOV-SB-0 (Phase E1.5, 2026-04-29): audit row when
            // public-sector policy refused the spawn. The reason
            // distinguishes "local-executor surface gated" from
            // "wrong workspace mode for this profile" so an operator
            // triaging the deny can fix the right thing. Audit data
            // stays small + free of secret material — `profileId` and
            // a stable `reason` code only.
            if (this.ledger && err.code && POLICY_BLOCK_CODES.has(err.code)) {
              try {
                this.ledger.append("system", {
                  type: "local_executor_blocked",
                  data: {
                    runner: "claude",
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
            kind: "claude",
            input: { prompt },
            policyDecision,
          });

          // D1-d: emit profile_spawn_env_built audit when profile
          // mode is active (spawnEnvMeta is non-null + has a profileId).
          // No audit on the P0 fallback path — there's nothing
          // profile-specific to record there.
          if (spawnEnvMeta && spawnEnvMeta.profileId && this.ledger) {
            try {
              this.ledger.append("system", {
                type: "profile_spawn_env_built",
                data: {
                  profileId: spawnEnvMeta.profileId,
                  workspacePath: spawnEnvMeta.workspacePath,
                  secretsInjected: spawnEnvMeta.secretsInjected,
                  runner: "claude",
                  runId: runId || null,
                },
              });
            } catch (_) { /* best-effort */ }
          }

          // Slice GOV-PII-0: refuse the local provider dispatch when
          // the prompt contains PII under public-sector posture.
          // Standard mode emits a warn-level audit but proceeds.
          // The gate is a pure function; the runner emits the audit
          // row + resolves the failure.
          const piiVerdict = enforcePiiGate(prompt, {
            deploymentProfile: resolveDeploymentProfile(),
            source: "claude_prompt",
          });
          if (this.ledger && piiVerdict.auditVerb) {
            try {
              this.ledger.append(runId || "system", {
                type: piiVerdict.auditVerb,
                data: {
                  runner: "claude",
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
            // Run-registry housekeeping: we created a runId for this
            // attempt but never spawned. Mark it complete with the
            // failure so the registry doesn't leak.
            if (runId) this.runRegistry?.complete(runId, f);
            return resolve(f);
          }

          let child;
          try {
            child = spawn(resolveCommand(spec.cmd), args, {
              // AGENT-DESKTOP-0-shellfix2 (2026-05-07): stdin is now
              // "pipe" (was "ignore"). The prompt rides stdin instead
              // of being concatenated into the command line — see the
              // long comment above the args[] construction for the
              // full reasoning. Mirrors codex-runner.js:307.
              stdio: ["pipe", "pipe", "pipe"],
              windowsHide: true,
              cwd: cwd || process.cwd(),
              // Windows + Node 20.12+/22+: spawning .cmd/.bat without
              // shell:true returns `spawn EINVAL` (CVE-2024-27980
              // mitigation). `claude` on Windows is `claude.cmd` (npm
              // shim at AppData/Roaming/npm/claude.cmd) — without this
              // flag the planner phase fails immediately with
              // exitCode=null, textLen=0. Codex runner has had this
              // since v6 (executor/codex-runner.js:310); Claude runner
              // missed the parity until AGENT-DESKTOP-0 surfaced it
              // in a pilot console trace. Posix path (shell:false)
              // unchanged — the bug is Windows-specific.
              shell: process.platform === "win32",
              env: spawnEnv,
            });
          } catch (err) {
            const f = this._failure(`spawn failed (${spec.cmd}): ${err.message}`);
            f._enoent = /ENOENT/i.test(err.message);
            if (runId) this.runRegistry?.complete(runId, f);
            return resolve(f);
          }

          // Slice S3 (Phase 3-S): track this spawn in the lifecycle registry
          // so graceful shutdown can SIGTERM/SIGKILL it. Unregister fires from
          // the close/error handlers below — both code paths covered.
          this.childRegistry?.register(child, { label: "claude", runId });

          // AGENT-DESKTOP-0-shellfix2 (2026-05-07): write prompt via stdin
          // and close. Wrapped in try/catch so a stdin-error doesn't
          // crash the runner — the close handler will still report the
          // real exit reason.
          try {
            child.stdin.on("error", () => {});
            child.stdin.write(prompt);
            child.stdin.end();
          } catch (_) { /* close handler reports real reason */ }

          if (typeof onChild === "function") onChild(child);

          const out = [];
          const errChunks = [];
          let settled = false;

          // Slice RR0-b: activity-based watchdog branch. See codex-runner
          // for the parallel implementation; same precedence + fallback
          // contract.
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
                  this.broadcast?.({
                    type: "claude_idle_warning",
                    data: { runId, ...info },
                  });
                } catch (_) {}
              },
              onKill: ({ reason, msSinceLastTick, totalElapsedMs }) => {
                if (settled) return;
                try {
                  this.broadcast?.({
                    type: "claude_killed_for_idle",
                    data: { runId, reason, msSinceLastTick, totalElapsedMs },
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
          // pipe each chunk to recordClaudeChunk. Defensive try/catch
          // so a manager-side bug never breaks the spawn.
          const _hasReviewHint =
            reviewSessionId
            && this.reviewSessionManager
            && typeof this.reviewSessionManager.recordClaudeChunk === "function";
          child.stdout.on("data", (c) => {
            // Slice RR0-b: activity tick on every stdout chunk.
            if (watchdog) watchdog.tick();
            out.push(c);
            if (_hasReviewHint) {
              try {
                this.reviewSessionManager.recordClaudeChunk(
                  reviewSessionId, { text: c.toString("utf-8") },
                );
              } catch (_) { /* never break spawn on manager fault */ }
            }
          });
          child.stderr.on("data", (c) => {
            // Slice RR0-b: activity tick on stderr too.
            if (watchdog) watchdog.tick();
            errChunks.push(c);
          });

          child.on("error", (err) => {
            if (settled) return;
            settled = true;
            _disposeWatchdogOrTimer();
            // S3: drop registry entry so killAll on shutdown does not
            // SIGTERM an already-dead reference.
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
            // S3: same as the error path — child is gone, registry no longer
            // needs to track it.
            this.childRegistry?.unregister(child);
            const stdout = Buffer.concat(out).toString("utf-8");
            const stderr = Buffer.concat(errChunks).toString("utf-8");
            const enoentLike =
              code !== 0 &&
              /(is not recognized|command not found|ENOENT|not found|'claude'|no such file)/i.test(
                stderr + stdout
              ) &&
              stdout.length < 2000;
            const result = {
              ok: code === 0,
              exitCode: code,
              stdout,
              stderr,
              text: stdout.trim(),
              _enoent: enoentLike,
            };
            // UI-H7-d: emit recordClaudeReceived only on successful close,
            // and only when the review-session hint flow is active. The
            // summary mirrors the trimmed text up to MAX_SUMMARY_LENGTH
            // (manager truncates internally). Defensive try/catch so a
            // manager-side bug never breaks the result resolution.
            if (
              code === 0
              && reviewSessionId
              && this.reviewSessionManager
              && typeof this.reviewSessionManager.recordClaudeReceived === "function"
            ) {
              try {
                this.reviewSessionManager.recordClaudeReceived(
                  reviewSessionId,
                  { summary: result.text.slice(0, 1024) },
                );
              } catch (_) { /* never break result on manager fault */ }
            }
            if (runId) this.runRegistry?.complete(runId, result);
            resolve(result);
          });
        } catch (err) {
          // D1-d: catch-all for any unexpected throw inside the async
          // IIFE. Without this, a programming error inside the await
          // chain becomes an unhandled rejection (no `reject` is exposed
          // by the outer Promise constructor). Resolving with a failure
          // keeps the caller's contract simple — every _tryExec call
          // resolves with either a success or a failure shape.
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
      text: "",
      error: reason,
      _enoent: false,
    };
  }
}

module.exports = { ClaudeRunner };
