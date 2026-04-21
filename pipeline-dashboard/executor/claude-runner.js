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

  _tryExec(spec, prompt, { timeoutMs, cwd, onChild, explicitConfirmation = false } = {}) {
    return new Promise((resolve) => {
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
      const runId = this.runRegistry?.start({
        kind: "claude",
        input: { prompt },
        policyDecision,
      });
      let child;
      try {
        child = spawn(resolveCommand(spec.cmd), args, {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          cwd: cwd || process.cwd(),
          shell: false,
          env: process.env,
        });
      } catch (err) {
        const f = this._failure(`spawn failed (${spec.cmd}): ${err.message}`);
        f._enoent = /ENOENT/i.test(err.message);
        if (runId) this.runRegistry?.complete(runId, f);
        return resolve(f);
      }

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
        const f = this._failure(`spawn error (${spec.cmd}): ${err.message}`);
        f._enoent = /ENOENT/i.test(err.message);
        if (runId) this.runRegistry?.complete(runId, f);
        resolve(f);
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
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
