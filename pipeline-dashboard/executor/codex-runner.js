// CodexRunner — invokes `codex exec --full-auto` as a subprocess
// and parses its output into a critique structure.
//
// Output contract (enforced via prompt, parsed heuristically):
//   - Findings as bullet lines: "- [critical|high|medium|low] <message>"
//   - Final section "## Summary" containing a short verdict
//
// Parse failures are non-fatal — raw stdout is always preserved.

const { spawn } = require("child_process");

class CodexRunner {
  constructor({ codexCommand = "codex", fallbackCommands, defaultTimeoutMs = 120000 } = {}) {
    this.codexCommand = codexCommand;
    // On ENOENT, try these alternative launch specs in order.
    // Each entry is { cmd, argsPrefix }. The runtime appends
    // ["exec", "--full-auto", "--skip-git-repo-check", prompt].
    this.fallbackCommands = fallbackCommands || [
      { cmd: "codex", argsPrefix: [] },
      { cmd: "npx", argsPrefix: ["@openai/codex"] },
      { cmd: "npx", argsPrefix: ["-y", "@openai/codex"] },
    ];
    this.defaultTimeoutMs = defaultTimeoutMs;
    // Resolved launch spec (after first successful spawn)
    this._resolvedSpec = null;
  }

  async exec(prompt, opts = {}) {
    // Try resolved spec first; on ENOENT walk the fallback list.
    const specs = this._resolvedSpec
      ? [this._resolvedSpec]
      : this.fallbackCommands;

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
  }

  _tryExec(spec, prompt, { timeoutMs, cwd, onChild, onChunk } = {}) {
    return new Promise((resolve) => {
      // Pass the prompt via stdin, not as a CLI argument. Multi-line prompts
      // with special characters (`#`, `:`, Korean, quotes) get mangled by the
      // Windows shell when `shell: true` concatenates args. Stdin avoids the
      // whole shell-quoting problem.
      const baseArgs = [...spec.argsPrefix, "exec", "--full-auto", "--skip-git-repo-check"];
      // P1-5: Node 24 DEP0190 — see claude-runner.js for the rationale.
      // Wrap in `cmd.exe /c` on Windows so PATHEXT still resolves `.cmd`
      // launchers, but with `shell: false` so Node does not re-tokenize
      // our argv. Prompt is on stdin (P0-3), so argv is all fixed flags.
      const isWin = process.platform === "win32";
      const spawnCmd = isWin ? "cmd.exe" : spec.cmd;
      const spawnArgs = isWin ? ["/c", spec.cmd, ...baseArgs] : baseArgs;
      let child;
      try {
        child = spawn(spawnCmd, spawnArgs, {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          cwd: cwd || process.cwd(),
        });
      } catch (err) {
        const f = this._failure(`spawn failed (${spec.cmd}): ${err.message}`);
        f._enoent = /ENOENT/i.test(err.message);
        return resolve(f);
      }

      // Write prompt via stdin and close. Errors here are non-fatal: if the
      // child already exited (e.g. ENOENT before stdin is ready) we let the
      // close handler report the real reason.
      try {
        child.stdin.on("error", () => {});
        child.stdin.write(prompt);
        child.stdin.end();
      } catch (_) {
        // swallow — close/error handlers below will resolve the promise
      }

      const out = [];
      const errChunks = [];
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        try { child.kill(); } catch (_) {}
      }, timeoutMs || this.defaultTimeoutMs);

      if (typeof onChild === "function") onChild(child);

      child.stdout.on("data", (c) => {
        out.push(c);
        if (typeof onChunk === "function") {
          try { onChunk({ stream: "stdout", text: c.toString("utf-8") }); }
          catch (_) {}
        }
      });
      child.stderr.on("data", (c) => {
        errChunks.push(c);
        if (typeof onChunk === "function") {
          try { onChunk({ stream: "stderr", text: c.toString("utf-8") }); }
          catch (_) {}
        }
      });

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
        // If the command itself wasn't found (e.g. Windows cmd emits an error
        // message with code 1 or 9009), treat as ENOENT so fallback kicks in.
        const enoentLike =
          code !== 0 &&
          /(is not recognized|command not found|ENOENT|not found|'codex'|no such file)/i.test(
            stderr + stdout
          ) &&
          (stdout.length < 2000);
        resolve({
          ok: code === 0,
          exitCode: code,
          stdout,
          stderr,
          summary: this._extractSummary(stdout),
          findings: this._extractFindings(stdout),
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

module.exports = { CodexRunner };
