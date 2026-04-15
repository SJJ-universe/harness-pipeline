// P2-1 — setup-harness.js: generate/merge .claude/settings.json
//
// The goal is a single onboarding command (`npm run setup`) that writes a
// .claude/settings.json with the 5 harness hooks wired to
// pipeline-dashboard/hooks/harness-hook.js. The script must be safe to run
// repeatedly: idempotent, merge-not-clobber, and never touch settings.local.json.
//
// Covered cases:
//   1. greenfield — no .claude/ at all → script creates dir + settings.json
//      with 5 hook events, each pointing at the absolute harness-hook.js.
//   2. idempotent — run twice, second run is a no-op (same file bytes).
//   3. merge — user already has unrelated hooks; script preserves them and
//      only adds missing harness entries.
//   4. already installed — user already has the harness-hook command wired;
//      script does not duplicate entries.
//   5. --dry-run — prints the plan, does not write.
//   6. --target override — respects --target <dir> instead of cwd.
//
// Run: node executor/__p2-1-test.js

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SETUP = path.join(__dirname, "..", "scripts", "setup-harness.js");
const HOOK_REL = path.join("hooks", "harness-hook.js");
const HOOK_ABS = path
  .resolve(__dirname, "..", HOOK_REL)
  .replace(/\\/g, "/");

const HOOK_EVENTS = [
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SessionEnd",
];

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

function mktmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), "p2-1-" + prefix + "-"));
}

function runSetup(target, extraArgs) {
  const args = [SETUP, "--target", target].concat(extraArgs || []);
  return spawnSync(process.execPath, args, { encoding: "utf-8" });
}

function readSettings(target) {
  const p = path.join(target, ".claude", "settings.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function hookCommandFor(event, settings) {
  const group = (settings.hooks || {})[event] || [];
  const out = [];
  for (const entry of group) {
    for (const h of entry.hooks || []) {
      if (h && h.command) out.push(h.command);
    }
  }
  return out;
}

function hasHarnessCommand(commands, eventKind) {
  // Each harness hook is invoked as:
  //   node <abs>/harness-hook.js <kind>
  // where <kind> differs by event.
  return commands.some(
    (c) =>
      c.includes("harness-hook.js") && c.includes(eventKind)
  );
}

const EVENT_TO_KIND = {
  UserPromptSubmit: "user-prompt",
  PreToolUse: "pre-tool",
  PostToolUse: "post-tool",
  Stop: "stop",
  SessionEnd: "session-end",
};

console.log("[P2-1 setup-harness]");

test("script file exists", () => {
  if (!fs.existsSync(SETUP)) {
    throw new Error("scripts/setup-harness.js missing");
  }
});

test("greenfield: creates .claude/settings.json with 5 harness hooks", () => {
  const tmp = mktmp("green");
  const r = runSetup(tmp);
  if (r.status !== 0) {
    throw new Error(
      "exit=" + r.status + " stderr=" + (r.stderr || "").slice(0, 400)
    );
  }
  const settings = readSettings(tmp);
  for (const ev of HOOK_EVENTS) {
    const cmds = hookCommandFor(ev, settings);
    if (!hasHarnessCommand(cmds, EVENT_TO_KIND[ev])) {
      throw new Error(
        ev + " missing harness command; got " + JSON.stringify(cmds)
      );
    }
  }
});

test("greenfield: harness command uses absolute path to harness-hook.js", () => {
  const tmp = mktmp("abs");
  runSetup(tmp);
  const settings = readSettings(tmp);
  const cmds = hookCommandFor("UserPromptSubmit", settings);
  const harness = cmds.find((c) => c.includes("harness-hook.js"));
  if (!harness) throw new Error("no harness command");
  // Must reference the real HOOK_ABS (forward-slashed for cross-platform).
  const normalized = harness.replace(/\\/g, "/");
  if (!normalized.includes(HOOK_ABS)) {
    throw new Error("command does not include absolute HOOK_ABS\n  cmd: " + normalized + "\n  want: " + HOOK_ABS);
  }
});

test("idempotent: second run produces byte-identical settings.json", () => {
  const tmp = mktmp("idem");
  runSetup(tmp);
  const first = fs.readFileSync(path.join(tmp, ".claude", "settings.json"));
  runSetup(tmp);
  const second = fs.readFileSync(path.join(tmp, ".claude", "settings.json"));
  if (!first.equals(second)) {
    throw new Error(
      "second run changed file\nfirst=\n" +
        first.toString() +
        "\nsecond=\n" +
        second.toString()
    );
  }
});

test("merge: preserves pre-existing unrelated PreToolUse hook", () => {
  const tmp = mktmp("merge");
  fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });
  const existing = {
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "echo user-own-hook" }],
        },
      ],
    },
  };
  fs.writeFileSync(
    path.join(tmp, ".claude", "settings.json"),
    JSON.stringify(existing, null, 2)
  );
  const r = runSetup(tmp);
  if (r.status !== 0) throw new Error("exit=" + r.status);
  const settings = readSettings(tmp);
  const cmds = hookCommandFor("PreToolUse", settings);
  if (!cmds.some((c) => c.includes("echo user-own-hook"))) {
    throw new Error("user-own-hook was clobbered; got " + JSON.stringify(cmds));
  }
  if (!hasHarnessCommand(cmds, "pre-tool")) {
    throw new Error("harness PreToolUse not added; got " + JSON.stringify(cmds));
  }
  // And all 5 harness hooks present.
  for (const ev of HOOK_EVENTS) {
    const c = hookCommandFor(ev, settings);
    if (!hasHarnessCommand(c, EVENT_TO_KIND[ev])) {
      throw new Error("missing harness " + ev);
    }
  }
});

test("already installed: no duplicate harness entries on re-run", () => {
  const tmp = mktmp("dup");
  runSetup(tmp);
  runSetup(tmp);
  runSetup(tmp);
  const settings = readSettings(tmp);
  for (const ev of HOOK_EVENTS) {
    const cmds = hookCommandFor(ev, settings);
    const harnessMatches = cmds.filter((c) => c.includes("harness-hook.js"));
    if (harnessMatches.length !== 1) {
      throw new Error(
        ev + ": expected 1 harness command, got " + harnessMatches.length + " — " + JSON.stringify(harnessMatches)
      );
    }
  }
});

test("--dry-run: does not write settings.json", () => {
  const tmp = mktmp("dry");
  const r = runSetup(tmp, ["--dry-run"]);
  if (r.status !== 0) throw new Error("exit=" + r.status);
  const settingsPath = path.join(tmp, ".claude", "settings.json");
  if (fs.existsSync(settingsPath)) {
    throw new Error("--dry-run wrote settings.json");
  }
  // Plan output should mention the 5 events so user can eyeball it.
  const out = (r.stdout || "") + (r.stderr || "");
  for (const ev of HOOK_EVENTS) {
    if (!out.includes(ev)) {
      throw new Error("--dry-run output missing " + ev + "\n" + out);
    }
  }
});

test("--target override: writes into the specified dir", () => {
  const tmp = mktmp("tgt");
  const r = runSetup(tmp);
  if (r.status !== 0) throw new Error("exit=" + r.status);
  if (!fs.existsSync(path.join(tmp, ".claude", "settings.json"))) {
    throw new Error("settings.json not created in --target");
  }
});

test("does not touch settings.local.json", () => {
  const tmp = mktmp("local");
  fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });
  const localContent = '{"mine":true}';
  fs.writeFileSync(
    path.join(tmp, ".claude", "settings.local.json"),
    localContent
  );
  runSetup(tmp);
  const after = fs.readFileSync(
    path.join(tmp, ".claude", "settings.local.json"),
    "utf-8"
  );
  if (after !== localContent) {
    throw new Error("settings.local.json was modified");
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
