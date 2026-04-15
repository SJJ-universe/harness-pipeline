// Minimal .env loader (no external deps).
// - Reads `.env` from the given directory once and merges into process.env.
// - Does NOT override values already present in process.env (CLI env wins).
// - Supports KEY=VALUE, `export KEY=VALUE`, surrounding whitespace,
//   single/double quoted values, and values containing `=`.
// - Lines starting with `#` and blank lines are ignored.

const fs = require("fs");
const path = require("path");

function parseDotenv(text) {
  const out = {};
  if (typeof text !== "string" || text.length === 0) return out;
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const withoutExport = line.replace(/^export\s+/, "");
    const eq = withoutExport.indexOf("=");
    if (eq === -1) continue;
    const key = withoutExport.slice(0, eq).trim();
    if (!key) continue;
    let value = withoutExport.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

let loaded = false;
function loadDotenv(dir) {
  const envPath = path.resolve(dir || process.cwd(), ".env");
  let text = "";
  try {
    text = fs.readFileSync(envPath, "utf-8");
  } catch (_) {
    return { loaded: false, path: envPath, keys: [] };
  }
  const parsed = parseDotenv(text);
  const applied = [];
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] === undefined) {
      process.env[k] = v;
      applied.push(k);
    }
  }
  loaded = true;
  return { loaded: true, path: envPath, keys: applied };
}

module.exports = { parseDotenv, loadDotenv, isLoaded: () => loaded };
