// tests/smoke/launcher-portable.test.js — Slice D0-d (Phase E1, 2026-04-29)
//
// End-to-end-ish coverage for the harness-start launcher *without*
// actually downloading a release zip or starting the dashboard.
//
// What we test (and why these and not more):
//
//   1. launcher-cli.js exposes the documented commands and exit codes.
//      The PowerShell + bash launcher scripts depend on these contracts;
//      if launcher-cli regresses, both platforms break the same way.
//
//   2. The Windows .bat launcher is reachable + non-empty.
//      We can't `cmd.exe /c harness-start.bat` in Node tests on Linux CI,
//      and Windows CI cannot run the .sh path. We therefore validate
//      *file presence* (script in repo) + *handler completeness* (CLI
//      coverage tested via Node). Smoke for the actual interactive
//      launch lives in `tests/e2e/launcher-windows.ps1` (manual).
//
//   3. `HARNESS_DATA_DIR` is honored by configPaths.resolve() when the
//      launcher invokes resolve-paths. This is the portable-mode
//      contract: an operator pointing $HARNESS_DATA_DIR at a USB stick
//      must see versions/ open under that USB stick path, not %LOCALAPPDATA%.
//
//   4. SHA256 mismatch: launcher-cli verify-sha256 returns exit 1 on
//      bad hash. The launcher scripts depend on this exit code to
//      quarantine the zip and abort.
//
// What we DON'T test here (and where it lives instead):
//   - Actual zip extraction → manual e2e + future D0-c integration tests
//   - `node start.js` boot path → tests/smoke/server-boot.test.js
//   - PowerShell parser correctness → covered ad-hoc; PSv5.1 lacks
//     the kind of cross-platform headless harness Node has.

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync, spawn } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(REPO_ROOT, "scripts", "launcher", "launcher-cli.js");

// Common test helper: invoke launcher-cli with args, capture stdout/exit.
// Pass through an env override map so we can simulate HARNESS_DATA_DIR.
function runCli(args, opts = {}) {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf-8",
    env: { ...process.env, ...(opts.env || {}) },
  });
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

// Async variant — REQUIRED when the launcher-cli command needs to talk
// to an HTTP server living in this same Node process. spawnSync blocks
// the event loop, so an in-process server can't accept the connection
// during the call. The verify-health tests trip over that.
function runCliAsync(args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      env: { ...process.env, ...(opts.env || {}) },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => { stdout += c.toString("utf-8"); });
    child.stderr.on("data", (c) => { stderr += c.toString("utf-8"); });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("launcher-cli: --help lists every documented command", () => {
  const { code, stdout } = runCli(["--help"]);
  assert.equal(code, 0, "exit 0 on --help");
  // Each documented command must appear in the help output. If we add a
  // new command but forget to update the help block, this fails loudly.
  const expected = [
    "validate-manifest",
    "verify-sha256",
    "compare-semver",
    "check-runtime",
    "resolve-paths",
    "version-install-dir",
  ];
  for (const cmd of expected) {
    assert.match(stdout, new RegExp(`\\b${cmd}\\b`), `--help mentions ${cmd}`);
  }
});

test("launcher-cli: unknown command fails with exit 2", () => {
  const { code, stderr } = runCli(["nope-not-real"]);
  assert.equal(code, 2);
  assert.match(stderr, /unknown command/);
});

test("launcher-cli: validate-manifest accepts valid example", () => {
  const exampleManifest = path.join(
    REPO_ROOT, "scripts", "launcher", "manifest.json.example",
  );
  const { code, stdout } = runCli(["validate-manifest", exampleManifest]);
  assert.equal(code, 0);
  // The CLI echoes the validated JSON for downstream PowerShell/bash
  // to ConvertFrom-Json. Confirm the version field at minimum.
  assert.match(stdout, /"version"\s*:\s*"[\d.]+"/);
});

test("launcher-cli: validate-manifest rejects schema violations", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-launcher-test-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  // url is plain http — must reject (we mandate https for in-transit
  // tampering protection). All other fields are valid so the only
  // surfaced error is the url one — exposes the schema enforcement.
  const bad = {
    version: "1.0.0",
    url: "http://example.com/bad.zip",
    sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    publishedAt: "2026-05-01T00:00:00Z",
    minNodeVersion: "24.0.0",
  };
  const file = path.join(tmpDir, "bad-http.json");
  fs.writeFileSync(file, JSON.stringify(bad));

  const { code, stderr } = runCli(["validate-manifest", file]);
  assert.equal(code, 1);
  assert.match(stderr, /https/, "stderr explains the https requirement");
});

test("launcher-cli: validate-manifest tolerates UTF-8 BOM", (t) => {
  // PowerShell 5.1's `Set-Content -Encoding utf8` injects a BOM. The
  // CLI must accept BOM-prefixed JSON because the launcher scripts
  // sometimes redirect through PowerShell-staged temp files.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-launcher-test-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const valid = {
    version: "1.0.0",
    url: "https://example.com/valid.zip",
    sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    publishedAt: "2026-05-01T00:00:00Z",
    minNodeVersion: "24.0.0",
  };
  const file = path.join(tmpDir, "bom.json");
  fs.writeFileSync(file, "﻿" + JSON.stringify(valid));

  const { code } = runCli(["validate-manifest", file]);
  assert.equal(code, 0, "BOM-prefixed JSON must validate cleanly");
});

test("launcher-cli: verify-sha256 matches a known hash", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-launcher-test-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const file = path.join(tmpDir, "data.bin");
  const payload = Buffer.from("the quick brown fox", "utf-8");
  fs.writeFileSync(file, payload);
  const expected = crypto.createHash("sha256").update(payload).digest("hex");

  const { code, stdout } = runCli(["verify-sha256", file, expected]);
  assert.equal(code, 0);
  // The CLI emits {ok, actual, expected} JSON for forensics; ensure
  // the "ok":true flag is plainly visible (PowerShell ConvertFrom-Json
  // consumes this).
  assert.match(stdout, /"ok"\s*:\s*true/);
});

test("launcher-cli: verify-sha256 fails on mismatch", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-launcher-test-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const file = path.join(tmpDir, "data.bin");
  fs.writeFileSync(file, "real bytes");
  // Wrong-length hash is detected by `verify-sha256`'s length check;
  // wrong-content hash is detected by the content compare. We pick the
  // wrong-content variant since that's what an attacker's tamper would
  // look like.
  const wrong = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
  const { code, stdout } = runCli(["verify-sha256", file, wrong]);
  assert.equal(code, 1, "exit 1 on mismatch — launcher uses this to quarantine");
  assert.match(stdout, /"ok"\s*:\s*false/);
});

test("launcher-cli: compare-semver outputs single token (-1/0/1)", () => {
  // PowerShell + bash both parse this as integer; any extra noise
  // breaks the launcher's branching. Lock the contract.
  const r1 = runCli(["compare-semver", "1.0.0", "2.0.0"]);
  assert.equal(r1.code, 0);
  assert.equal(r1.stdout.trim(), "-1");

  const r2 = runCli(["compare-semver", "1.0.0", "1.0.0"]);
  assert.equal(r2.code, 0);
  assert.equal(r2.stdout.trim(), "0");

  const r3 = runCli(["compare-semver", "2.5.0", "1.0.0"]);
  assert.equal(r3.code, 0);
  assert.equal(r3.stdout.trim(), "1");
});

test("launcher-cli: compare-semver rejects invalid input", () => {
  const { code, stderr } = runCli(["compare-semver", "1.0", "not-a-version"]);
  assert.equal(code, 2);
  assert.match(stderr, /invalid version/);
});

test("launcher-cli: check-runtime accepts version meeting minimum", () => {
  // The launcher passes `node --version` output directly — the leading
  // "v" must be tolerated.
  const r1 = runCli(["check-runtime", "v24.5.0", "24.0.0"]);
  assert.equal(r1.code, 0);
  assert.match(r1.stdout, /"ok"\s*:\s*true/);

  const r2 = runCli(["check-runtime", "v23.0.0", "24.0.0"]);
  assert.equal(r2.code, 1, "exit 1 when runtime is too old");
  assert.match(r2.stdout, /"ok"\s*:\s*false/);
});

test("launcher-cli: resolve-paths honors HARNESS_DATA_DIR override", () => {
  // Portable-mode contract. Set the env override and confirm the
  // resolved versionsDir lives under the override path. Use a
  // platform-appropriate marker so this test passes identically on
  // Win + Mac + Linux CI.
  const portable = path.join(os.tmpdir(), "harness-portable-test-zone");
  const { code, stdout } = runCli(["resolve-paths"], {
    env: { HARNESS_DATA_DIR: portable },
  });
  assert.equal(code, 0);
  const resolved = JSON.parse(stdout);
  assert.equal(resolved.localAppdataData, portable);
  assert.equal(resolved.versionsDir, path.join(portable, "versions"));
  assert.equal(resolved.resolvedFrom.data, "env",
    "data dir source must be reported as 'env' for forensics",
  );
});

test("launcher-cli: version-install-dir rejects path traversal", () => {
  // Defense-in-depth: even though manifest schema validation catches
  // bad versions upstream, the path API enforces the same rule so a
  // direct caller can't slip through.
  const cases = ["../../etc/passwd", "1.0.0/../escape", "..", "a/b"];
  for (const v of cases) {
    const { code, stderr } = runCli(["version-install-dir", v]);
    assert.equal(code, 1, `version "${v}" must be rejected`);
    assert.match(stderr, /invalid version/);
  }
});

test("launcher-cli: version-install-dir resolves cleanly for valid versions", () => {
  // Hits the happy path so we know the function doesn't reject all
  // inputs (which would mask bugs during refactor).
  const { code, stdout } = runCli(["version-install-dir", "1.2.3"], {
    env: { HARNESS_DATA_DIR: path.join(os.tmpdir(), "v-install-test") },
  });
  assert.equal(code, 0);
  // Trim because the CLI appends a trailing newline; the launcher
  // scripts treat the path as the only content and don't depend on
  // the newline.
  const got = stdout.trim();
  const expected = path.join(os.tmpdir(), "v-install-test", "versions", "1.2.3");
  assert.equal(got, expected);
});

test("launcher-cli: manifest-field extracts a single field value", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-launcher-test-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const manifest = {
    version: "1.2.3",
    url: "https://example.com/v1.2.3.zip",
    sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    publishedAt: "2026-05-01T00:00:00Z",
    minNodeVersion: "24.0.0",
  };
  const file = path.join(tmpDir, "m.json");
  fs.writeFileSync(file, JSON.stringify(manifest));

  // Each well-known field reads back as the bare scalar — no quotes, no
  // JSON wrapping. The launcher scripts depend on this so they can pipe
  // the result straight into a comparison without any post-processing.
  const cases = [
    { field: "version", expected: "1.2.3" },
    { field: "minNodeVersion", expected: "24.0.0" },
    { field: "publishedAt", expected: "2026-05-01T00:00:00Z" },
  ];
  for (const c of cases) {
    const r = runCli(["manifest-field", file, c.field]);
    assert.equal(r.code, 0, `${c.field} reads back exit 0`);
    assert.equal(r.stdout.trim(), c.expected, `${c.field} value matches`);
  }

  // Missing field → exit 1, helpful stderr.
  const missing = runCli(["manifest-field", file, "doesNotExist"]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /not present/);
});

// ─────────────────────────────────────────────────────────────────
//  D0-e (Phase E1, 2026-04-29) hardening tests:
//   1. validate-manifest-url scheme enforcement
//   2. verify-health app=="OrchestratorPipeline" discriminator
// ─────────────────────────────────────────────────────────────────

test("D0-e validate-manifest-url accepts https:// by default", () => {
  const r = runCli(["validate-manifest-url", "https://example.internal/manifest.json"]);
  assert.equal(r.code, 0, "https URL must pass without env override");
  assert.match(r.stdout, /^ok https /, "stdout reports scheme + host");
});

test("D0-e validate-manifest-url rejects http:// without escape hatch", () => {
  const r = runCli(["validate-manifest-url", "http://example.com/manifest.json"], {
    env: { HARNESS_ALLOW_INSECURE_MANIFEST_URL: "" }, // explicit unset
  });
  assert.equal(r.code, 1, "http URL must be rejected when override is off");
  assert.match(r.stderr, /https:\/\/ required/);
  assert.match(r.stderr, /HARNESS_ALLOW_INSECURE_MANIFEST_URL=1/, "stderr documents the escape hatch");
});

test("D0-e validate-manifest-url rejects file:// without escape hatch", () => {
  const r = runCli(["validate-manifest-url", "file:///tmp/manifest.json"]);
  assert.equal(r.code, 1, "file:// URL must be rejected");
  assert.match(r.stderr, /https:\/\/ required/);
});

test("D0-e validate-manifest-url permits non-https with HARNESS_ALLOW_INSECURE_MANIFEST_URL=1", () => {
  // Dev / test escape hatch. Loud stderr warning is mandatory so the
  // operator can never quietly drift from the safe default.
  const r = runCli(["validate-manifest-url", "http://localhost:8080/m.json"], {
    env: { HARNESS_ALLOW_INSECURE_MANIFEST_URL: "1" },
  });
  assert.equal(r.code, 0, "exit 0 when escape hatch is enabled");
  assert.match(r.stderr, /WARNING/, "stderr warns the operator");
  assert.match(r.stderr, /never enable in production/, "stderr names the danger");
  assert.match(r.stdout, /ok insecure /);
});

test("D0-e validate-manifest-url rejects malformed URLs", () => {
  // Whitespace-padded URLs slip past naive regex checks but break URL
  // parsing. Reject loudly.
  const r1 = runCli(["validate-manifest-url", "https:// extra-space.com"]);
  assert.equal(r1.code, 1);

  const r2 = runCli(["validate-manifest-url", "not-a-url-at-all"]);
  assert.equal(r2.code, 1);

  const r3 = runCli(["validate-manifest-url", " https://leading-space.com"]);
  assert.equal(r3.code, 1, "leading whitespace is a configuration mistake worth catching");
});

test("D0-e verify-health: rejects URL that doesn't respond", () => {
  // Pick a port unlikely to have anything bound. exit 1 (not 2) because
  // the URL was syntactically valid; the network failure is what fails.
  const r = runCli(["verify-health", "http://127.0.0.1:1/api/health"]);
  assert.equal(r.code, 1);
});

test("D0-e verify-health: accepts a real OrchestratorPipeline server", async () => {
  // Boot a real server and confirm verify-health says "ok". Uses the
  // ASYNC runCli — spawnSync would block this process and the test
  // server couldn't accept the connection.
  const { start } = require("../../server");
  const PORT = 4327; // unused in the existing test matrix
  const listener = start(PORT, "127.0.0.1");
  let ready = false;
  for (let i = 0; i < 30 && !ready; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (res.ok) {
        const body = await res.json();
        // Inline assertion that the server actually advertises the
        // discriminator — without this, verify-health below would
        // pass on a server that didn't even know about D0-e.
        assert.equal(body.app, "OrchestratorPipeline", "/api/health body must include app field");
        assert.equal(body.healthVersion, 1, "/api/health body must include healthVersion");
        ready = true;
      }
    } catch (_) { /* retry */ }
    if (!ready) await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw new Error("server did not become ready");

  try {
    const r = await runCliAsync(["verify-health", `http://127.0.0.1:${PORT}/api/health`]);
    assert.equal(r.code, 0, "verify-health must accept the real server");
    assert.match(r.stdout, /"app"\s*:\s*"OrchestratorPipeline"/);
  } finally {
    await new Promise((resolve) => listener.close(resolve));
  }
});

test("D0-e verify-health: rejects a server that returns a different app field", async () => {
  // Stand up a tiny HTTP server that returns 200 + JSON but with the
  // WRONG app field. This is the port-squat scenario the D0-e check
  // exists to defend against. ASYNC runCli is required.
  const http = require("node:http");
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", app: "SomeOtherService" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const r = await runCliAsync(["verify-health", `http://127.0.0.1:${port}/api/health`]);
    assert.equal(r.code, 1, "verify-health must reject foreign app field");
    assert.match(r.stderr, /missing app="OrchestratorPipeline"/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("D0-e verify-health: rejects 200 response that is not JSON", async () => {
  // Even simpler port squat: plain text 200 response.
  const http = require("node:http");
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("hello from another world");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const r = await runCliAsync(["verify-health", `http://127.0.0.1:${port}/api/health`]);
    assert.equal(r.code, 1, "non-JSON 200 must be rejected");
    assert.match(r.stderr, /not JSON/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("launcher scripts exist in the repo for every supported platform", () => {
  // Catch a stray rename / accidental delete. Each launcher file is
  // depended on by docs/operator-guide.md; if any goes missing the
  // first-run UX breaks silently for that OS until someone notices.
  const required = [
    "harness-start.bat",
    "harness-start.sh",
    "scripts/launcher/launcher-cli.js",
    "scripts/launcher/install-version.ps1",
    "scripts/launcher/install-version.sh",
    "scripts/launcher/check-update.ps1",
    "scripts/launcher/check-update.sh",
    "scripts/launcher/manifest.json.example",
  ];
  for (const rel of required) {
    const full = path.join(REPO_ROOT, rel);
    assert.ok(fs.existsSync(full), `${rel} must exist (not deleted)`);
    const stat = fs.statSync(full);
    assert.ok(stat.size > 0, `${rel} must be non-empty`);
  }
});
