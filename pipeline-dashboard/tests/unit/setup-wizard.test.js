// tests/unit/setup-wizard.test.js — Slice D2-d (Phase E1.5, 2026-04-29)
//
// Covers the Node wizard's parser + resolvers + main() with stubbed
// fetch + prompt. The .ps1 / .sh wrappers are linted in
// setup-wizard-scripts.test.js so each script's contract gets its
// own test file (mirrors the launcher test split).

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const wizard = require("../../scripts/setup-wizard");

// ── stub helpers ───────────────────────────────────────────────

function stubFetch(scenarios) {
  // scenarios is an array of { matcher: (url, opts) => bool, response: {ok, status, body} }
  // OR a function(url, opts) → response
  function impl(url, opts) {
    impl.calls.push({ url, opts });
    if (typeof scenarios === "function") {
      const r = scenarios(url, opts);
      return Promise.resolve(_makeResponse(r));
    }
    for (const s of scenarios) {
      if (!s.matcher || s.matcher(url, opts)) {
        return Promise.resolve(_makeResponse(s.response));
      }
    }
    return Promise.resolve(_makeResponse({ ok: false, status: 404, body: { error: "no stub" } }));
  }
  impl.calls = [];
  return impl;
}

function _makeResponse(r) {
  const text = r.body !== undefined ? JSON.stringify(r.body) : (r.text || "");
  return {
    ok: r.ok != null ? r.ok : (r.status >= 200 && r.status < 300),
    status: r.status || 200,
    text() { return Promise.resolve(text); },
  };
}

function stubPrompt(answers) {
  // answers: array of strings/booleans consumed by ask + confirm calls
  // in order. Throws if exhausted.
  const queue = [...answers];
  return {
    async ask(question, defaultValue) {
      if (queue.length === 0) {
        throw new Error(`stubPrompt exhausted: question "${question}"`);
      }
      const v = queue.shift();
      return v != null ? String(v) : (defaultValue || "");
    },
    async confirm(question, defaultYes) {
      if (queue.length === 0) {
        throw new Error(`stubPrompt exhausted: confirm "${question}"`);
      }
      const v = queue.shift();
      return !!v;
    },
    close() {},
    remaining() { return queue.length; },
  };
}

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-wiz-test-"));
  t.after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });
  return dir;
}

// Capture stdout/stderr during a function call.
function captureOutput(fn) {
  return new Promise(async (resolve) => {
    const stdout = [];
    const stderr = [];
    const origStdout = process.stdout.write.bind(process.stdout);
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stdout.write = (chunk) => { stdout.push(String(chunk)); return true; };
    process.stderr.write = (chunk) => { stderr.push(String(chunk)); return true; };
    let result;
    try { result = await fn(); }
    finally {
      process.stdout.write = origStdout;
      process.stderr.write = origStderr;
    }
    resolve({ result, stdout: stdout.join(""), stderr: stderr.join("") });
  });
}

// ─────────────────────────────────────────────────────────────────
//  parseArgs
// ─────────────────────────────────────────────────────────────────

test("D2-d: parseArgs — empty argv → run, mode=null", () => {
  const r = wizard.parseArgs([]);
  assert.equal(r.command, "run");
  assert.equal(r.mode, null);
  assert.equal(r.tier3, false);
  assert.equal(r.noPrompt, false);
  assert.equal(r.baseUrl, null);
  assert.equal(r.token, null);
});

test("D2-d: parseArgs — --help / -h → command:help", () => {
  assert.equal(wizard.parseArgs(["--help"]).command, "help");
  assert.equal(wizard.parseArgs(["-h"]).command, "help");
});

test("D2-d: parseArgs — --version / -v → command:version", () => {
  assert.equal(wizard.parseArgs(["--version"]).command, "version");
  assert.equal(wizard.parseArgs(["-v"]).command, "version");
});

test("D2-d: parseArgs — track flags (--standard / --public-sector)", () => {
  assert.equal(wizard.parseArgs(["--standard"]).mode, "standard");
  assert.equal(wizard.parseArgs(["--public-sector"]).mode, "public-sector");
});

test("D2-d: parseArgs — boolean flags", () => {
  assert.equal(wizard.parseArgs(["--tier3"]).tier3, true);
  assert.equal(wizard.parseArgs(["--no-prompt"]).noPrompt, true);
});

test("D2-d: parseArgs — value flags consume next arg", () => {
  const r1 = wizard.parseArgs(["--base-url", "http://x"]);
  assert.equal(r1.baseUrl, "http://x");
  const r2 = wizard.parseArgs(["--token", "abc"]);
  assert.equal(r2.token, "abc");
});

test("D2-d: parseArgs — unknown arg → command:error", () => {
  const r = wizard.parseArgs(["--ghost"]);
  assert.equal(r.command, "error");
  assert.match(r.error, /unknown argument/);
});

test("D2-d: parseArgs — multiple flags compose", () => {
  const r = wizard.parseArgs([
    "--public-sector", "--tier3", "--no-prompt",
    "--base-url", "http://h", "--token", "tok",
  ]);
  assert.equal(r.mode, "public-sector");
  assert.equal(r.tier3, true);
  assert.equal(r.noPrompt, true);
  assert.equal(r.baseUrl, "http://h");
  assert.equal(r.token, "tok");
});

// ─────────────────────────────────────────────────────────────────
//  resolveTrack / resolveBaseUrl / resolveToken
// ─────────────────────────────────────────────────────────────────

test("D2-d: resolveTrack — flag wins over env", () => {
  assert.equal(wizard.resolveTrack({ mode: "standard" }, { HARNESS_DEPLOYMENT_PROFILE: "public-sector" }), "standard");
  assert.equal(wizard.resolveTrack({ mode: "public-sector" }, {}), "public-sector");
});

test("D2-d: resolveTrack — env reflected when no flag", () => {
  assert.equal(wizard.resolveTrack({}, { HARNESS_DEPLOYMENT_PROFILE: "public-sector" }), "public-sector");
});

test("D2-d: resolveTrack — default = standard", () => {
  assert.equal(wizard.resolveTrack({}, {}), "standard");
  assert.equal(wizard.resolveTrack({}, { HARNESS_DEPLOYMENT_PROFILE: "" }), "standard");
});

test("D2-d: resolveBaseUrl — flag > env > default", () => {
  assert.equal(wizard.resolveBaseUrl({ baseUrl: "http://flag" }, { HARNESS_BASE_URL: "http://env" }), "http://flag");
  assert.equal(wizard.resolveBaseUrl({}, { HARNESS_BASE_URL: "http://env" }), "http://env");
  assert.equal(wizard.resolveBaseUrl({}, {}), "http://127.0.0.1:4201");
});

test("D2-d: resolveToken — flag > env > token file > null", (t) => {
  const dir = tmpDir(t);
  fs.mkdirSync(path.join(dir, ".harness"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".harness", "local-token"), "from-file\n");

  assert.equal(wizard.resolveToken({ token: "flag" }, { HARNESS_TOKEN: "env" }, dir), "flag");
  assert.equal(wizard.resolveToken({}, { HARNESS_TOKEN: "env" }, dir), "env");
  assert.equal(wizard.resolveToken({}, {}, dir), "from-file");

  // No file in this dir → null.
  const empty = tmpDir(t);
  assert.equal(wizard.resolveToken({}, {}, empty), null);
});

test("D2-d: resolveToken — empty file → null (operator never sees empty token)", (t) => {
  const dir = tmpDir(t);
  fs.mkdirSync(path.join(dir, ".harness"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".harness", "local-token"), "   \n  \n");
  assert.equal(wizard.resolveToken({}, {}, dir), null);
});

// ─────────────────────────────────────────────────────────────────
//  postJson
// ─────────────────────────────────────────────────────────────────

test("D2-d: postJson — sends x-harness-token header + JSON body", async () => {
  const fetchImpl = stubFetch([
    { matcher: () => true, response: { status: 200, body: { ok: true } } },
  ]);
  const r = await wizard.postJson({
    baseUrl: "http://h",
    token: "secret-token",
    path: "/api/x",
    body: { a: 1 },
    fetchImpl,
  });
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(fetchImpl.calls[0].url, "http://h/api/x");
  assert.equal(fetchImpl.calls[0].opts.method, "POST");
  assert.equal(fetchImpl.calls[0].opts.headers["x-harness-token"], "secret-token");
  assert.equal(JSON.parse(fetchImpl.calls[0].opts.body).a, 1);
});

test("D2-d: postJson — network error returns ok:false (no throw)", async () => {
  const fetchImpl = () => Promise.reject(new Error("ECONNREFUSED"));
  const r = await wizard.postJson({
    baseUrl: "http://h",
    token: "x",
    path: "/api/x",
    fetchImpl,
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /ECONNREFUSED/);
});

test("D2-d: postJson — strips trailing slash on baseUrl", async () => {
  const fetchImpl = stubFetch([{ matcher: () => true, response: { status: 200, body: {} } }]);
  await wizard.postJson({ baseUrl: "http://h//", token: "t", path: "/api/x", fetchImpl });
  assert.equal(fetchImpl.calls[0].url, "http://h/api/x");
});

// ─────────────────────────────────────────────────────────────────
//  main — handshake / arg routing
// ─────────────────────────────────────────────────────────────────

test("D2-d: main --help → exit 0 with help text", async () => {
  const out = await captureOutput(() => wizard.main(["--help"], {}));
  assert.equal(out.result, 0);
  assert.match(out.stdout, /harness setup wizard/);
  assert.match(out.stdout, /--public-sector/);
});

test("D2-d: main --version → exit 0 with version line", async () => {
  const out = await captureOutput(() => wizard.main(["--version"], {}));
  assert.equal(out.result, 0);
  assert.match(out.stdout, /setup-wizard \d/);
});

test("D2-d: main unknown arg → exit 3 with error to stderr", async () => {
  const out = await captureOutput(() => wizard.main(["--ghost"], {}));
  assert.equal(out.result, 3);
  assert.match(out.stderr, /unknown argument/);
});

test("D2-d: main no token + no .harness file → exit 2 with actionable message", async (t) => {
  const dir = tmpDir(t);
  const out = await captureOutput(() => wizard.main([], {}, { repoRoot: dir }));
  assert.equal(out.result, 2);
  assert.match(out.stderr, /no HARNESS_TOKEN/i);
  assert.match(out.stderr, /local-token|--token/);
});

// ─────────────────────────────────────────────────────────────────
//  main — STANDARD track happy path
// ─────────────────────────────────────────────────────────────────

test("D2-d: main standard track happy path → finalize success", async (t) => {
  const repoRoot = tmpDir(t);
  fs.mkdirSync(path.join(repoRoot, ".harness"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, ".harness", "local-token"), "test-token");

  const wsDir = tmpDir(t);

  const fetchImpl = stubFetch((url, opts) => {
    if (url.endsWith("/probe-node")) {
      return { status: 200, body: { ok: true, version: "24.0.0", satisfiesMinimum: true, minimumRequired: "24.0.0", error: null } };
    }
    if (url.endsWith("/probe-cli")) {
      const body = JSON.parse(opts.body);
      return {
        status: 200,
        body: {
          found: true,
          name: body.name,
          path: `/bin/${body.name}`,
          paths: [`/bin/${body.name}`],
          error: null, raw: "", timedOut: false,
        },
      };
    }
    if (url.endsWith("/probe-workspace")) {
      const body = JSON.parse(opts.body);
      return { status: 200, body: { ok: true, exists: true, writable: true, normalizedPath: body.workspacePath, error: null } };
    }
    if (url.endsWith("/finalize")) {
      const body = JSON.parse(opts.body);
      return { status: 200, body: { ok: true, profile: body.profile, activeProfileId: body.setActive ? body.profile.id : null } };
    }
    return { status: 404, body: { error: "no stub" } };
  });

  // Standard track prompts the operator for:
  //   1. profile id        (default "personal")
  //   2. profile label     (default "Personal")
  //   3. workspace path    (default OS-specific home/harness-workspace)
  //   4. test claude?      (confirm, default true → false to skip)
  //   5. test codex?       (confirm only if codex CLI found, default false → false)
  //   6. set active?       (confirm, default true)
  const promptImpl = stubPrompt([
    "personal",     // id
    "Personal",     // label
    wsDir,          // workspacePath
    false,          // test claude? → no
    false,          // test codex? → no
    true,           // setActive
  ]);

  const out = await captureOutput(() =>
    wizard.main(["--standard"], {}, { repoRoot, fetchImpl, promptImpl }),
  );
  assert.equal(out.result, 0,
    `standard track must succeed; stdout was:\n${out.stdout}\nstderr:\n${out.stderr}`);
  assert.match(out.stdout, /Setup complete/);
  assert.equal(promptImpl.remaining(), 0,
    "every queued answer should have been consumed");
});

test("D2-d: main standard track — node version too old → exit 2", async (t) => {
  const repoRoot = tmpDir(t);
  fs.mkdirSync(path.join(repoRoot, ".harness"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, ".harness", "local-token"), "test-token");

  const fetchImpl = stubFetch((url) => {
    if (url.endsWith("/probe-node")) {
      return { status: 200, body: { ok: true, version: "18.0.0", satisfiesMinimum: false, minimumRequired: "24.0.0", error: null } };
    }
    return { status: 404, body: { error: "no stub" } };
  });

  // No prompts expected — node check fails before any input.
  const promptImpl = stubPrompt([]);

  const out = await captureOutput(() =>
    wizard.main(["--standard"], {}, { repoRoot, fetchImpl, promptImpl }),
  );
  assert.equal(out.result, 2);
  assert.match(out.stdout, /below required/);
});

test("D2-d: main standard track — server unreachable → exit 2 with actionable message", async (t) => {
  const repoRoot = tmpDir(t);
  fs.mkdirSync(path.join(repoRoot, ".harness"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, ".harness", "local-token"), "test-token");

  const fetchImpl = () => Promise.reject(new Error("ECONNREFUSED 127.0.0.1:4201"));
  const promptImpl = stubPrompt([]);

  const out = await captureOutput(() =>
    wizard.main(["--standard"], {}, { repoRoot, fetchImpl, promptImpl }),
  );
  assert.equal(out.result, 2);
  assert.match(out.stdout, /server unreachable/);
});

// ─────────────────────────────────────────────────────────────────
//  main — PUBLIC-SECTOR track happy path + acknowledgment gates
// ─────────────────────────────────────────────────────────────────

test("D2-d: main public-sector happy path → finalize agency profile", async (t) => {
  const repoRoot = tmpDir(t);
  fs.mkdirSync(path.join(repoRoot, ".harness"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, ".harness", "local-token"), "test-token");

  const fetchImpl = stubFetch((url, opts) => {
    if (url.endsWith("/probe-node")) {
      return { status: 200, body: { ok: true, version: "24.0.0", satisfiesMinimum: true, minimumRequired: "24.0.0", error: null } };
    }
    if (url.endsWith("/finalize")) {
      const body = JSON.parse(opts.body);
      return { status: 200, body: { ok: true, profile: body.profile, activeProfileId: body.setActive ? body.profile.id : null } };
    }
    return { status: 404, body: { error: "no stub" } };
  });

  // Public-sector track prompts:
  //   1. id                     (default "agency")
  //   2. label                  (default "Agency")
  //   3. dataClassification     (default "internal")
  //   4. egressPolicyId         (default "agency-default-egress")
  //   5. workspace label
  //   6. ackSandbox             (must be true)
  //   7. ackPii                 (warning only if false)
  //   8. ackRelease             (must be true)
  //   9. setActive
  const promptImpl = stubPrompt([
    "agency-x",          // id
    "Agency X",          // label
    "confidential",      // dataClassification
    "agency-x-egress",   // egressPolicyId
    "sandbox:agency-x",  // workspace label
    true,                // ackSandbox
    true,                // ackPii
    true,                // ackRelease
    true,                // setActive
  ]);

  const out = await captureOutput(() =>
    wizard.main(["--public-sector"], {}, { repoRoot, fetchImpl, promptImpl }),
  );
  assert.equal(out.result, 0,
    `public-sector track must succeed; stderr:\n${out.stderr}\nstdout:\n${out.stdout}`);
  assert.match(out.stdout, /Public-sector setup complete/);

  // The finalize call must carry agency-layer fields.
  const finalizeCall = fetchImpl.calls.find((c) => c.url.endsWith("/finalize"));
  const profile = JSON.parse(finalizeCall.opts.body).profile;
  assert.equal(profile.accountType, "agency_managed");
  assert.equal(profile.workspaceMode, "sandbox");
  assert.equal(profile.dataClassification, "confidential");
  assert.equal(profile.egressPolicyId, "agency-x-egress");
});

test("D2-d: main public-sector — sandbox NOT acknowledged → exit 1 (operator abort)", async (t) => {
  const repoRoot = tmpDir(t);
  fs.mkdirSync(path.join(repoRoot, ".harness"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, ".harness", "local-token"), "test-token");

  const fetchImpl = stubFetch((url) => {
    if (url.endsWith("/probe-node")) {
      return { status: 200, body: { ok: true, version: "24.0.0", satisfiesMinimum: true, minimumRequired: "24.0.0", error: null } };
    }
    return { status: 404, body: { error: "no stub" } };
  });

  const promptImpl = stubPrompt([
    "agency", "Agency", "internal", "egress-x", "sandbox:agency",
    false,  // ackSandbox = NO → abort
  ]);

  const out = await captureOutput(() =>
    wizard.main(["--public-sector"], {}, { repoRoot, fetchImpl, promptImpl }),
  );
  assert.equal(out.result, 1,
    "operator declining sandbox acknowledgment must abort with exit 1");
  assert.match(out.stdout, /sandbox runner must be configured/);

  // /finalize must NEVER fire when the operator declined.
  const finalizeCall = fetchImpl.calls.find((c) => c.url.endsWith("/finalize"));
  assert.equal(finalizeCall, undefined);
});

test("D2-d: main public-sector — release NOT acknowledged → exit 1", async (t) => {
  const repoRoot = tmpDir(t);
  fs.mkdirSync(path.join(repoRoot, ".harness"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, ".harness", "local-token"), "test-token");

  const fetchImpl = stubFetch((url) => {
    if (url.endsWith("/probe-node")) {
      return { status: 200, body: { ok: true, version: "24.0.0", satisfiesMinimum: true, minimumRequired: "24.0.0", error: null } };
    }
    return { status: 404, body: { error: "no stub" } };
  });

  const promptImpl = stubPrompt([
    "agency", "Agency", "internal", "egress-x", "sandbox:agency",
    true,   // ackSandbox
    true,   // ackPii
    false,  // ackRelease = NO → abort
  ]);

  const out = await captureOutput(() =>
    wizard.main(["--public-sector"], {}, { repoRoot, fetchImpl, promptImpl }),
  );
  assert.equal(out.result, 1);
  assert.match(out.stdout, /signed.+internal release/i);
});

// ─────────────────────────────────────────────────────────────────
//  Track override via flag overrides env
// ─────────────────────────────────────────────────────────────────

test("D2-d: --standard flag overrides HARNESS_DEPLOYMENT_PROFILE=public-sector env", async (t) => {
  const repoRoot = tmpDir(t);
  fs.mkdirSync(path.join(repoRoot, ".harness"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, ".harness", "local-token"), "tok");

  const fetchImpl = stubFetch((url) => {
    if (url.endsWith("/probe-node")) {
      // Send a Node-too-old to short-circuit so we don't have to
      // populate every prompt — we just need to confirm the standard
      // track fired (its first probe is /probe-node).
      return { status: 200, body: { ok: true, version: "18.0.0", satisfiesMinimum: false, minimumRequired: "24.0.0", error: null } };
    }
    return { status: 404, body: {} };
  });
  const promptImpl = stubPrompt([]);

  const out = await captureOutput(() =>
    wizard.main(["--standard"], { HARNESS_DEPLOYMENT_PROFILE: "public-sector" }, { repoRoot, fetchImpl, promptImpl }),
  );
  // Standard track header should appear (even though it then fails
  // on Node version), proving the flag override worked.
  assert.match(out.stdout, /Standard Track/);
});
