// Slice READINESS-BOOT-FAILURE-CONFIG (Phase 2 v2 follow-up, 2026-05-05) —
// verify that scripts/readiness-report.js fails fast with a CONFIG-tier
// exit (exit 4) when the orchestrator server cannot be spawned. The
// ORCHESTRATOR_READINESS_FORCE_BOOT_ERROR env hook makes the test
// deterministic without depending on platform sandbox behavior.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "readiness-report.js");

function runReadiness(args, envExtra = {}) {
  const env = Object.assign({}, process.env, envExtra);
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    env,
    timeout: 15000,
  });
}

// ── Default behavior: spawn failure → exit 4 + JSON CONFIG ─────

test("BOOT-FAILURE-CONFIG: forced EPERM produces exit 4 + configError JSON", () => {
  const r = runReadiness(["--json"], { ORCHESTRATOR_READINESS_FORCE_BOOT_ERROR: "EPERM" });
  assert.equal(r.status, 4,
    "exit code must be 4 (CONFIG) — got " + r.status);
  const out = JSON.parse(r.stdout);
  assert.equal(out.configError, true);
  assert.equal(out.exit, 4);
  assert.equal(out.total, null,
    "total must be null in CONFIG mode (no legitimate score)");
  assert.equal(out.max, 18);
  assert.ok(out.boot, "boot meta must be present");
  assert.equal(out.boot.code, "EPERM");
  assert.equal(out.boot.kind, "spawn_error");
  assert.equal(out.boot.cause, "permission_denied");
  assert.match(out.boot.suggestion, /normal terminal/i);
  assert.match(out.boot.suggestion, /--no-spawn/);
  assert.match(out.boot.suggestion, /--allow-static-fallback/);
});

test("BOOT-FAILURE-CONFIG: forced EACCES classifies as permission_denied", () => {
  const r = runReadiness(["--json"], { ORCHESTRATOR_READINESS_FORCE_BOOT_ERROR: "EACCES" });
  assert.equal(r.status, 4);
  const out = JSON.parse(r.stdout);
  assert.equal(out.boot.cause, "permission_denied");
});

test("BOOT-FAILURE-CONFIG: forced ENOENT classifies as node_binary_missing", () => {
  const r = runReadiness(["--json"], { ORCHESTRATOR_READINESS_FORCE_BOOT_ERROR: "ENOENT" });
  assert.equal(r.status, 4);
  const out = JSON.parse(r.stdout);
  assert.equal(out.boot.cause, "node_binary_missing");
  assert.match(out.boot.suggestion, /node.+PATH/i);
});

test("BOOT-FAILURE-CONFIG: forced unknown error code classifies as spawn_rejected", () => {
  const r = runReadiness(["--json"], { ORCHESTRATOR_READINESS_FORCE_BOOT_ERROR: "ESOMETHINGWEIRD" });
  assert.equal(r.status, 4);
  const out = JSON.parse(r.stdout);
  assert.equal(out.boot.cause, "spawn_rejected");
});

// ── Human-readable mode ──────────────────────────────────────

test("BOOT-FAILURE-CONFIG: human mode emits CONFIG header to stderr", () => {
  const r = runReadiness([], { ORCHESTRATOR_READINESS_FORCE_BOOT_ERROR: "EPERM" });
  assert.equal(r.status, 4);
  // stderr carries the CONFIG narrative — stdout stays clean for parsers
  assert.match(r.stderr, /CONFIG/);
  assert.match(r.stderr, /해당 환경에서 자식 Node 프로세스를 띄우지 못했습니다/);
  assert.match(r.stderr, /일반 로컬 터미널 또는 CI에서는 정상 동작/);
  assert.match(r.stderr, /What to do/);
  // Anchor: no normal score table on stdout
  assert.doesNotMatch(r.stdout, /Orchestrator Readiness Report/);
});

// ── --allow-static-fallback restores legacy behavior ─────────

test("BOOT-FAILURE-CONFIG: --allow-static-fallback returns normal-tier exit", () => {
  const r = runReadiness(["--allow-static-fallback", "--json"],
    { ORCHESTRATOR_READINESS_FORCE_BOOT_ERROR: "EPERM" });
  // Static-only score is 9/18 → tier 2 (internal-only).
  assert.equal(r.status, 2,
    "fallback to static must produce a normal-tier exit (2), got " + r.status);
  const out = JSON.parse(r.stdout);
  assert.equal(out.exit, 2);
  assert.equal(out.total, 9);
  assert.equal(out.max, 18);
  // configError must NOT appear in fallback mode
  assert.equal(out.configError, undefined);
});

// ── --no-spawn skips boot entirely ──────────────────────────

test("BOOT-FAILURE-CONFIG: --no-spawn ignores the forced-error env", () => {
  // With --no-spawn we never call bootHarness, so the forced error
  // env is irrelevant. Score should be the static 9/18.
  const r = runReadiness(["--no-spawn", "--json"],
    { ORCHESTRATOR_READINESS_FORCE_BOOT_ERROR: "EPERM" });
  assert.equal(r.status, 2,
    "--no-spawn must produce static-tier exit, got " + r.status);
  const out = JSON.parse(r.stdout);
  assert.equal(out.exit, 2);
  assert.equal(out.total, 9);
  assert.equal(out.configError, undefined);
});

// ── boot-failure detail timing ──────────────────────────────

test("BOOT-FAILURE-CONFIG: CONFIG run completes quickly (no static-fallback overhead)", () => {
  const start = Date.now();
  const r = runReadiness(["--json"], { ORCHESTRATOR_READINESS_FORCE_BOOT_ERROR: "EPERM" });
  const elapsed = Date.now() - start;
  assert.equal(r.status, 4);
  // CONFIG path should NOT spend time on category scoring. The
  // forced-error path is synchronous reject; we should be done in
  // well under the 4s spawn timeout.
  assert.ok(elapsed < 4000,
    "CONFIG path should finish < 4s (got " + elapsed + " ms) — implies it bailed before scoring");
});

// ── header / docstring synchronisation with the rubric ──────

test("BOOT-FAILURE-CONFIG: script header documents exit 4 = CONFIG", () => {
  const fs = require("node:fs");
  const text = fs.readFileSync(SCRIPT, "utf-8");
  // First 70 lines are the header block.
  const head = text.split("\n").slice(0, 70).join("\n");
  assert.match(head, /4 — CONFIG/,
    "header must document the new exit 4 = CONFIG tier");
  assert.match(head, /--allow-static-fallback/,
    "header must document the --allow-static-fallback flag");
});
