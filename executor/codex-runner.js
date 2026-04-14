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
  constructor({ codexCommand = "codex", defaultTimeoutMs = 120000 } = {}) {
    this.codexCommand = codexCommand;
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  exec(prompt, { timeoutMs, cwd } = {}) {
    return new Promise((resolve) => {
      const args = ["exec", "--full-auto", "--skip-git-repo-check", prompt];
      let child;
      try {
        child = spawn(this.codexCommand, args, {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          cwd: cwd || process.cwd(),
          shell: process.platform === "win32",
        });
      } catch (err) {
        return resolve(this._failure(`spawn failed: ${err.message}`));
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
        resolve(this._failure(`spawn error: ${err.message}`));
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const stdout = Buffer.concat(out).toString("utf-8");
        const stderr = Buffer.concat(errChunks).toString("utf-8");
        resolve({
          ok: code === 0,
          exitCode: code,
          stdout,
          stderr,
          summary: this._extractSummary(stdout),
          findings: this._extractFindings(stdout),
        });
      });
    });
  }

  _failure(reason) {
    return { ok: false, exitCode: null, stdout: "", stderr: reason, summary: "", findings: [], error: reason };
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
