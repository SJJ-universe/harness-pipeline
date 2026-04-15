// P0-1 unit tests — env-loader + security (host / loopback / token / WS origin)
//
// Run: node executor/__p0-1-test.js

const fs = require("fs");
const os = require("os");
const path = require("path");

const { parseDotenv, loadDotenv } = require("./env-loader");
const {
  isLoopbackAddress,
  resolveBindHost,
  createTokenMiddleware,
  verifyWsOrigin,
} = require("./security");

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log("  ok  " + msg);
  } else {
    failed++;
    console.error("  FAIL  " + msg);
  }
}

function section(name) {
  console.log("\n[" + name + "]");
}

// ─── parseDotenv ────────────────────────────────────────────────────────
section("parseDotenv");

{
  const env = parseDotenv(
    [
      "# comment line",
      "",
      "HARNESS_TOKEN=abc123",
      "  HARNESS_HOST=0.0.0.0  ",
      "QUOTED=\"quoted value\"",
      "SINGLE='single quoted'",
      "EMPTY=",
      "WITH_EQ=a=b=c",
      "export HARNESS_PORT=4201",
    ].join("\n")
  );
  assert(env.HARNESS_TOKEN === "abc123", "plain KEY=VALUE");
  assert(env.HARNESS_HOST === "0.0.0.0", "trims surrounding whitespace");
  assert(env.QUOTED === "quoted value", "double-quoted stripped");
  assert(env.SINGLE === "single quoted", "single-quoted stripped");
  assert(env.EMPTY === "", "empty value kept as empty string");
  assert(env.WITH_EQ === "a=b=c", "value containing = preserved");
  assert(env.HARNESS_PORT === "4201", "export prefix tolerated");
  assert(!("# comment line" in env), "comments skipped");
}

// ─── loadDotenv idempotency + no override ───────────────────────────────
section("loadDotenv");

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p01-env-"));
  const envFile = path.join(tmpDir, ".env");
  fs.writeFileSync(envFile, "P01_FRESH=from_file\nP01_EXISTING=file_value\n");

  const before = process.env.P01_EXISTING;
  process.env.P01_EXISTING = "already_set";
  delete process.env.P01_FRESH;

  loadDotenv(tmpDir);
  assert(process.env.P01_FRESH === "from_file", "loads new key into process.env");
  assert(
    process.env.P01_EXISTING === "already_set",
    "does not override existing process.env value"
  );

  delete process.env.P01_FRESH;
  process.env.P01_EXISTING = before;
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ─── isLoopbackAddress ──────────────────────────────────────────────────
section("isLoopbackAddress");

assert(isLoopbackAddress("127.0.0.1"), "IPv4 127.0.0.1");
assert(isLoopbackAddress("::1"), "IPv6 ::1");
assert(isLoopbackAddress("::ffff:127.0.0.1"), "IPv4-mapped IPv6 loopback");
assert(!isLoopbackAddress("192.168.1.10"), "LAN IPv4 rejected");
assert(!isLoopbackAddress("10.0.0.5"), "RFC1918 rejected");
assert(!isLoopbackAddress("8.8.8.8"), "public IPv4 rejected");
assert(!isLoopbackAddress(""), "empty string rejected");
assert(!isLoopbackAddress(null), "null rejected");

// ─── resolveBindHost ────────────────────────────────────────────────────
section("resolveBindHost");

{
  const r1 = resolveBindHost({});
  assert(r1.host === "127.0.0.1", "default host = 127.0.0.1");
  assert(r1.loopbackOnly === true, "default = loopback-only");

  const r2 = resolveBindHost({ HARNESS_HOST: "0.0.0.0" });
  assert(r2.host === "0.0.0.0", "HARNESS_HOST=0.0.0.0 override");
  assert(r2.loopbackOnly === false, "0.0.0.0 is not loopback-only");

  const r3 = resolveBindHost({ HARNESS_HOST: "127.0.0.1" });
  assert(r3.loopbackOnly === true, "explicit 127.0.0.1 stays loopback-only");

  const r4 = resolveBindHost({ HARNESS_HOST: "192.168.1.10" });
  assert(r4.host === "192.168.1.10", "LAN IP override");
  assert(r4.loopbackOnly === false, "LAN IP is not loopback-only");
}

// ─── createTokenMiddleware ──────────────────────────────────────────────
section("createTokenMiddleware");

function runMiddleware(mw, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      _json: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this._json = body;
        resolve({ called: "json", statusCode: this.statusCode, body });
      },
    };
    mw(req, res, () => resolve({ called: "next", statusCode: res.statusCode }));
  });
}

(async () => {
  // Case A: no token configured → guard disabled, all requests pass
  {
    const mw = createTokenMiddleware({ getToken: () => "" });
    const r = await runMiddleware(mw, {
      socket: { remoteAddress: "203.0.113.5" },
      headers: {},
      method: "POST",
      originalUrl: "/api/hook",
    });
    assert(r.called === "next", "no token configured → non-loopback allowed");
  }

  // Case B: token configured, loopback request, no header → allowed
  {
    const mw = createTokenMiddleware({ getToken: () => "secret" });
    const r = await runMiddleware(mw, {
      socket: { remoteAddress: "127.0.0.1" },
      headers: {},
      method: "POST",
      originalUrl: "/api/hook",
    });
    assert(r.called === "next", "loopback bypasses token requirement");
  }

  // Case C: token configured, remote request, no header → 401
  {
    const mw = createTokenMiddleware({ getToken: () => "secret" });
    const r = await runMiddleware(mw, {
      socket: { remoteAddress: "203.0.113.5" },
      headers: {},
      method: "POST",
      originalUrl: "/api/hook",
    });
    assert(r.called === "json", "remote w/o token rejected");
    assert(r.statusCode === 401, "401 status");
  }

  // Case D: token configured, remote request, wrong header → 401
  {
    const mw = createTokenMiddleware({ getToken: () => "secret" });
    const r = await runMiddleware(mw, {
      socket: { remoteAddress: "203.0.113.5" },
      headers: { "x-harness-token": "wrong" },
      method: "POST",
      originalUrl: "/api/hook",
    });
    assert(r.called === "json" && r.statusCode === 401, "wrong token rejected");
  }

  // Case E: token configured, remote request, correct header → allowed
  {
    const mw = createTokenMiddleware({ getToken: () => "secret" });
    const r = await runMiddleware(mw, {
      socket: { remoteAddress: "203.0.113.5" },
      headers: { "x-harness-token": "secret" },
      method: "POST",
      originalUrl: "/api/hook",
    });
    assert(r.called === "next", "correct X-Harness-Token header allowed");
  }

  // Case F: token configured, remote request, correct query param → allowed
  //         (fallback for WS upgrade / browser contexts that can't set headers)
  {
    const mw = createTokenMiddleware({ getToken: () => "secret" });
    const r = await runMiddleware(mw, {
      socket: { remoteAddress: "203.0.113.5" },
      headers: {},
      query: { token: "secret" },
      method: "POST",
      originalUrl: "/api/hook",
    });
    assert(r.called === "next", "correct ?token= query param allowed");
  }

  // Case G: IPv6-mapped loopback bypass
  {
    const mw = createTokenMiddleware({ getToken: () => "secret" });
    const r = await runMiddleware(mw, {
      socket: { remoteAddress: "::ffff:127.0.0.1" },
      headers: {},
      method: "POST",
      originalUrl: "/api/hook",
    });
    assert(r.called === "next", "::ffff:127.0.0.1 treated as loopback");
  }

  // ─── verifyWsOrigin ───────────────────────────────────────────────────
  section("verifyWsOrigin");

  // Loopback client, no origin (Node.js native WebSocket client) → allow
  assert(
    verifyWsOrigin({
      req: {
        socket: { remoteAddress: "127.0.0.1" },
        headers: {},
      },
      getToken: () => "",
    }) === true,
    "loopback + no Origin → allow (Node-side ws client)"
  );

  // Loopback + browser Origin → allow (regardless of Origin value)
  assert(
    verifyWsOrigin({
      req: {
        socket: { remoteAddress: "127.0.0.1" },
        headers: { origin: "http://localhost:4200" },
      },
      getToken: () => "",
    }) === true,
    "loopback client allowed regardless of Origin"
  );

  // Non-loopback + no token configured → allow (backwards-compat for LAN)
  assert(
    verifyWsOrigin({
      req: {
        socket: { remoteAddress: "192.168.1.10" },
        headers: {},
      },
      getToken: () => "",
    }) === true,
    "no token configured → LAN allowed"
  );

  // Non-loopback + token configured + no token in URL → reject
  assert(
    verifyWsOrigin({
      req: {
        socket: { remoteAddress: "192.168.1.10" },
        headers: {},
        url: "/",
      },
      getToken: () => "secret",
    }) === false,
    "LAN + token configured + missing token → reject"
  );

  // Non-loopback + token configured + correct token in URL → allow
  assert(
    verifyWsOrigin({
      req: {
        socket: { remoteAddress: "192.168.1.10" },
        headers: {},
        url: "/?token=secret",
      },
      getToken: () => "secret",
    }) === true,
    "LAN + correct ?token= in WS URL → allow"
  );

  // Non-loopback + token configured + wrong token → reject
  assert(
    verifyWsOrigin({
      req: {
        socket: { remoteAddress: "192.168.1.10" },
        headers: {},
        url: "/?token=wrong",
      },
      getToken: () => "secret",
    }) === false,
    "LAN + wrong ?token= → reject"
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
