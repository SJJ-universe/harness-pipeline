// Slice R2-1 (Phase D R2 deployment evaluation, 2026-04-28)
//
// Static lint for the R2 single-runner eval harness. We can't actually
// `docker compose up` from a unit test (no Docker daemon in the test
// runner) but we CAN keep these guarantees stable:
//
//   - .env.r2.example documents every required env var the compose file
//     references with `:?` (the "abort if missing" form).
//   - .env.r2.example never accidentally ships a real secret — every
//     value still uses the `change-me` placeholder convention.
//   - docker-compose.r2-single-runner.yml expresses the security
//     posture R2 is supposed to embody (cap_drop:ALL, no-new-privileges,
//     loopback-only port publish, /work/out tmpfs).
//   - Dockerfile.orchestrator runs as a non-root user.
//   - The runner image still excludes orchestrator code (regression
//     guard for Dockerfile.runner — adding a stray COPY of server.js
//     would silently widen the runner's surface).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const ENV_EXAMPLE = path.join(ROOT, ".env.r2.example");
const COMPOSE = path.join(ROOT, "docker-compose.r2-single-runner.yml");
const DOCKERFILE_ORCH = path.join(ROOT, "Dockerfile.orchestrator");
const DOCKERFILE_RUNNER = path.join(ROOT, "Dockerfile.runner");

function readFile(p) {
  return fs.readFileSync(p, "utf-8");
}

// ── .env.r2.example ───────────────────────────────────────────────

test("R2-1: .env.r2.example exists and is non-empty", () => {
  assert.ok(fs.existsSync(ENV_EXAMPLE), "expected .env.r2.example to exist");
  const text = readFile(ENV_EXAMPLE);
  assert.ok(text.length > 200, "template should have explanatory comments");
});

test("R2-1: .env.r2.example documents every var the compose file requires", () => {
  // The compose file uses `${VAR:?msg}` syntax to assert required vars.
  // Every such VAR must appear as a key in .env.r2.example so operators
  // know what to fill in.
  const compose = readFile(COMPOSE);
  const required = new Set();
  const re = /\$\{([A-Z_][A-Z0-9_]*):\?[^}]+\}/g;
  let m;
  while ((m = re.exec(compose)) !== null) required.add(m[1]);
  assert.ok(required.size > 0, "compose should declare at least one required var");
  const env = readFile(ENV_EXAMPLE);
  for (const name of required) {
    assert.match(
      env,
      new RegExp("^" + name + "=", "m"),
      "expected .env.r2.example to document " + name + " (asserted required by compose)",
    );
  }
});

test("R2-1: .env.r2.example values are all placeholders, never real secrets", () => {
  const env = readFile(ENV_EXAMPLE);
  for (const line of env.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const [, name, value] = m;
    // Allowed: empty, placeholder, or a known-default literal.
    const knownNonSecret = new Set([
      "HARNESS_REMOTE_MODE",       // "preview"
      "HARNESS_HOST_IDENTITY",     // "runner-r2-001"
      "HARNESS_RUN_ID",            // "rr-r2-eval-001"
      "HARNESS_RUN_JWT",           // "" (script fills)
    ]);
    if (knownNonSecret.has(name)) continue;
    assert.ok(
      value === "" || /change-me/.test(value),
      name + "=" + value + " — looks like a real secret in .env.r2.example",
    );
  }
});

test("R2-1: HARNESS_RUN_JWT in the template is empty (the up script fills it)", () => {
  const env = readFile(ENV_EXAMPLE);
  const m = env.match(/^HARNESS_RUN_JWT=(.*)$/m);
  assert.ok(m, "expected HARNESS_RUN_JWT key in template");
  assert.equal(m[1].trim(), "", "HARNESS_RUN_JWT must be blank in the template");
});

// ── docker-compose ────────────────────────────────────────────────

test("R2-1: compose declares orchestrator + runner + probe services", () => {
  const text = readFile(COMPOSE);
  for (const svc of ["orchestrator:", "runner:", "probe:"]) {
    assert.match(text, new RegExp("^\\s*" + svc, "m"), "expected service " + svc);
  }
});

test("R2-1: compose publishes orchestrator port on loopback only", () => {
  const text = readFile(COMPOSE);
  assert.match(text, /127\.0\.0\.1:4201:4201/,
    "orchestrator port must be published as 127.0.0.1:4201:4201 (NOT 0.0.0.0)");
  // Negative: there must NOT be a bare `4201:4201` mapping.
  assert.doesNotMatch(text, /^\s*-\s*"?4201:4201"?\s*$/m,
    "compose must NOT expose 4201 on all interfaces");
});

test("R2-1: compose drops all caps + no-new-privileges on every service", () => {
  const text = readFile(COMPOSE);
  // Every service we run must have these. Probe is profiled so it's a
  // separate service block — we still want the same posture.
  const services = text.split(/^\s{2}([a-z][a-z0-9_-]*):\s*$/m);
  // services after split: ["preamble", "orchestrator", "<body>", "runner", "<body>", "probe", "<body>", "rest"]
  let count = 0;
  for (let i = 1; i < services.length; i += 2) {
    const name = services[i];
    if (!["orchestrator", "runner", "probe"].includes(name)) continue;
    const body = services[i + 1];
    assert.match(body, /cap_drop:\s*\["?ALL"?\]/,
      name + " must declare cap_drop: [ALL]");
    assert.match(body, /no-new-privileges:\s*"?true"?/,
      name + " must declare no-new-privileges: true");
    count += 1;
  }
  assert.ok(count >= 3, "expected security posture on at least 3 services, got " + count);
});

test("R2-1: runner mounts /work/out as tmpfs with noexec", () => {
  const text = readFile(COMPOSE);
  assert.match(text, /\/work\/out:.*noexec/,
    "runner /work/out must be tmpfs + noexec (MG1 §2.1)");
});

test("R2-1: probe service is gated behind the 'probe' profile", () => {
  const text = readFile(COMPOSE);
  // Anchor the assertion to the probe service block.
  const probeBlock = text.match(/(?:^|\n)\s{2}probe:[\s\S]*?(?=\n\s{2}[a-z]|\nnetworks:|\nvolumes:|\Z)/);
  assert.ok(probeBlock, "expected probe service block");
  assert.match(probeBlock[0], /profiles:\s*\["?probe"?\]/,
    "probe must be opt-in via the 'probe' profile (default `up` does not start it)");
});

// ── Dockerfile.orchestrator ───────────────────────────────────────

test("R2-1: Dockerfile.orchestrator runs as non-root", () => {
  const text = readFile(DOCKERFILE_ORCH);
  assert.match(text, /USER\s+harness/, "expected `USER harness` in Dockerfile.orchestrator");
  // Check the user is created with a stable system UID, not root.
  assert.match(text, /useradd\s+--system\s+--uid\s+10100/,
    "Dockerfile.orchestrator should create UID 10100 for the non-root user");
});

test("R2-1: Dockerfile.orchestrator creates writable /app/runs + /app/.harness", () => {
  // Both directories must exist + be chowned BEFORE USER drops privs;
  // mkdirSync inside the Node runtime runs as the harness user and
  // would fail on root-owned /app.
  const text = readFile(DOCKERFILE_ORCH);
  assert.match(text, /mkdir\s+-p\s+\/app\/\.harness\s+\/app\/runs/);
  assert.match(text, /chown\s+-R\s+harness:harness\s+\/app\/\.harness\s+\/app\/runs/);
});

test("R2-1: Dockerfile.orchestrator uses HARNESS_ALLOW_REMOTE=true (binds 0.0.0.0)", () => {
  // The container can only be reached via the docker port mapping. The
  // mapping is loopback-pinned (verified above), so 0.0.0.0 inside the
  // container is safe.
  const text = readFile(DOCKERFILE_ORCH);
  assert.match(text, /ENV\s+HARNESS_ALLOW_REMOTE=true/);
});

// ── Dockerfile.runner regression guard ────────────────────────────

test("R2-1 (regression): Dockerfile.runner still EXCLUDES orchestrator code", () => {
  // The runner image should never grow to include server.js / executor /
  // public — that's the whole point of having a separate image. This
  // test is a regression guard against a careless future COPY.
  const text = readFile(DOCKERFILE_RUNNER);
  for (const banned of [/COPY\s+server\.js/, /COPY\s+executor/, /COPY\s+public/]) {
    assert.doesNotMatch(text, banned,
      "Dockerfile.runner must NOT include orchestrator code — found " + banned.source);
  }
});
