// P1-2 — Tests for the unit-test runner itself.
//
// We build a temp dir with two throwaway test files (one passing, one
// failing) and invoke scripts/run-unit-tests.js against it via the
// TEST_EXTRA_DIRS env hook. The runner must:
//   - discover both files
//   - propagate their exit codes into its summary
//   - exit non-zero when at least one child failed
//   - ignore __*-live-verify.js even if present in the extra dir
//
// Run: node executor/__p1-2-test.js

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RUNNER = path.join(ROOT, "scripts", "run-unit-tests.js");

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

function makeFixtureDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p12-runner-"));
  const rel = "__p12fixture-" + path.basename(dir);
  const inRoot = path.join(ROOT, rel);
  fs.mkdirSync(inRoot);
  fs.writeFileSync(
    path.join(inRoot, "__pass-test.js"),
    'console.log("fake pass"); process.exit(0);\n'
  );
  fs.writeFileSync(
    path.join(inRoot, "__fail-test.js"),
    'console.log("fake fail"); process.exit(7);\n'
  );
  // live-verify that must be skipped even though it matches __*-test.js
  fs.writeFileSync(
    path.join(inRoot, "__bogus-live-verify.js"),
    'throw new Error("live verify should NOT have been invoked");\n'
  );
  return { dir, rel, inRoot };
}

function runRunner(extraDir, filter) {
  const env = Object.assign({}, process.env, {
    TEST_EXTRA_DIRS: extraDir,
  });
  if (filter) env.TEST_FILTER = filter;
  // Scope discovery to the fixture dir only by filtering out executor tests
  // via TEST_FILTER so we do not execute the real suite during this test.
  env.TEST_FILTER = filter || "__p12f";
  return spawnSync(process.execPath, [RUNNER], {
    cwd: ROOT,
    env,
    encoding: "utf-8",
  });
}

console.log("[run-unit-tests.js runner contract]");

const fx = makeFixtureDir();
try {
  // Rename fixture files so TEST_FILTER=__p12f catches them but not the real suite.
  fs.renameSync(
    path.join(fx.inRoot, "__pass-test.js"),
    path.join(fx.inRoot, "__p12fpass-test.js")
  );
  fs.renameSync(
    path.join(fx.inRoot, "__fail-test.js"),
    path.join(fx.inRoot, "__p12ffail-test.js")
  );
  fs.renameSync(
    path.join(fx.inRoot, "__bogus-live-verify.js"),
    path.join(fx.inRoot, "__p12flive-verify.js")
  );

  const r = runRunner(fx.rel);

  test("runner exits non-zero when a child fails", () => {
    if (r.status === 0) {
      throw new Error(
        "expected non-zero exit, got 0. stdout=\n" + r.stdout + "\nstderr=\n" + r.stderr
      );
    }
  });

  test("summary reports both pass and fail lines", () => {
    const out = r.stdout || "";
    if (!/PASS .*__p12fpass-test\.js/.test(out)) {
      throw new Error("missing PASS line for fixture pass test:\n" + out);
    }
    if (!/FAIL .*__p12ffail-test\.js/.test(out)) {
      throw new Error("missing FAIL line for fixture fail test:\n" + out);
    }
  });

  test("live-verify fixture was skipped (never spawned)", () => {
    const out = (r.stdout || "") + (r.stderr || "");
    if (/live verify should NOT have been invoked/.test(out)) {
      throw new Error("live-verify fixture was executed");
    }
    if (/__p12flive-verify/.test(out)) {
      throw new Error("live-verify fixture appeared in runner output");
    }
  });

  test("summary count line is accurate", () => {
    const m = (r.stdout || "").match(/(\d+) passed, (\d+) failed/);
    if (!m) throw new Error("no summary line: " + r.stdout);
    if (m[1] !== "1" || m[2] !== "1") {
      throw new Error("expected 1 passed / 1 failed, got " + m[0]);
    }
  });
} finally {
  // Cleanup: remove the fixture dir we dropped inside ROOT
  try {
    fs.rmSync(fx.inRoot, { recursive: true, force: true });
  } catch (_) {}
  try {
    fs.rmSync(fx.dir, { recursive: true, force: true });
  } catch (_) {}
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
