// Slice R1-f (Phase D R1, 2026-04-28) — Dockerfile.runner lint tests.
//
// We deliberately don't run `docker build` here:
//   - it requires the Docker daemon, which CI runners may or may not have
//   - it adds 30+ seconds to the unit suite for what's effectively a syntax check
//
// Instead, we lint the Dockerfile to enforce the MG1 §2 + RFC §10.1
// security posture so a future "just COPY everything" regression is caught
// in seconds.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DOCKERFILE = path.resolve(__dirname, "../../Dockerfile.runner");
const DOCKERIGNORE = path.resolve(__dirname, "../../.dockerignore");

function readDockerfile() { return fs.readFileSync(DOCKERFILE, "utf8"); }
function readDockerignore() { return fs.readFileSync(DOCKERIGNORE, "utf8"); }

test("R1-f: Dockerfile.runner is multi-stage (deps + runtime)", () => {
  const df = readDockerfile();
  assert.match(df, /^FROM\s+node:24-bookworm-slim\s+AS\s+deps\b/m);
  assert.match(df, /^FROM\s+node:24-bookworm-slim\s+AS\s+runtime\b/m);
});

test("R1-f: Dockerfile.runner pins every FROM to node:24-bookworm-slim", () => {
  const df = readDockerfile();
  const fromLines = df.match(/^FROM\s+\S+/gm) || [];
  assert.ok(fromLines.length >= 2, "expected at least two FROM lines");
  for (const line of fromLines) {
    assert.match(line, /node:24-bookworm-slim\b/, `unpinned base: ${JSON.stringify(line)}`);
  }
});

test("R1-f: Dockerfile.runner runs as non-root UID 10001", () => {
  const df = readDockerfile();
  // Either `USER 10001` or `USER 10001:10001` is acceptable.
  assert.match(df, /^USER\s+10001(:10001)?\s*$/m);
});

test("R1-f: Dockerfile.runner uses npm ci --omit=dev --ignore-scripts", () => {
  const df = readDockerfile();
  // Both flags must appear on the deps install line. --omit=dev keeps
  // devDependencies out; --ignore-scripts neutralizes a malicious
  // postinstall hook in any transitive dep.
  const npmCi = df.match(/^RUN\s+npm\s+ci[^\n]*$/m);
  assert.ok(npmCi, "expected a `RUN npm ci ...` line");
  assert.match(npmCi[0], /--omit=dev\b/);
  assert.match(npmCi[0], /--ignore-scripts\b/);
});

test("R1-f: Dockerfile.runner does NOT slurp the whole repo (no `COPY . .`)", () => {
  const df = readDockerfile();
  assert.doesNotMatch(df, /^COPY\s+\.\s+\.\s*$/m);
  assert.doesNotMatch(df, /^COPY\s+\.\s+\/app\s*$/m);
});

test("R1-f: Dockerfile.runner does NOT pull orchestrator code", () => {
  const df = readDockerfile();
  // These belong to the orchestrator process, not the runner.
  assert.doesNotMatch(df, /\bCOPY[^\n]*\bserver\.js\b/);
  assert.doesNotMatch(df, /\bCOPY[^\n]*\bexecutor\b/);
  assert.doesNotMatch(df, /\bCOPY[^\n]*\bpublic\b/);
  // Runner needs jwt + evidenceLedger but explicitly nothing else from
  // src/runtime — guard against a future "while we're at it" addition.
  assert.doesNotMatch(df, /\bCOPY[^\n]*src\/runtime\/runnerRegistry\.js/);
});

test("R1-f: Dockerfile.runner has an explicit ENTRYPOINT (no implicit shell)", () => {
  const df = readDockerfile();
  assert.match(df, /^ENTRYPOINT\s+\[/m);
});

test("R1-f: Dockerfile.runner sets NODE_ENV=production", () => {
  const df = readDockerfile();
  assert.match(df, /^ENV\s+NODE_ENV=production\s*$/m);
});

// ── .dockerignore ────────────────────────────────────────────────

test("R1-f: .dockerignore excludes tests, docs, public, .git, node_modules", () => {
  const di = readDockerignore();
  for (const needle of ["tests", "docs", "public", ".git", "node_modules"]) {
    assert.match(di, new RegExp(`^${needle.replace(/\./g, "\\.")}\\s*$`, "m"),
      `expected .dockerignore to exclude ${needle}`);
  }
});

test("R1-f: .dockerignore excludes the orchestrator entrypoint server.js", () => {
  const di = readDockerignore();
  assert.match(di, /^server\.js\s*$/m);
});
