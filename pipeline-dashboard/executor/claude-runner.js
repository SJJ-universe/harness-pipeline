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

class ClaudeRunner {
  constructor({ claudeCommand = "claude", fallbackCommands, defaultTimeoutMs = 180000 } = {}) {
    this.claudeCommand = claudeCommand;
    this.fallbackCommands = fallbackCommands || [
      { cmd: "claude", argsPrefix: [] },
      { cmd: "npx", argsPrefix: ["@anthropic-ai/claude-code"] },
    ];
    this.defaultTimeoutMs = defaultTimeoutMs;
    this._resolvedSpec = null;
  }

  async exec(prompt, opts = {}) {
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
  }

  _tryExec(spec, prompt, { timeoutMs, cwd, onChild } = {}) {
    return new Promise((resolve) => {
      // P0-3: prompt is written to stdin instead of passed as a CLI arg.
      // With `shell: true` on Windows, an argv-embedded prompt would be
      // re-tokenized by cmd.exe — any prompt containing backticks, `$()`,
      // `&&`, quotes, or newlines becomes a shell injection surface.
      // CodexRunner already uses this stdin pattern; mirror it exactly.
      //
      // Flags kept as argv (fixed strings under our control):
      //   --bare  skip hooks/memory/auto-discovery (no recursion)
      //   -p      print mode (non-interactive, reads stdin, exits once)
      //   --dangerously-skip-permissions  allow tool use without prompt
      const baseArgs = [
        ...spec.argsPrefix,
        "-p",
        "--bare",
        "--dangerously-skip-permissions",
      ];
      // P1-5: Node 24 DEP0190 — passing an args array together with
      // `shell: true` is deprecated because the shell re-concatenates and
      // re-tokenizes them without escaping. On Windows we still need shell
      // resolution so `claude.cmd`/`codex.cmd` hit PATHEXT, so invoke
      // `cmd.exe /c` explicitly with `shell: false`. Our argv contains only
      // fixed flags (prompt is on stdin, see P0-3), so cmd.exe's re-parse
      // is safe.
      const isWin = process.platform === "win32";
      const spawnCmd = isWin ? "cmd.exe" : spec.cmd;
      const spawnArgs = isWin ? ["/c", spec.cmd, ...baseArgs] : baseArgs;
      let child;
      try {
        child = spawn(spawnCmd, spawnArgs, {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          cwd: cwd || process.cwd(),
          env: process.env,
        });
      } catch (err) {
        const f = this._failure(`spawn failed (${spec.cmd}): ${err.message}`);
        f._enoent = /ENOENT/i.test(err.message);
        return resolve(f);
      }

      if (typeof onChild === "function") onChild(child);

      // Write prompt via stdin and close. Errors here are non-fatal: if the
      // child already exited (e.g. ENOENT before stdin is ready) we let the
      // close handler report the real reason.
      try {
        child.stdin.on("error", () => {});
        child.stdin.write(prompt);
        child.stdin.end();
      } catch (_) {
        // swallow — close/error handlers below resolve the promise
      }

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
        resolve({
          ok: code === 0,
          exitCode: code,
          stdout,
          stderr,
          text: stdout.trim(),
          _enoent: enoentLike,
        });
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
