// CodexRunner — invokes `codex exec --full-auto` as a subprocess
// and parses its output into a critique structure.
//
// Output contract (enforced via prompt, parsed heuristically):
//   - Findings as bullet lines: "- [critical|high|medium|low] <message>"
//   - Final section "## Summary" containing a short verdict
//
// Parse failures are non-fatal — raw stdout is always preserved.

const { spawn } = require("child_process");
const dangerGate = require("../src/policy/dangerGate");

function resolveCommand(cmd) {
  if (process.platform !== "win32") return cmd;
  if (/\.(cmd|bat|exe)$/i.test(cmd)) return cmd;
  if (cmd === "npx" || cmd === "npm" || cmd === "codex") return `${cmd}.cmd`;
  return cmd;
}

class CodexRunner {
  constructor({ codexCommand = "codex", fallbackCommands, defaultTimeoutMs = 120000, runRegistry, repoRoot } = {}) {
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
    this.runRegistry = runRegistry || null;
    this.repoRoot = repoRoot || process.cwd();
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

  _tryExec(spec, prompt, { timeoutMs, cwd } = {}) {
    return new Promise((resolve) => {
      // Pass the prompt via stdin, not as a CLI argument. Multi-line prompts
      // with special characters (`#`, `:`, Korean, quotes) get mangled by the
      // Windows shell when `shell: true` concatenates args. Stdin avoids the
      // whole shell-quoting problem.
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
      const runId = this.runRegistry?.start({
        kind: "codex",
        input: { prompt },
        policyDecision,
      });
      let child;
      try {
        child = spawn(resolveCommand(spec.cmd), args, {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          cwd: cwd || process.cwd(),
          shell: false,
        });
      } catch (err) {
        const f = this._failure(`spawn failed (${spec.cmd}): ${err.message}`);
        f._enoent = /ENOENT/i.test(err.message);
        if (runId) this.runRegistry?.complete(runId, f);
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
        // If the command itself wasn't found (e.g. Windows cmd emits an error
        // message with code 1 or 9009), treat as ENOENT so fallback kicks in.
        const enoentLike =
          code !== 0 &&
          /(is not recognized|command not found|ENOENT|not found|'codex'|no such file)/i.test(
            stderr + stdout
          ) &&
          (stdout.length < 2000);
        const result = {
          ok: code === 0,
          exitCode: code,
          stdout,
          stderr,
          summary: this._extractSummary(stdout),
          findings: this._extractFindings(stdout),
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
