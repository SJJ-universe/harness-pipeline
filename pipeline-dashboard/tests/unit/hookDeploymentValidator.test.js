// Slice F0 (v5) — Hook Deployment Validator regression.
//
// Exercises validateDeployment() against crafted settings.json fixtures so we
// can guarantee the harness fails loud if .claude/settings.json drifts out of
// sync with the 10 hooks the code knows how to route.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  validateDeployment,
  REQUIRED_HOOKS,
  ALIAS_MAP,
} = require("../../src/hooks/deploymentValidator");

function mkTmpSettings(settings) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-hook-dep-"));
  const filePath = path.join(dir, "settings.json");
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
  return filePath;
}

function validBlock(alias, matcher = "") {
  return [
    {
      matcher,
      hooks: [
        {
          type: "command",
          command: `node "/abs/path/pipeline-dashboard/hooks/harness-hook.js" ${alias}`,
        },
      ],
    },
  ];
}

function fullySpecSettings({ preToolMatcher = "Edit|Write|Bash|Read|Glob|Grep" } = {}) {
  const settings = { hooks: {} };
  for (const h of REQUIRED_HOOKS) {
    settings.hooks[h] = validBlock(ALIAS_MAP[h]);
  }
  settings.hooks.PreToolUse[0].matcher = preToolMatcher;
  return settings;
}

test("validateDeployment: nonexistent file → exists:false, overallOk:false", () => {
  const report = validateDeployment(
    path.join(os.tmpdir(), `nope-${Date.now()}.json`)
  );
  assert.equal(report.exists, false);
  assert.equal(report.overallOk, false);
  assert.ok(report.errors.length > 0);
});

test("validateDeployment: full valid deployment → overallOk:true, no missing tools", () => {
  const p = mkTmpSettings(fullySpecSettings());
  const report = validateDeployment(p);
  assert.equal(report.overallOk, true, JSON.stringify(report, null, 2));
  assert.deepEqual(report.preToolMissingTools, []);
  assert.equal(report.errors.length, 0);
  for (const h of REQUIRED_HOOKS) {
    assert.equal(report.hooks[h].present, true);
    assert.equal(report.hooks[h].ok, true);
  }
});

test("validateDeployment: PreCompact missing → that hook flagged, overallOk:false", () => {
  const settings = fullySpecSettings();
  delete settings.hooks.PreCompact;
  const p = mkTmpSettings(settings);
  const report = validateDeployment(p);
  assert.equal(report.hooks.PreCompact.present, false);
  assert.equal(report.hooks.PreCompact.ok, false);
  assert.equal(report.overallOk, false);
});

test("validateDeployment: alias mismatch → ok:false + aliasFound recorded", () => {
  const settings = fullySpecSettings();
  // Scramble UserPromptSubmit's alias so validator catches the typo.
  settings.hooks.UserPromptSubmit[0].hooks[0].command =
    'node "/abs/path/harness-hook.js" WRONG';
  const p = mkTmpSettings(settings);
  const report = validateDeployment(p);
  assert.equal(report.hooks.UserPromptSubmit.ok, false);
  assert.equal(report.hooks.UserPromptSubmit.aliasFound, "WRONG");
  assert.equal(report.hooks.UserPromptSubmit.aliasExpected, "user-prompt");
  assert.equal(report.overallOk, false);
});

test("validateDeployment: PreToolUse matcher missing Read/Glob/Grep → reported", () => {
  const p = mkTmpSettings(fullySpecSettings({ preToolMatcher: "Edit|Write|Bash" }));
  const report = validateDeployment(p);
  assert.ok(report.preToolMissingTools.includes("Read"));
  assert.ok(report.preToolMissingTools.includes("Glob"));
  assert.ok(report.preToolMissingTools.includes("Grep"));
  assert.equal(report.overallOk, false);
});

test("validateDeployment: empty matcher = match-all, satisfies required tools", () => {
  const p = mkTmpSettings(fullySpecSettings({ preToolMatcher: "" }));
  const report = validateDeployment(p);
  assert.deepEqual(report.preToolMissingTools, []);
  assert.equal(report.overallOk, true);
});

test("validateDeployment: '*' matcher also satisfies required tools", () => {
  const p = mkTmpSettings(fullySpecSettings({ preToolMatcher: "*" }));
  const report = validateDeployment(p);
  assert.deepEqual(report.preToolMissingTools, []);
  assert.equal(report.overallOk, true);
});

test("validateDeployment: command not pointing at harness-hook.js → ok:false", () => {
  const settings = fullySpecSettings();
  settings.hooks.Stop[0].hooks[0].command = 'node "/abs/path/unrelated.js" stop';
  const p = mkTmpSettings(settings);
  const report = validateDeployment(p);
  assert.equal(report.hooks.Stop.ok, false);
  assert.equal(report.overallOk, false);
});

test("validateDeployment: malformed JSON → errors non-empty", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-hook-dep-"));
  const p = path.join(dir, "settings.json");
  fs.writeFileSync(p, "{ broken json");
  const report = validateDeployment(p);
  assert.ok(report.errors.length > 0);
  assert.equal(report.overallOk, false);
});

test("validateDeployment: REQUIRED_HOOKS covers exactly the 10 canonical hooks", () => {
  assert.equal(REQUIRED_HOOKS.length, 10);
  assert.ok(REQUIRED_HOOKS.includes("SessionStart"));
  assert.ok(REQUIRED_HOOKS.includes("PreCompact"));
  assert.ok(REQUIRED_HOOKS.includes("Notification"));
});
