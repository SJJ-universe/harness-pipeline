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
const { assertLocalExecutorAllowed } = require("../src/policy/publicSectorPolicy");

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
    const { timeoutMs, cwd, onChild, explicitConfirmation = false, profileId } = opts;
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
          // -p: print mode (non-interactive, exits after one response)
          // --dangerously-skip-permissions: allow tool use without prompting
          //    (no tools are actually invoked — the prompts we send are
          //    planning-only and do not ask Claude to touch the filesystem)
          const args = [
            ...spec.argsPrefix,
            "-p",
            "--bare",
            prompt,
          ];
          if (process.env.HARNESS_ALLOW_DANGEROUS_AGENT === "1" && explicitConfirmation) {
            args.splice(args.length - 1, 0, "--dangerously-skip-permissions");
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

          let child;
          try {
            child = spawn(resolveCommand(spec.cmd), args, {
              stdio: ["ignore", "pipe", "pipe"],
              windowsHide: true,
              cwd: cwd || process.cwd(),
              shell: false,
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

          if (typeof onChild === "function") onChild(child);

          const out = [];
          const errChunks = [];
          let settled = false;

          const timer = setTimeout(() => {
            if (settled) return;
            try { child.kill(); } catch (_) {}
          }, timeoutMs || this.defaultTimeoutMs);

          child.stdout.on("data", (c) => out.push(c));
          child.stderr.on("data", (c) => errChunks.push(c));

          child.on("error", (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
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
            clearTimeout(timer);
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
