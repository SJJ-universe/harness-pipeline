// Slice AB (Phase 2.5) — hookDecisionAdapter scope audit.
//
// Verifies the two response-shape rules the reviewer called out:
//
//   1. PreToolUse block responses MUST go through denyToolUse() so they
//      carry both the legacy `{ decision: "block" }` AND the modern
//      `hookSpecificOutput.permissionDecision: "deny"` shape — otherwise
//      new Claude Code clients ignore them silently.
//
//   2. UserPromptSubmit / Stop block responses MUST stay on the legacy
//      `{ decision, reason }` shape. Running them through denyToolUse()
//      would add `hookSpecificOutput.hookEventName: "PreToolUse"` and
//      `permissionDecision: "deny"`, neither of which Claude Code
//      consults on UserPromptSubmit/Stop, so the block would be silently
//      dropped.
//
// The adapter carve-out is enforced by comment convention plus these
// tests, which lock the behaviour against future refactors.

const test = require("node:test");
const assert = require("node:assert/strict");
const { HookRouter } = require("../../executor/hook-router");
const { denyToolUse } = require("../../src/hooks/hookDecisionAdapter");

function mkRouter() {
  const events = [];
  const router = new HookRouter({
    broadcast: (e) => events.push(e),
    sessionWatcher: null,
    runRegistry: null,
  });
  return { router, events };
}

test("AB: denyToolUse output shape (the canonical PreToolUse response)", () => {
  // This is a regression check against the adapter contract — Slice AB
  // depends on it being stable. It lives here (not just in
  // hookDecisionAdapter.test.js) so the `npm test:unit` suite refuses to
  // ship if the adapter silently changes shape.
  const r = denyToolUse("Phase A denies Bash");
  assert.equal(r.decision, "block", "legacy shape present");
  assert.equal(r.reason, "Phase A denies Bash", "legacy reason preserved");
  assert.ok(r.hookSpecificOutput, "modern shape present");
  assert.equal(r.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(r.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(r.hookSpecificOutput.permissionDecisionReason, "Phase A denies Bash");
});

test("AB carve-out: user-prompt block from HookRouter keeps LEGACY shape", async () => {
  const { router } = mkRouter();
  // context_usage > 95% → alarmForUsage returns { level: "block" }.
  const result = await router.route("user-prompt", {
    prompt: "hi",
    context_usage: { used: 960, limit: 1000 },
  });
  assert.equal(result.decision, "block", "block returned");
  assert.match(result.reason, /context usage is above 95%/);
  // CRITICAL: no PreToolUse-style envelope. If this appears, Claude Code's
  // UserPromptSubmit handler will silently drop the block because it does
  // not look at hookSpecificOutput.
  assert.equal(
    result.hookSpecificOutput,
    undefined,
    "UserPromptSubmit block MUST NOT carry PreToolUse hookSpecificOutput"
  );
});

test("AB carve-out: override_context_alarm skips the block (documented escape hatch)", async () => {
  const { router } = mkRouter();
  const result = await router.route("user-prompt", {
    prompt: "hi",
    context_usage: { used: 960, limit: 1000 },
    override_context_alarm: true,
  });
  // With the override the router falls through to _onUserPrompt, which
  // with no executor attached returns `{}` — the important assertion is
  // that we did NOT return a block decision.
  assert.notEqual(result && result.decision, "block", "override suppresses the block");
});

test("AB carve-out: hook-router source documents WHY the carve-out exists", () => {
  const fs = require("fs");
  const path = require("path");
  const SRC = fs.readFileSync(
    path.join(__dirname, "../../executor/hook-router.js"),
    "utf-8"
  );
  // Make it very hard to accidentally "clean this up" — regressing the
  // carve-out would drop UserPromptSubmit blocks silently on Claude Code.
  // The comment spans two lines in source so match both halves separately.
  assert.match(SRC, /UserPromptSubmit block/i, "references UserPromptSubmit in the carve-out");
  assert.match(SRC, /NOT a PreToolUse block/i, "explicitly says it is not a PreToolUse block");
  assert.match(SRC, /Slice AB.*carve-out/i, "carve-out tagged with the slice name");
});

test("AB carve-out: pipeline-executor.js Stop hook returns keep LEGACY shape + comment", () => {
  const fs = require("fs");
  const path = require("path");
  const SRC = fs.readFileSync(
    path.join(__dirname, "../../executor/pipeline-executor.js"),
    "utf-8"
  );
  // Both Stop-hook legacy returns should be accompanied by a carve-out
  // comment so future refactorers understand why they look different
  // from the PreToolUse paths that use denyToolUse().
  const carveOutComments = SRC.match(/Slice AB \(Phase 2\.5\) carve-out:/g) || [];
  assert.ok(
    carveOutComments.length >= 2,
    `expected ≥2 Stop-hook carve-out comments in pipeline-executor.js, found ${carveOutComments.length}`
  );
  // And none of them should have been converted to denyToolUse — it would
  // break Stop hook re-prompting.
  const legacyStopReturns = SRC.match(
    /return\s*\{\s*decision:\s*["']block["']\s*,\s*reason[^}]*\}/g
  ) || [];
  assert.ok(
    legacyStopReturns.length >= 2,
    `Stop hook legacy-shape returns must remain; found ${legacyStopReturns.length}`
  );
});

test("AB: PreToolUse deny path in pipeline-executor still uses denyToolUse (not legacy shape)", () => {
  const fs = require("fs");
  const path = require("path");
  const SRC = fs.readFileSync(
    path.join(__dirname, "../../executor/pipeline-executor.js"),
    "utf-8"
  );
  // onPreTool should contain only denyToolUse() returns for its blocks —
  // danger, policy, contract, TDD, and the generic phase block all use
  // the adapter so Claude Code sees both shapes.
  const preToolDenies = SRC.match(/return\s+denyToolUse\(/g) || [];
  assert.ok(
    preToolDenies.length >= 5,
    `expected ≥5 PreToolUse denyToolUse() returns (danger/policy/contract/TDD/generic), found ${preToolDenies.length}`
  );
});
