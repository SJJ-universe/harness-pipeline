// tests/unit/cliProbe.test.js — Slice D2-a (Phase E1.5, 2026-04-29)
//
// Verifies cross-platform CLI discovery + the security guards that
// keep the probe from becoming an arbitrary-command-execution path.
//
// Tested in priority order:
//
//   1. Strict input allowlist refuses path traversal, absolute paths,
//      shell metacharacters, empty/missing input, and oversized names.
//   2. shell:false is unconditionally passed to spawnImpl (a hypothetical
//      allowlist bypass cannot open a shell).
//   3. Cross-platform: opts.platform="win32" calls `where`,
//      anything else calls `which`. Both parse CRLF/LF correctly.
//   4. Multi-hit: returns ALL paths in `paths`, first hit in `path`.
//   5. Not-found: status!=0 OR empty stdout → found:false with operator-
//      readable error.
//   6. Timeout: spawnImpl signal=SIGTERM or ETIMEDOUT → timedOut:true +
//      operator-readable error.
//   7. Spawn error: result.error → found:false with the error message.

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  discoverCli,
  CLI_NAME_REGEX,
  CLI_NAME_MAX_LENGTH,
  PROBE_TIMEOUT_MS,
} = require("../../src/runtime/cliProbe");

// ── stub spawnSync ────────────────────────────────────────────

function stubSpawn(returns) {
  // Records every call so the test can assert what the probe
  // attempted to invoke (security baseline: shell:false, args, etc.)
  const calls = [];
  function spawnImpl(cmd, args, options) {
    calls.push({ cmd, args, options });
    if (typeof returns === "function") return returns(cmd, args, options);
    return returns;
  }
  spawnImpl.calls = calls;
  return spawnImpl;
}

// ─────────────────────────────────────────────────────────────────
//  INPUT ALLOWLIST
// ─────────────────────────────────────────────────────────────────

test("D2-a: refuses empty / non-string name (operator never sees a spawn)", () => {
  const spawnImpl = stubSpawn({ status: 0, stdout: "/bin/x" });
  for (const bad of ["", null, undefined, 42, {}, []]) {
    const result = discoverCli(bad, { spawnImpl });
    assert.equal(result.found, false);
    assert.match(result.error, /required|not allowed|not a valid|too long/);
  }
  assert.equal(spawnImpl.calls.length, 0,
    "spawn must NEVER be called when input is rejected");
});

test("D2-a: refuses absolute paths / path traversal / shell metacharacters", () => {
  const spawnImpl = stubSpawn({ status: 0, stdout: "/bin/x" });
  for (const bad of [
    "/usr/bin/claude",   // absolute
    "../bin/claude",     // path traversal
    "..\\bin\\claude",   // Windows path traversal
    "claude;rm",         // shell metacharacter
    "claude|cat",
    "claude && ls",
    "claude\nrm",        // newline injection
    "claude\trm",        // tab injection
    "claude rm",         // space (would split args if shell were true)
    "claude$(id)",       // command substitution
    "claude`id`",
    "claude>file",
    "1claude",           // starts with digit (kills PID-like)
    "-claude",           // starts with dash
    ".claude",           // starts with dot
  ]) {
    const result = discoverCli(bad, { spawnImpl });
    assert.equal(result.found, false, `must reject "${bad}"`);
    assert.match(result.error, /not allowed|not a valid/,
      `expected allowlist error for "${bad}", got: ${result.error}`);
  }
  assert.equal(spawnImpl.calls.length, 0,
    "spawn must NEVER fire when name allowlist rejects the input");
});

test("D2-a: refuses oversized names", () => {
  const spawnImpl = stubSpawn({ status: 0, stdout: "" });
  const tooLong = "a".repeat(CLI_NAME_MAX_LENGTH + 1);
  const result = discoverCli(tooLong, { spawnImpl });
  assert.equal(result.found, false);
  assert.match(result.error, /too long/);
  assert.equal(spawnImpl.calls.length, 0);
});

test("D2-a: accepts the canonical CLI names we ship support for", () => {
  const spawnImpl = stubSpawn({ status: 0, stdout: "/bin/claude\n" });
  for (const ok of ["claude", "codex", "node", "npm", "git", "Claude-Code", "node_v24", "tool.bin"]) {
    const result = discoverCli(ok, { spawnImpl });
    assert.equal(result.found, true, `must accept "${ok}", got error: ${result.error}`);
  }
});

test("D2-a: regex + max length exports stay stable for downstream callers", () => {
  // Lock the wire format. setupRoutes (D2-c) + wizard scripts (D2-d)
  // depend on these constants for input validation at the route layer.
  assert.ok(CLI_NAME_REGEX.test("claude"));
  assert.ok(CLI_NAME_REGEX.test("Claude-Code"));
  assert.ok(!CLI_NAME_REGEX.test("/usr/bin/claude"));
  assert.ok(!CLI_NAME_REGEX.test("a;b"));
  assert.equal(CLI_NAME_MAX_LENGTH, 64);
  assert.equal(PROBE_TIMEOUT_MS, 5000);
});

// ─────────────────────────────────────────────────────────────────
//  shell:false BASELINE (security)
// ─────────────────────────────────────────────────────────────────

test("D2-a: spawn is invoked with shell:false (no shell ever)", () => {
  const spawnImpl = stubSpawn({ status: 0, stdout: "/bin/claude\n" });
  discoverCli("claude", { spawnImpl, platform: "linux" });
  assert.equal(spawnImpl.calls.length, 1);
  assert.equal(spawnImpl.calls[0].options.shell, false,
    "shell must be false — even an allowlist bypass cannot open a shell");
  assert.equal(spawnImpl.calls[0].options.windowsHide, true);
});

test("D2-a: timeoutMs is passed through to spawnImpl (default 5s)", () => {
  const spawnImpl = stubSpawn({ status: 0, stdout: "/bin/claude\n" });
  discoverCli("claude", { spawnImpl, platform: "linux" });
  assert.equal(spawnImpl.calls[0].options.timeout, 5000);

  const spawnImpl2 = stubSpawn({ status: 0, stdout: "/bin/claude\n" });
  discoverCli("claude", { spawnImpl: spawnImpl2, platform: "linux", timeoutMs: 250 });
  assert.equal(spawnImpl2.calls[0].options.timeout, 250);
});

test("D2-a: env is passed through to spawnImpl", () => {
  const spawnImpl = stubSpawn({ status: 0, stdout: "/bin/claude\n" });
  const customEnv = { PATH: "/custom/bin", FOO: "bar" };
  discoverCli("claude", { spawnImpl, platform: "linux", env: customEnv });
  assert.equal(spawnImpl.calls[0].options.env, customEnv);
});

// ─────────────────────────────────────────────────────────────────
//  CROSS-PLATFORM (where vs which)
// ─────────────────────────────────────────────────────────────────

test("D2-a: platform=win32 invokes 'where'", () => {
  const spawnImpl = stubSpawn({ status: 0, stdout: "C:\\bin\\claude.cmd\r\n" });
  const result = discoverCli("claude", { spawnImpl, platform: "win32" });
  assert.equal(spawnImpl.calls[0].cmd, "where");
  assert.deepEqual(spawnImpl.calls[0].args, ["claude"]);
  assert.equal(result.found, true);
  assert.equal(result.path, "C:\\bin\\claude.cmd");
});

test("D2-a: platform=linux invokes 'which'", () => {
  const spawnImpl = stubSpawn({ status: 0, stdout: "/usr/bin/claude\n" });
  discoverCli("claude", { spawnImpl, platform: "linux" });
  assert.equal(spawnImpl.calls[0].cmd, "which");
});

test("D2-a: platform=darwin invokes 'which'", () => {
  const spawnImpl = stubSpawn({ status: 0, stdout: "/opt/homebrew/bin/claude\n" });
  discoverCli("claude", { spawnImpl, platform: "darwin" });
  assert.equal(spawnImpl.calls[0].cmd, "which");
});

// ─────────────────────────────────────────────────────────────────
//  PARSING — CRLF, LF, multi-hit, trimming
// ─────────────────────────────────────────────────────────────────

test("D2-a: parses Windows CRLF output", () => {
  const spawnImpl = stubSpawn({
    status: 0,
    stdout: "C:\\bin\\claude.cmd\r\nC:\\Users\\op\\AppData\\Roaming\\npm\\claude.cmd\r\n",
  });
  const result = discoverCli("claude", { spawnImpl, platform: "win32" });
  assert.equal(result.found, true);
  assert.equal(result.path, "C:\\bin\\claude.cmd");
  assert.deepEqual(result.paths, [
    "C:\\bin\\claude.cmd",
    "C:\\Users\\op\\AppData\\Roaming\\npm\\claude.cmd",
  ]);
});

test("D2-a: parses POSIX LF output", () => {
  const spawnImpl = stubSpawn({
    status: 0,
    stdout: "/usr/local/bin/claude\n/usr/bin/claude\n",
  });
  const result = discoverCli("claude", { spawnImpl, platform: "linux" });
  assert.equal(result.found, true);
  assert.equal(result.path, "/usr/local/bin/claude");
  assert.equal(result.paths.length, 2);
});

test("D2-a: trims whitespace + filters blank lines", () => {
  const spawnImpl = stubSpawn({
    status: 0,
    stdout: "\n  /usr/bin/claude  \n\n/usr/local/bin/claude\n   \n",
  });
  const result = discoverCli("claude", { spawnImpl, platform: "linux" });
  assert.equal(result.path, "/usr/bin/claude");
  assert.deepEqual(result.paths, ["/usr/bin/claude", "/usr/local/bin/claude"]);
});

// ─────────────────────────────────────────────────────────────────
//  NOT FOUND
// ─────────────────────────────────────────────────────────────────

test("D2-a: status!=0 → found:false with operator-readable error", () => {
  const spawnImpl = stubSpawn({
    status: 1,
    stdout: "",
    stderr: "claude: not found",
  });
  const result = discoverCli("claude", { spawnImpl, platform: "linux" });
  assert.equal(result.found, false);
  assert.equal(result.path, null);
  assert.deepEqual(result.paths, []);
  assert.match(result.error, /not found/);
  assert.equal(result.timedOut, false);
});

test("D2-a: empty stdout → found:false (covers Windows where on miss)", () => {
  const spawnImpl = stubSpawn({ status: 0, stdout: "", stderr: "" });
  const result = discoverCli("claude", { spawnImpl, platform: "win32" });
  assert.equal(result.found, false);
  assert.match(result.error, /not on PATH/);
});

test("D2-a: stderr message used when present, falls back to default otherwise", () => {
  const spawnImpl = stubSpawn({ status: 1, stdout: "", stderr: "" });
  const result = discoverCli("claude", { spawnImpl, platform: "linux" });
  assert.match(result.error, /not on PATH/);
});

// ─────────────────────────────────────────────────────────────────
//  TIMEOUT
// ─────────────────────────────────────────────────────────────────

test("D2-a: spawn signal=SIGTERM → timedOut:true + operator error", () => {
  const spawnImpl = stubSpawn({
    status: null,
    stdout: "",
    stderr: "",
    signal: "SIGTERM",
  });
  const result = discoverCli("claude", { spawnImpl, platform: "linux", timeoutMs: 250 });
  assert.equal(result.timedOut, true);
  assert.equal(result.found, false);
  assert.match(result.error, /timed out after 250ms/);
});

test("D2-a: ETIMEDOUT result.error.code → timedOut:true (Windows path)", () => {
  const spawnImpl = stubSpawn({
    status: null,
    stdout: "",
    stderr: "",
    error: { code: "ETIMEDOUT", message: "spawn ETIMEDOUT" },
  });
  const result = discoverCli("claude", { spawnImpl, platform: "win32" });
  assert.equal(result.timedOut, true);
  assert.equal(result.found, false);
});

// ─────────────────────────────────────────────────────────────────
//  SPAWN ERROR (non-timeout)
// ─────────────────────────────────────────────────────────────────

test("D2-a: spawn throws → returns structured failure (no unhandled rejection)", () => {
  const spawnImpl = (() => {
    const f = function () { throw new Error("fork failed"); };
    f.calls = [];
    return f;
  })();
  const result = discoverCli("claude", { spawnImpl, platform: "linux" });
  assert.equal(result.found, false);
  assert.match(result.error, /probe spawn failed/);
  assert.match(result.error, /fork failed/);
});

test("D2-a: spawn returns null/undefined → returns structured failure", () => {
  const result = discoverCli("claude", {
    spawnImpl: () => null,
    platform: "linux",
  });
  assert.equal(result.found, false);
  assert.match(result.error, /no result/);
});

test("D2-a: result.error (non-timeout) → found:false carrying the error message", () => {
  const spawnImpl = stubSpawn({
    status: null,
    stdout: "",
    stderr: "",
    error: { code: "EACCES", message: "permission denied" },
  });
  const result = discoverCli("claude", { spawnImpl, platform: "linux" });
  assert.equal(result.found, false);
  assert.match(result.error, /permission denied/);
});

// ─────────────────────────────────────────────────────────────────
//  RETURN SHAPE LOCK
// ─────────────────────────────────────────────────────────────────

test("D2-a: success result shape contains all documented fields", () => {
  const spawnImpl = stubSpawn({ status: 0, stdout: "/bin/claude\n" });
  const result = discoverCli("claude", { spawnImpl, platform: "linux" });
  assert.deepEqual(
    Object.keys(result).sort(),
    ["error", "found", "name", "path", "paths", "raw", "timedOut"].sort(),
  );
  assert.equal(typeof result.found, "boolean");
  assert.equal(typeof result.name, "string");
  assert.ok(typeof result.path === "string" || result.path === null);
  assert.ok(Array.isArray(result.paths));
  assert.ok(typeof result.error === "string" || result.error === null);
  assert.equal(typeof result.raw, "string");
  assert.equal(typeof result.timedOut, "boolean");
});

test("D2-a: failure result shape matches success shape (operator-friendly contract)", () => {
  const result = discoverCli("", {
    spawnImpl: () => ({ status: 0, stdout: "" }),
    platform: "linux",
  });
  assert.deepEqual(
    Object.keys(result).sort(),
    ["error", "found", "name", "path", "paths", "raw", "timedOut"].sort(),
  );
});
