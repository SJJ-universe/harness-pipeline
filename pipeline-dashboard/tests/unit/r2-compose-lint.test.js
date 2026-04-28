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
const COMPOSE_STRICT = path.join(ROOT, "docker-compose.r2-strict.override.yml");
const DOCKERFILE_ORCH = path.join(ROOT, "Dockerfile.orchestrator");
const DOCKERFILE_RUNNER = path.join(ROOT, "Dockerfile.runner");
const PROBE_SH = path.join(ROOT, "scripts", "r2-probe-egress.sh");
const PROBE_PS1 = path.join(ROOT, "scripts", "r2-probe-egress.ps1");
const MONITOR_SH = path.join(ROOT, "scripts", "r2-monitor-probe.sh");
const MONITOR_PS1 = path.join(ROOT, "scripts", "r2-monitor-probe.ps1");
const LIFECYCLE_SH = path.join(ROOT, "scripts", "r2-lifecycle-probe.sh");
const LIFECYCLE_PS1 = path.join(ROOT, "scripts", "r2-lifecycle-probe.ps1");
const BRIDGE_SH = path.join(ROOT, "scripts", "r2-5-bridge-probe.sh");
const BRIDGE_PS1 = path.join(ROOT, "scripts", "r2-5-bridge-probe.ps1");

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
      "HARNESS_REMOTE_MODE",          // "preview"
      "HARNESS_REMOTE_BRIDGE_MODE",   // R2.5-c: "off" / "report" / "dispatch"
      "HARNESS_HOST_IDENTITY",        // "runner-r2-001"
      "HARNESS_RUN_ID",               // "rr-r2-eval-001"
      "HARNESS_RUN_JWT",              // "" (script fills)
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
  // chown covers the writable workspaces. /app/dashboard is included so
  // any boot-time tooling can write its own scratch state too.
  assert.match(text, /chown\s+-R\s+harness:harness\s+\/app\/\.harness\s+\/app\/runs/);
});

test("R2-1: Dockerfile.orchestrator places server.js under /app/dashboard (REPO_ROOT = /app)", () => {
  // server.js does `REPO_ROOT = path.resolve(__dirname, "..")`. If we put
  // server.js at /app/server.js, REPO_ROOT resolves to / and the runs
  // dir becomes /runs (unwritable). Putting server.js at /app/dashboard
  // gives REPO_ROOT = /app + runsDir = /app/runs which matches the
  // mkdir + chown above.
  const text = readFile(DOCKERFILE_ORCH);
  assert.match(text, /WORKDIR\s+\/app\/dashboard/,
    "WORKDIR must be /app/dashboard so REPO_ROOT resolves to /app");
  assert.match(text, /ENTRYPOINT\s+\["node",\s*"\/app\/dashboard\/server\.js"\]/,
    "ENTRYPOINT must point at /app/dashboard/server.js");
});

test("R2-1: Dockerfile.orchestrator uses HARNESS_ALLOW_REMOTE=1 (binds 0.0.0.0)", () => {
  // The container can only be reached via the docker port mapping. The
  // mapping is loopback-pinned (verified above), so 0.0.0.0 inside the
  // container is safe.
  // server.js does `ALLOW_REMOTE = process.env.HARNESS_ALLOW_REMOTE === "1"`
  // exactly — the literal string "1" is required (not "true" / on / yes).
  const text = readFile(DOCKERFILE_ORCH);
  assert.match(text, /ENV\s+HARNESS_ALLOW_REMOTE=1\b/);
});

test("R2-1: compose passes HARNESS_ALLOW_REMOTE=\"1\" to orchestrator", () => {
  // Same rationale as the Dockerfile assertion. Compose env values
  // override Dockerfile ENV, so this is the value the running process
  // actually sees.
  const text = readFile(COMPOSE);
  assert.match(text, /HARNESS_ALLOW_REMOTE:\s*"1"/);
});

// ── R2-4 strict override + probe scripts (rebased on R3-a topology) ─

test("R2-4 / R3-a: strict override exists and flips harness-r2-runner to internal:true", () => {
  assert.ok(fs.existsSync(COMPOSE_STRICT),
    "expected docker-compose.r2-strict.override.yml");
  const text = readFile(COMPOSE_STRICT);
  // R3-a renamed the single bridge `harness-r2` to two bridges: the
  // operator-facing one (NOT internal) and the runner-internal one
  // (which becomes internal:true here). The single behavioural change
  // vs. the base file is internal:true on harness-r2-runner ONLY.
  assert.match(text, /networks:[\s\S]*?harness-r2-runner:[\s\S]*?internal:\s*true/m,
    "strict override must set internal: true on harness-r2-runner");
  // Negative regression: the OLD single-network name `harness-r2:` (without
  // the `-runner` suffix) must not appear with internal:true — that was
  // the R2-4 topology that broke the dashboard host port.
  assert.doesNotMatch(text, /^\s{2}harness-r2:\s*\n[\s\S]{0,200}internal:\s*true/m,
    "old single-bridge name harness-r2 should not be the internal target — use harness-r2-runner");
});

test("R2-4: strict override forces probe profile to active", () => {
  // The base file gates the probe behind profiles:["probe"], so the
  // default `up` skips it. Strict mode without the probe has no
  // observable evidence, so the override resets profiles to []
  // (always start).
  const text = readFile(COMPOSE_STRICT);
  assert.match(text, /probe:\s*\n\s*profiles:\s*\[\]/m,
    "strict override must clear the probe profile gate (profiles: [])");
});

test("R2-4: r2-probe-egress.{sh,ps1} both exist + cover the same six targets", () => {
  assert.ok(fs.existsSync(PROBE_SH), "expected scripts/r2-probe-egress.sh");
  assert.ok(fs.existsSync(PROBE_PS1), "expected scripts/r2-probe-egress.ps1");
  const targets = [
    "169.254.169.254",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "www.google.com",
    "orchestrator:4201",
  ];
  const sh = readFile(PROBE_SH);
  const ps1 = readFile(PROBE_PS1);
  for (const t of targets) {
    assert.ok(sh.includes(t), `expected ${t} in r2-probe-egress.sh`);
    assert.ok(ps1.includes(t), `expected ${t} in r2-probe-egress.ps1`);
  }
});

// ── R2-3 monitor probe scripts ────────────────────────────────────

test("R2-3: r2-monitor-probe.{sh,ps1} both exist", () => {
  assert.ok(fs.existsSync(MONITOR_SH), "expected scripts/r2-monitor-probe.sh");
  assert.ok(fs.existsSync(MONITOR_PS1), "expected scripts/r2-monitor-probe.ps1");
});

test("R2-3: monitor probe targets the four documented anchors (G5 + R1-k2)", () => {
  // Each anchor is a runtime endpoint or ledger key the script must
  // hit. The anchors come from MG1 §3 (envelope `origin`) + MF1 §3.2
  // (bootstrap.runners[] / activeChildren[]) + R1-k2 (audit chain).
  const anchors = [
    "/api/monitor/bootstrap",
    "/api/monitor/runs/default",
    "runner_hook_routed",
    "activeChildren",
  ];
  const sh = readFile(MONITOR_SH);
  const ps1 = readFile(MONITOR_PS1);
  for (const a of anchors) {
    assert.ok(sh.includes(a), `expected ${a} in r2-monitor-probe.sh`);
    assert.ok(ps1.includes(a), `expected ${a} in r2-monitor-probe.ps1`);
  }
});

// ── R2-5 lifecycle probe ──────────────────────────────────────────

test("R2-5: r2-lifecycle-probe.{sh,ps1} both exist", () => {
  assert.ok(fs.existsSync(LIFECYCLE_SH), "expected scripts/r2-lifecycle-probe.sh");
  assert.ok(fs.existsSync(LIFECYCLE_PS1), "expected scripts/r2-lifecycle-probe.ps1");
});

test("R2-5: lifecycle probe checks /work/out tmpfs+noexec, sequential cycles, bounce reconnect", () => {
  const checks = [
    "/work/out",
    "tmpfs",
    "noexec",
    "agent_started",
    "agent_stopped",
    "ws open",
  ];
  const sh = readFile(LIFECYCLE_SH);
  const ps1 = readFile(LIFECYCLE_PS1);
  for (const c of checks) {
    assert.ok(sh.includes(c), `expected ${c} in r2-lifecycle-probe.sh`);
    assert.ok(ps1.includes(c), `expected ${c} in r2-lifecycle-probe.ps1`);
  }
});

test("R2-5: Dockerfile.runner does NOT pre-create /work/in (operator mounts it ro)", () => {
  // Pre-fix, /work/in was created in the image and chowned to harness,
  // making it a writable scratch directory by default. R2-5 evidence
  // requires the path to be either absent (no operator mount yet) or
  // read-only (operator mount), never writable. We assert /work/in is
  // not in the mkdir line.
  const text = readFile(DOCKERFILE_RUNNER);
  assert.doesNotMatch(text, /mkdir\s+-p[^\n]*\/work\/in/,
    "Dockerfile.runner must NOT pre-create /work/in (writable by default)");
  // Positive: /work/out IS still pre-created (and chowned).
  assert.match(text, /mkdir\s+-p\s+\/work\/out/,
    "Dockerfile.runner must still pre-create /work/out");
});

// ── R2.5-e bridge probe ────────────────────────────────────────────

test("R2.5-e: r2-5-bridge-probe.{sh,ps1} both exist", () => {
  assert.ok(fs.existsSync(BRIDGE_SH), "expected scripts/r2-5-bridge-probe.sh");
  assert.ok(fs.existsSync(BRIDGE_PS1), "expected scripts/r2-5-bridge-probe.ps1");
});

test("R2.5-e: bridge probe verifies the four R2.5 audit verbs + monitor 200", () => {
  // The probe must hit each anchor in turn; their string presence is
  // the regression guard against someone "simplifying" the script and
  // dropping coverage.
  const anchors = [
    "runner_hook_dispatched",
    "runner_hook_rejected",
    "runner_hook_sanitized",
    "/api/monitor/runs/",
    "HARNESS_REMOTE_BRIDGE_MODE",
    "remoteHookDispatched",
  ];
  const sh = readFile(BRIDGE_SH);
  const ps1 = readFile(BRIDGE_PS1);
  for (const a of anchors) {
    assert.ok(sh.includes(a), `expected ${a} in r2-5-bridge-probe.sh`);
    assert.ok(ps1.includes(a), `expected ${a} in r2-5-bridge-probe.ps1`);
  }
});

test("R2.5-e: compose passes HARNESS_REMOTE_BRIDGE_MODE through to orchestrator env", () => {
  // The bridge mode is operator-controlled via env; compose must
  // forward it to the container and default to "off" when unset.
  const text = readFile(COMPOSE);
  assert.match(text, /HARNESS_REMOTE_BRIDGE_MODE:\s*"\$\{HARNESS_REMOTE_BRIDGE_MODE:-off\}"/,
    "compose must forward HARNESS_REMOTE_BRIDGE_MODE with default :-off");
});

test("R2.5-e: .env.r2.example documents HARNESS_REMOTE_BRIDGE_MODE", () => {
  const env = readFile(ENV_EXAMPLE);
  assert.match(env, /^HARNESS_REMOTE_BRIDGE_MODE=/m,
    ".env.r2.example must document the bridge-mode knob for operators");
  // The default suggested value should be "off" — operators upgrade
  // to report → dispatch deliberately.
  assert.match(env, /HARNESS_REMOTE_BRIDGE_MODE=off\b/,
    "default suggested value should be off (safest upgrade path)");
});

// ── R3-a two-network topology (closes R2-4 dashboard host port gap) ─

test("R3-a: base compose declares two networks (operator + runner) with explicit names", () => {
  const text = readFile(COMPOSE);
  // Operator-facing bridge — host port mapping path. Non-internal.
  assert.match(text, /^\s{2}harness-r2-operator:/m,
    "expected harness-r2-operator network in base compose");
  assert.match(
    text,
    /harness-r2-operator:[\s\S]*?name:\s*harness-r2-operator-network/,
    "harness-r2-operator must have explicit name harness-r2-operator-network",
  );
  // Runner-internal bridge — internal-eligible (strict override flips it).
  assert.match(text, /^\s{2}harness-r2-runner:/m,
    "expected harness-r2-runner network in base compose");
  assert.match(
    text,
    /harness-r2-runner:[\s\S]*?name:\s*harness-r2-runner-network/,
    "harness-r2-runner must have explicit name harness-r2-runner-network",
  );
  // Negative regression: the old single-bridge declaration `harness-r2:`
  // (no -operator / -runner suffix) must no longer appear at the top
  // level networks block.
  assert.doesNotMatch(text, /\nnetworks:\s*\n\s{2}harness-r2:\s*\n/,
    "old single-bridge name harness-r2 should be removed from base compose");
});

test("R3-a: orchestrator dual-homed on operator + runner networks", () => {
  const text = readFile(COMPOSE);
  // Find the orchestrator service block.
  const orchBlock = text.match(
    /^\s{2}orchestrator:[\s\S]*?(?=\n\s{2}[a-z][a-z0-9_-]*:\s*\n|\nnetworks:|\nvolumes:|\Z)/m,
  );
  assert.ok(orchBlock, "expected orchestrator service block");
  assert.match(orchBlock[0], /networks:[\s\S]*?-\s*harness-r2-operator/,
    "orchestrator must attach to harness-r2-operator (host port path)");
  assert.match(orchBlock[0], /networks:[\s\S]*?-\s*harness-r2-runner/,
    "orchestrator must attach to harness-r2-runner (intra-bridge with runner)");
});

test("R3-a: runner attached ONLY to harness-r2-runner (not operator)", () => {
  const text = readFile(COMPOSE);
  const runnerBlock = text.match(
    /^\s{2}runner:[\s\S]*?(?=\n\s{2}[a-z][a-z0-9_-]*:\s*\n|\nnetworks:|\nvolumes:|\Z)/m,
  );
  assert.ok(runnerBlock, "expected runner service block");
  assert.match(runnerBlock[0], /networks:[\s\S]*?-\s*harness-r2-runner/,
    "runner must attach to harness-r2-runner");
  assert.doesNotMatch(runnerBlock[0], /networks:[\s\S]*?-\s*harness-r2-operator/,
    "runner must NOT attach to operator bridge — egress isolation gone if it does");
});

test("R3-a: probe attached ONLY to harness-r2-runner (probe tests runner-bridge isolation)", () => {
  const text = readFile(COMPOSE);
  const probeBlock = text.match(
    /^\s{2}probe:[\s\S]*?(?=\n\s{2}[a-z][a-z0-9_-]*:\s*\n|\nnetworks:|\nvolumes:|\Z)/m,
  );
  assert.ok(probeBlock, "expected probe service block");
  assert.match(probeBlock[0], /networks:[\s\S]*?-\s*harness-r2-runner/,
    "probe must attach to harness-r2-runner (where the runner sits)");
  assert.doesNotMatch(probeBlock[0], /networks:[\s\S]*?-\s*harness-r2-operator/,
    "probe must NOT attach to operator bridge — probe is supposed to test what the runner sees");
});

test("R3-a: strict override does NOT mark harness-r2-operator as internal", () => {
  // The whole point of R3-a: operator bridge stays open so the host port
  // mapping survives strict mode. If the override accidentally flips
  // operator to internal:true, the dashboard becomes unreachable from
  // the host again — same regression R3-a is supposed to close.
  const text = readFile(COMPOSE_STRICT);
  // If the override declares the operator network at all, it must NOT
  // set internal:true on it. The simplest implementation just doesn't
  // declare the operator network at top level — but if a future
  // refactor adds a declaration (e.g. labels, custom IPAM), this guard
  // still holds.
  if (/^\s{2}harness-r2-operator:/m.test(text)) {
    const operBlock = text.match(
      /^\s{2}harness-r2-operator:[\s\S]*?(?=\n\s{2}[a-z][a-z0-9_-]*:\s*\n|\Z)/m,
    );
    if (operBlock) {
      assert.doesNotMatch(operBlock[0], /internal:\s*true/,
        "operator bridge must stay non-internal — dashboard host port survives strict mode");
    }
  }
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
