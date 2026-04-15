// P2-3 — server.js refactor: extract orchestration + trigger route
//
// server.js had grown to ~900 lines because two chunks of business logic
// were inlined into the HTTP entrypoint: the general-plan orchestrator
// (Phase A→B→C↔D cycle) and the Codex trigger endpoint with its context
// resolver. Both are pure logic and belong in their own modules.
//
// This test locks in a minimal contract:
//
//   1. server.js stays under 700 lines (was 906 — refactor must reduce it).
//   2. executor/general-pipeline.js exists and exports the orchestrator
//      plus the three prompt builders. The builders are pure and cheap
//      to unit-test without spawning Claude/Codex.
//   3. routes/codex-triggers.js exists and exports a factory that returns
//      an Express router. resolveTriggerContext is exported so we can
//      unit-test the user-input branch without HTTP.
//   4. server.js no longer defines runGeneralPipeline / buildPlannerPrompt
//      / resolveTriggerContext inline — those names must move.
//   5. The prompt builders preserve the Korean markdown skeleton the old
//      version emitted (# 목표 / # 범위 / # 작업 단계 / # 리스크 / # 검증).
//   6. resolveTriggerContext user-input branch still trims + throws on empty.
//
// Run: node executor/__p2-3-test.js

const fs = require("fs");
const path = require("path");

const DASH = path.resolve(__dirname, "..");
const SERVER = path.join(DASH, "server.js");
const ORCH = path.join(DASH, "executor", "general-pipeline.js");
const ROUTE = path.join(DASH, "routes", "codex-triggers.js");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ok  " + name);
  } catch (e) {
    failed++;
    console.error("  FAIL  " + name + "\n        " + (e.stack || e.message));
  }
}

console.log("[P2-3 server.js refactor]");

test("server.js is under 700 lines (was 906)", () => {
  const txt = fs.readFileSync(SERVER, "utf-8");
  const lines = txt.split("\n").length;
  if (lines >= 700) {
    throw new Error(`server.js has ${lines} lines, expected < 700`);
  }
});

test("executor/general-pipeline.js exists", () => {
  if (!fs.existsSync(ORCH)) {
    throw new Error("executor/general-pipeline.js missing");
  }
});

test("general-pipeline.js exports orchestrator + prompt builders", () => {
  const mod = require(ORCH);
  for (const name of [
    "runGeneralPipeline",
    "buildPlannerPrompt",
    "buildRefinerPrompt",
    "buildCriticPrompt",
  ]) {
    if (typeof mod[name] !== "function") {
      throw new Error(`general-pipeline.js missing export: ${name}`);
    }
  }
});

test("buildPlannerPrompt preserves Korean markdown skeleton", () => {
  const { buildPlannerPrompt } = require(ORCH);
  const p = buildPlannerPrompt("add a settings page");
  for (const marker of ["# 목표", "# 범위", "# 작업 단계", "# 리스크", "# 검증"]) {
    if (!p.includes(marker)) {
      throw new Error("planner prompt missing marker: " + marker);
    }
  }
  if (!p.includes("add a settings page")) {
    throw new Error("planner prompt did not interpolate task");
  }
});

test("buildCriticPrompt asks for severity-tagged bullets", () => {
  const { buildCriticPrompt } = require(ORCH);
  const p = buildCriticPrompt("t", "PLAN_BODY");
  if (!/\[critical\|high\|medium\|low\]/.test(p)) {
    throw new Error("critic prompt missing severity tag format");
  }
  if (!p.includes("PLAN_BODY")) {
    throw new Error("critic prompt did not interpolate plan");
  }
});

test("buildRefinerPrompt includes previous plan + critique", () => {
  const { buildRefinerPrompt } = require(ORCH);
  const p = buildRefinerPrompt("task", "OLD_PLAN_XYZ", "CRIT_XYZ");
  if (!p.includes("OLD_PLAN_XYZ") || !p.includes("CRIT_XYZ")) {
    throw new Error("refiner prompt missing plan or critique");
  }
});

test("routes/codex-triggers.js exists and exports createRouter", () => {
  if (!fs.existsSync(ROUTE)) {
    throw new Error("routes/codex-triggers.js missing");
  }
  const mod = require(ROUTE);
  if (typeof mod.createRouter !== "function") {
    throw new Error("routes/codex-triggers.js must export createRouter(deps)");
  }
  if (typeof mod.resolveTriggerContext !== "function") {
    throw new Error("routes/codex-triggers.js must export resolveTriggerContext");
  }
});

test("resolveTriggerContext user-input branch trims + throws on empty", () => {
  const { resolveTriggerContext } = require(ROUTE);
  const trig = { contextSource: "user-input" };
  const got = resolveTriggerContext(trig, "hello world");
  if (got !== "hello world") {
    throw new Error("expected user input pass-through, got: " + got);
  }
  let threw = false;
  try {
    resolveTriggerContext(trig, "   ");
  } catch (_) {
    threw = true;
  }
  if (!threw) {
    throw new Error("expected empty user input to throw");
  }
});

test("server.js no longer inlines runGeneralPipeline / buildPlannerPrompt / resolveTriggerContext", () => {
  const txt = fs.readFileSync(SERVER, "utf-8");
  for (const name of [
    "async function runGeneralPipeline",
    "function buildPlannerPrompt",
    "function buildCriticPrompt",
    "function buildRefinerPrompt",
    "function resolveTriggerContext",
  ]) {
    if (txt.includes(name)) {
      throw new Error(`server.js still inlines: ${name}`);
    }
  }
});

test("server.js wires general-pipeline.js + routes/codex-triggers.js", () => {
  const txt = fs.readFileSync(SERVER, "utf-8");
  if (!/require\(["'].\/executor\/general-pipeline["']\)/.test(txt)) {
    throw new Error("server.js does not require ./executor/general-pipeline");
  }
  if (!/require\(["'].\/routes\/codex-triggers["']\)/.test(txt)) {
    throw new Error("server.js does not require ./routes/codex-triggers");
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
