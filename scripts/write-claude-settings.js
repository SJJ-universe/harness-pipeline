#!/usr/bin/env node
// Generates .claude/settings.json with absolute, quoted hook paths.
// Run once after cloning: node scripts/write-claude-settings.js

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const HOOK_PATH = path
  .join(REPO_ROOT, "pipeline-dashboard", "hooks", "harness-hook.js")
  .replace(/\\/g, "/");
const OUT = path.join(REPO_ROOT, ".claude", "settings.json");

const settings = {
  hooks: {
    UserPromptSubmit: [
      { matcher: "", hooks: [{ type: "command", command: `node "${HOOK_PATH}" user-prompt` }] },
    ],
    PreToolUse: [
      { matcher: "Edit|Write|Bash", hooks: [{ type: "command", command: `node "${HOOK_PATH}" pre-tool` }] },
    ],
    PostToolUse: [
      { matcher: "", hooks: [{ type: "command", command: `node "${HOOK_PATH}" post-tool` }] },
    ],
    Stop: [
      { matcher: "", hooks: [{ type: "command", command: `node "${HOOK_PATH}" stop` }] },
    ],
    SessionEnd: [
      { matcher: "", hooks: [{ type: "command", command: `node "${HOOK_PATH}" session-end` }] },
    ],
  },
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(settings, null, 2) + "\n");
console.log(`Wrote ${OUT}`);
console.log(`Hook path: ${HOOK_PATH}`);
