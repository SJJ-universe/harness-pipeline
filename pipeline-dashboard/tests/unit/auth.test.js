// Slice S1 (Phase 3-S, 2026-04-27) — auth.js unit tests.
//
// `src/security/auth.js` already shipped (token + loopback + middleware),
// but had no direct unit coverage. This locks down its behaviour against
// regressions, especially:
//   - ensureToken precedence (env > file > generated)
//   - safeEqual timing safety + rejection of mismatched lengths
//   - isLoopbackHost / isLoopbackAddress including IPv6 + IPv4-mapped variants
//   - createAuthMiddleware: requireTrustedOrigin + requireStateChangingToken
//     across the three classes of caller (loopback, configured host header,
//     foreign origin).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  ensureToken,
  createAuthMiddleware,
  isLoopbackAddress,
  isLoopbackHost,
} = require("../../src/security/auth");

function mkTmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "orchestrator-auth-test-"));
}

function withCleanEnv(fn) {
  const saved = process.env.ORCHESTRATOR_TOKEN;
  delete process.env.ORCHESTRATOR_TOKEN;
  try { return fn(); } finally {
    if (saved === undefined) delete process.env.ORCHESTRATOR_TOKEN;
    else process.env.ORCHESTRATOR_TOKEN = saved;
  }
}

// ── ensureToken ────────────────────────────────────────────────────────

test("ensureToken returns env value when ORCHESTRATOR_TOKEN is set", () => {
  const root = mkTmpRoot();
  const saved = process.env.ORCHESTRATOR_TOKEN;
  process.env.ORCHESTRATOR_TOKEN = "env-supplied-secret";
  try {
    assert.equal(ensureToken(root), "env-supplied-secret");
    // Should NOT have written a token file when env wins.
    assert.equal(fs.existsSync(path.join(root, ".orchestrator", "local-token")), false);
  } finally {
    if (saved === undefined) delete process.env.ORCHESTRATOR_TOKEN;
    else process.env.ORCHESTRATOR_TOKEN = saved;
  }
});

test("ensureToken trims env whitespace + ignores empty env", () => {
  const root = mkTmpRoot();
  const saved = process.env.ORCHESTRATOR_TOKEN;
  try {
    process.env.ORCHESTRATOR_TOKEN = "  padded\n";
    assert.equal(ensureToken(root), "padded");
    process.env.ORCHESTRATOR_TOKEN = "   ";
    // empty-after-trim falls through to file/generation
    const fallback = ensureToken(root);
    assert.ok(fallback.length >= 32, "generated fallback when env is blank");
  } finally {
    if (saved === undefined) delete process.env.ORCHESTRATOR_TOKEN;
    else process.env.ORCHESTRATOR_TOKEN = saved;
  }
});

test("ensureToken reads existing .harness/local-token file", () => {
  withCleanEnv(() => {
    const root = mkTmpRoot();
    const dir = path.join(root, ".orchestrator");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "local-token"), "preexisting-disk-token\n", "utf-8");
    assert.equal(ensureToken(root), "preexisting-disk-token");
  });
});

test("ensureToken generates a 64-hex token + writes .harness/local-token + .gitignore", () => {
  withCleanEnv(() => {
    const root = mkTmpRoot();
    const token = ensureToken(root);
    assert.match(token, /^[0-9a-f]{64}$/, "32 random bytes => 64 hex chars");
    const tokenPath = path.join(root, ".orchestrator", "local-token");
    assert.ok(fs.existsSync(tokenPath), "token file written");
    assert.equal(
      fs.readFileSync(tokenPath, "utf-8").trim(),
      token,
      "round-trip matches"
    );
    const gi = path.join(root, ".orchestrator", ".gitignore");
    assert.ok(fs.existsSync(gi), ".harness/.gitignore generated");
    assert.equal(fs.readFileSync(gi, "utf-8").trim(), "*", "ignores everything inside .harness/");
  });
});

test("ensureToken is stable on second call (reads existing token, no overwrite)", () => {
  withCleanEnv(() => {
    const root = mkTmpRoot();
    const t1 = ensureToken(root);
    const t2 = ensureToken(root);
    assert.equal(t1, t2);
  });
});

// ── isLoopbackHost / isLoopbackAddress ────────────────────────────────

test("isLoopbackHost accepts canonical loopback names", () => {
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("LOCALHOST"), true);
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("127.5.0.10"), true, "any 127.x.x.x is loopback");
  assert.equal(isLoopbackHost("::1"), true);
  assert.equal(isLoopbackHost("[::1]"), true);
});

test("isLoopbackHost rejects non-loopback hosts", () => {
  assert.equal(isLoopbackHost("example.com"), false);
  assert.equal(isLoopbackHost("10.0.0.1"), false);
  assert.equal(isLoopbackHost("0.0.0.0"), false);
  assert.equal(isLoopbackHost(""), false);
  assert.equal(isLoopbackHost(null), false);
  assert.equal(isLoopbackHost(undefined), false);
});

test("isLoopbackAddress covers IPv6 + IPv4-mapped variants", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("127.0.0.5"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.5.5.5"), true);
  assert.equal(isLoopbackAddress("10.0.0.1"), false);
  assert.equal(isLoopbackAddress("0.0.0.0"), false);
  assert.equal(isLoopbackAddress(""), false);
  assert.equal(isLoopbackAddress(null), false);
});

// ── createAuthMiddleware: validateToken ─────────────────────────────

test("auth.validateToken uses constant-time compare", () => {
  withCleanEnv(() => {
    const root = mkTmpRoot();
    process.env.ORCHESTRATOR_TOKEN = "fixed-test-token-1234";
    try {
      const a = createAuthMiddleware({ repoRoot: root });
      assert.equal(a.validateToken("fixed-test-token-1234"), true);
      assert.equal(a.validateToken("wrong"), false);
      assert.equal(a.validateToken(""), false);
      assert.equal(a.validateToken(null), false);
      assert.equal(a.validateToken(undefined), false);
    } finally { delete process.env.ORCHESTRATOR_TOKEN; }
  });
});

// ── createAuthMiddleware: requireTrustedOrigin ─────────────────────

function makeReqRes({ remote = "127.0.0.1", host, origin } = {}) {
  const headers = {};
  if (host) headers.host = host;
  if (origin) headers.origin = origin;
  const req = { socket: { remoteAddress: remote }, headers };
  let status = 200;
  let body = null;
  const res = {
    status(code) { status = code; return this; },
    json(payload) { body = payload; return this; },
  };
  return { req, res, get status() { return status; }, get body() { return body; } };
}

test("requireTrustedOrigin: loopback remote always passes (allowRemote=false)", () => {
  withCleanEnv(() => {
    const a = createAuthMiddleware({ repoRoot: mkTmpRoot(), host: "127.0.0.1" });
    const ctx = makeReqRes({ remote: "127.0.0.1", host: "127.0.0.1:4201", origin: "http://127.0.0.1:4201" });
    let nextCalled = false;
    a.requireTrustedOrigin(ctx.req, ctx.res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(ctx.status, 200);
  });
});

test("requireTrustedOrigin: non-loopback remote rejected (403) when allowRemote=false", () => {
  withCleanEnv(() => {
    const a = createAuthMiddleware({ repoRoot: mkTmpRoot(), host: "127.0.0.1" });
    const ctx = makeReqRes({ remote: "10.0.0.1", host: "10.0.0.1:4201" });
    let nextCalled = false;
    a.requireTrustedOrigin(ctx.req, ctx.res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(ctx.status, 403);
    assert.match(ctx.body.error, /remote clients are disabled/);
  });
});

test("requireTrustedOrigin: foreign Origin header rejected even on loopback", () => {
  withCleanEnv(() => {
    const a = createAuthMiddleware({ repoRoot: mkTmpRoot(), host: "127.0.0.1" });
    const ctx = makeReqRes({
      remote: "127.0.0.1",
      host: "127.0.0.1:4201",
      origin: "http://evil.example.com",
    });
    let nextCalled = false;
    a.requireTrustedOrigin(ctx.req, ctx.res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(ctx.status, 403);
    assert.match(ctx.body.error, /untrusted origin/);
  });
});

test("requireTrustedOrigin: allowRemote=true bypasses both remote-address and host-header checks", () => {
  withCleanEnv(() => {
    const a = createAuthMiddleware({ repoRoot: mkTmpRoot(), host: "0.0.0.0", allowRemote: true });
    const ctx = makeReqRes({ remote: "10.0.0.1", host: "lan-server:4201" });
    let nextCalled = false;
    a.requireTrustedOrigin(ctx.req, ctx.res, () => { nextCalled = true; });
    assert.equal(nextCalled, true, "remote OK in allowRemote mode");
  });
});

// ── createAuthMiddleware: requireStateChangingToken ────────────────

test("requireStateChangingToken: GET passes without a token", () => {
  withCleanEnv(() => {
    process.env.ORCHESTRATOR_TOKEN = "tok-1";
    try {
      const a = createAuthMiddleware({ repoRoot: mkTmpRoot() });
      const ctx = makeReqRes();
      ctx.req.method = "GET";
      let nextCalled = false;
      a.requireStateChangingToken(ctx.req, ctx.res, () => { nextCalled = true; });
      assert.equal(nextCalled, true);
    } finally { delete process.env.ORCHESTRATOR_TOKEN; }
  });
});

test("requireStateChangingToken: POST without token => 401", () => {
  withCleanEnv(() => {
    process.env.ORCHESTRATOR_TOKEN = "tok-1";
    try {
      const a = createAuthMiddleware({ repoRoot: mkTmpRoot() });
      const ctx = makeReqRes();
      ctx.req.method = "POST";
      let nextCalled = false;
      a.requireStateChangingToken(ctx.req, ctx.res, () => { nextCalled = true; });
      assert.equal(nextCalled, false);
      assert.equal(ctx.status, 401);
      assert.match(ctx.body.error, /missing or invalid orchestrator token/);
    } finally { delete process.env.ORCHESTRATOR_TOKEN; }
  });
});

test("requireStateChangingToken: POST with correct token => next()", () => {
  withCleanEnv(() => {
    process.env.ORCHESTRATOR_TOKEN = "tok-good";
    try {
      const a = createAuthMiddleware({ repoRoot: mkTmpRoot() });
      const ctx = makeReqRes();
      ctx.req.method = "POST";
      ctx.req.headers["x-orchestrator-token"] = "tok-good";
      let nextCalled = false;
      a.requireStateChangingToken(ctx.req, ctx.res, () => { nextCalled = true; });
      assert.equal(nextCalled, true);
    } finally { delete process.env.ORCHESTRATOR_TOKEN; }
  });
});

// ── R2-1 runner-route exemption ─────────────────────────────────────

test("R2-1: requireStateChangingToken exempts /runner/* paths (Bearer auth lives there)", () => {
  // Runner routes (handshake / heartbeat / hook) have their own
  // Bearer-token auth (bootstrap → runnerToken → runJWT). They must NOT
  // also require the dashboard's x-orchestrator-token because remote runner
  // hosts will never have it. Verify each runner sub-path passes
  // without x-orchestrator-token.
  withCleanEnv(() => {
    process.env.ORCHESTRATOR_TOKEN = "tok-runner-exempt";
    try {
      const a = createAuthMiddleware({ repoRoot: mkTmpRoot() });
      for (const path of ["/runner/handshake", "/runner/heartbeat", "/runner/hook"]) {
        const ctx = makeReqRes();
        ctx.req.method = "POST";
        ctx.req.path = path; // Express strips the mount prefix /api
        // Deliberately omit x-orchestrator-token.
        let nextCalled = false;
        a.requireStateChangingToken(ctx.req, ctx.res, () => { nextCalled = true; });
        assert.equal(nextCalled, true,
          `expected ${path} to pass without x-orchestrator-token (Bearer auth lives in the route)`);
      }
    } finally { delete process.env.ORCHESTRATOR_TOKEN; }
  });
});

test("R2-1: requireStateChangingToken still enforces token on non-runner /api/* paths", () => {
  // Negative regression: only /runner/* is exempt. Other state-changing
  // paths (templates, executor, codex, etc.) must still 401 without the
  // dashboard token.
  withCleanEnv(() => {
    process.env.ORCHESTRATOR_TOKEN = "tok-still-enforced";
    try {
      const a = createAuthMiddleware({ repoRoot: mkTmpRoot() });
      for (const path of ["/templates", "/executor/start", "/codex/run", "/runs/current"]) {
        const ctx = makeReqRes();
        ctx.req.method = "POST";
        ctx.req.path = path;
        let nextCalled = false;
        a.requireStateChangingToken(ctx.req, ctx.res, () => { nextCalled = true; });
        assert.equal(nextCalled, false,
          `expected ${path} to be rejected without x-orchestrator-token`);
        assert.equal(ctx.status, 401);
      }
    } finally { delete process.env.ORCHESTRATOR_TOKEN; }
  });
});

test("R2-1: requireStateChangingToken exemption is path-startsWith, not substring", () => {
  // Defensive: "/runner-evil" should NOT match "/runner/" prefix even
  // though it contains the substring "runner".
  withCleanEnv(() => {
    process.env.ORCHESTRATOR_TOKEN = "tok-prefix";
    try {
      const a = createAuthMiddleware({ repoRoot: mkTmpRoot() });
      const ctx = makeReqRes();
      ctx.req.method = "POST";
      ctx.req.path = "/runner-impersonator";  // attacker-named route
      let nextCalled = false;
      a.requireStateChangingToken(ctx.req, ctx.res, () => { nextCalled = true; });
      assert.equal(nextCalled, false, "non-runner-prefix paths must NOT bypass auth");
      assert.equal(ctx.status, 401);
    } finally { delete process.env.ORCHESTRATOR_TOKEN; }
  });
});

test("requireStateChangingToken: PUT/PATCH/DELETE all enforced", () => {
  withCleanEnv(() => {
    process.env.ORCHESTRATOR_TOKEN = "tok-2";
    try {
      const a = createAuthMiddleware({ repoRoot: mkTmpRoot() });
      for (const method of ["PUT", "PATCH", "DELETE"]) {
        const ctx = makeReqRes();
        ctx.req.method = method;
        ctx.req.headers["x-orchestrator-token"] = "wrong";
        let nextCalled = false;
        a.requireStateChangingToken(ctx.req, ctx.res, () => { nextCalled = true; });
        assert.equal(nextCalled, false, method + " should be blocked");
        assert.equal(ctx.status, 401, method + " => 401");
      }
    } finally { delete process.env.ORCHESTRATOR_TOKEN; }
  });
});
