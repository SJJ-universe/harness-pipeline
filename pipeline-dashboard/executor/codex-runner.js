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
    const { timeoutMs, cwd, phaseId = null, iteration = 0, source = "phase" } = opts;
    return new Promise((resolve) => {
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
      const startedAt = Date.now();

      let child;
      try {
        child = this.spawn(resolveCommand(spec.cmd), args, {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          cwd: cwd || process.cwd(),
          shell: process.platform === "win32",
        });
      } catch (err) {
        const f = this._failure(`spawn failed (${spec.cmd}): ${err.message}`);
        f._enoent = /ENOENT/i.test(err.message);
        if (runId) this.runRegistry?.complete(runId, f);
        return resolve(f);
      }

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
              runId,
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

      const timer = setTimeout(() => {
        if (settled) return;
        try { child.kill(); } catch (_) {}
      }, timeoutMs || this.defaultTimeoutMs);

      child.stdout.on("data", (chunk) => {
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
      });

      child.stderr.on("data", (chunk) => {
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
        clearTimeout(timer);
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        const f = this._failure(`spawn error (${spec.cmd}): ${err.message}`);
        f._enoent = /ENOENT/i.test(err.message);
        if (runId) this.runRegistry?.complete(runId, f);
        resolve(f);
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
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

module.exports = { CodexRunner, defaultRedact, SECRET_PATTERNS };
