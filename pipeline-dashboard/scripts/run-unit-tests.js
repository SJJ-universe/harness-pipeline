#!/usr/bin/env node
// P1-2 — Unit test runner.
//
// Discovers every `executor/__*-test.js` file, spawns each as its own Node
// process, and summarizes pass/fail. Exits non-zero if any child failed so
// `npm test` and CI can fail correctly.
//
// Env knobs:
//   TEST_FILTER=<substr>   only run tests whose filename includes the substr
//   TEST_EXTRA_DIRS=a,b    extra dirs (relative to dashboard root) to scan
//
// Deliberately does NOT run `__*-live-verify.js` — live verifies need a
// running dashboard and live token, so they sit behind `npm run test:live`.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");

function discover() {
  const dirs = ["executor", ...(process.env.TEST_EXTRA_DIRS || "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean)];
  const filter = process.env.TEST_FILTER || "";
  const files = [];
  for (const d of dirs) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs)) {
      if (!/^__.*-test\.js$/.test(name)) continue;
      if (/-live-verify\.js$/.test(name)) continue;
      if (filter && !name.includes(filter)) continue;
      files.push(path.join(abs, name));
    }
  }
  return files.sort();
}

function runOne(file) {
  const rel = path.relative(ROOT, file);
  process.stdout.write(`\n=== ${rel} ===\n`);
  const started = Date.now();
  const r = spawnSync(process.execPath, [file], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  const ms = Date.now() - started;
  return {
    file: rel,
    ok: r.status === 0,
    code: r.status,
    signal: r.signal || null,
    ms,
  };
}

(function main() {
  const files = discover();
  if (files.length === 0) {
    console.error("no unit tests matched");
    process.exit(2);
  }
  console.log(`running ${files.length} unit test file(s)`);
  const results = files.map(runOne);
  const failed = results.filter((r) => !r.ok);
  console.log("\n── Summary ──");
  for (const r of results) {
    const tag = r.ok ? "PASS" : "FAIL";
    const sig = r.signal ? ` signal=${r.signal}` : "";
    console.log(`  ${tag}  ${r.file}  (${r.ms}ms, exit=${r.code}${sig})`);
  }
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length > 0 ? 1 : 0);
})();
