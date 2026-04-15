// Danger Gate — T9 (rev2 C1/H6/M1)
//
// Tool-scoped, structural check for destructive operations. Shared between
// pipeline-executor.onPreTool and server.js /api/hook so both entry points
// block the same dangers (rev2 H6: single gate, dual entry point).
//
// Design notes:
// - NO `.claude` self-block. Earlier rev1 blocked any write under `.claude/`,
//   which killed legitimate harness tuning (T1/T3). Removed for good.
// - `.env` danger is scoped to Write/Edit only — Read/Bash on .env is fine.
// - Template suffixes (`.env.example`, `.env.sample`, `.env.template`) are
//   explicitly ALLOWED — they're shipped as documentation and contain no
//   real secrets. Real secret files (`.env`, `.env.local`, `.env.production`,
//   etc.) remain blocked.
// - Returns a short human-readable reason string on match, or null on allow.
//   Callers use the reason for logging and user-facing block messages.

const RM_RECURSIVE_FORCE = /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\b/i;
const GIT_FORCE_PUSH = /\bgit\s+push\s+.*(--force-with-lease|--force|\s-f(\s|$))/;
const GIT_RESET_HARD = /\bgit\s+reset\s+--hard\b/;
const POWERSHELL_RECURSIVE = /\bRemove-Item\b[^\n]*-Recurse\b/i;

// Match `.env` and `.env.<anything except example|sample|template>`.
// The negative lookahead excludes template suffixes so `.env.example` and
// friends pass through.
const DOTENV_WRITE = /(^|\/|\\)\.env(?:\.(?!example$|sample$|template$)[^/\\]+)?$/i;
const CREDENTIALS_WRITE = /credentials\.json$/i;

function isDangerous(tool, input) {
  const inp = input || {};

  if (tool === "Bash") {
    const cmd = typeof inp.command === "string" ? inp.command : "";
    if (!cmd) return null;
    if (RM_RECURSIVE_FORCE.test(cmd)) return "rm with recursive+force flags";
    if (GIT_FORCE_PUSH.test(cmd)) return "git force push";
    if (GIT_RESET_HARD.test(cmd)) return "git reset --hard";
    if (POWERSHELL_RECURSIVE.test(cmd)) return "Remove-Item -Recurse";
    return null;
  }

  if (tool === "Write" || tool === "Edit") {
    const fp = typeof inp.file_path === "string" ? inp.file_path : "";
    if (!fp) return null;
    if (DOTENV_WRITE.test(fp)) return ".env write";
    if (CREDENTIALS_WRITE.test(fp)) return "credentials.json write";
    return null;
  }

  return null;
}

module.exports = { isDangerous };
