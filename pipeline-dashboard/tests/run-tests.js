const fs = require("fs");
const path = require("path");

function collectTests(entry) {
  const resolved = path.resolve(process.cwd(), entry);
  const stat = fs.statSync(resolved);
  if (stat.isFile()) return [resolved];
  return fs
    .readdirSync(resolved)
    .filter((name) => name.endsWith(".test.js"))
    .sort()
    .map((name) => path.join(resolved, name));
}

const entries = process.argv.slice(2);
if (!entries.length) {
  console.error("Usage: node tests/run-tests.js <test-dir-or-file> [...]");
  process.exit(1);
}

for (const entry of entries) {
  for (const file of collectTests(entry)) {
    require(file);
  }
}
