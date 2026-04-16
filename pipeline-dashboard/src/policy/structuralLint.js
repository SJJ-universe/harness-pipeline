// Structural lint — checks layer boundary violations defined in policy JSON.
//
// Rule format: "<source glob> must not require from <target glob>"
// Parses require() calls in source files and checks if any target forbidden paths.

const fs = require("fs");
const path = require("path");
const { getPolicy } = require("./phasePolicy");

const REQUIRE_REGEX = /require\s*\(\s*["']([^"']+)["']\s*\)/g;

function parseRule(ruleText) {
  // "src/security/** must not require from executor/**"
  const match = ruleText.match(/^(\S+)\s+must not require from\s+(\S+)$/i);
  if (!match) return null;
  return { sourceGlob: match[1], targetGlob: match[2] };
}

function globToPrefix(glob) {
  // Convert "src/security/**" to "src/security/"
  return glob.replace(/\*+$/, "");
}

function findJsFiles(dir, prefix) {
  const results = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules") {
        results.push(...findJsFiles(full, prefix));
      } else if (entry.isFile() && entry.name.endsWith(".js")) {
        const rel = path.relative(prefix, full).replace(/\\/g, "/");
        results.push({ path: full, rel });
      }
    }
  } catch (_) {}
  return results;
}

function lint(appRoot, policy) {
  const pol = policy || getPolicy();
  if (!pol || !Array.isArray(pol.structuralLint)) return [];

  const results = [];
  for (const rule of pol.structuralLint) {
    const parsed = parseRule(rule.rule);
    if (!parsed) {
      results.push({ id: rule.id, pass: false, level: rule.level, message: `unparseable rule: ${rule.rule}` });
      continue;
    }

    const sourcePrefix = globToPrefix(parsed.sourceGlob);
    const targetPrefix = globToPrefix(parsed.targetGlob);
    const sourceDir = path.join(appRoot, sourcePrefix);

    if (!fs.existsSync(sourceDir)) {
      results.push({ id: rule.id, pass: true, level: rule.level, message: "source directory does not exist" });
      continue;
    }

    const files = findJsFiles(sourceDir, appRoot);
    let violations = [];

    for (const file of files) {
      try {
        const content = fs.readFileSync(file.path, "utf-8");
        let m;
        REQUIRE_REGEX.lastIndex = 0;
        while ((m = REQUIRE_REGEX.exec(content)) !== null) {
          const requirePath = m[1];
          // Resolve relative require to see if it targets the forbidden prefix
          if (requirePath.startsWith(".")) {
            const resolved = path.relative(appRoot, path.resolve(path.dirname(file.path), requirePath)).replace(/\\/g, "/");
            if (resolved.startsWith(targetPrefix)) {
              violations.push(`${file.rel} requires ${requirePath} (resolves to ${resolved})`);
            }
          } else if (requirePath.startsWith(targetPrefix)) {
            violations.push(`${file.rel} requires ${requirePath}`);
          }
        }
      } catch (_) {}
    }

    results.push({
      id: rule.id,
      pass: violations.length === 0,
      level: rule.level,
      message: violations.length === 0 ? "no violations" : violations.join("; "),
      violations,
    });
  }

  return results;
}

module.exports = { lint, parseRule };
