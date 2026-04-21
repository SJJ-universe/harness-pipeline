// Slice Q (v6) — Test runner output parser.
//
// TDD Guard Stage 2 (require-failing-test-proof) needs to know whether a
// recently-run test suite actually contained a failing case. We parse the
// stdout/stderr of 5 common runners:
//
//   - jest       "Tests:       X failed, Y passed, Z total"
//   - vitest     "Tests    X failed | Y passed (Z)"
//   - node:test  "# fail X" alongside "# pass Y"
//   - pytest     "X failed, Y passed in Ns"
//   - tap        "not ok N - name"
//
// Return shape is the same for all formats:
//   { format, pass, fail, skipped, hasFailure }
//
// When nothing matches we return `hasFailure: null` (fail-closed semantics —
// the guard treats null as "can't prove a failure" and denies src edits).

// Ordered by specificity: jest's line is distinct enough that vitest
// wouldn't false-match it, but we still pick the first hit.
function parseTestOutput(stdout, stderr = "") {
  const text = String(stdout || "") + "\n" + String(stderr || "");

  // jest: "Tests:       1 failed, 2 skipped, 3 passed, 6 total"
  const jest = /Tests:\s+(?:(\d+)\s+failed,\s+)?(?:(\d+)\s+skipped,\s+)?(\d+)\s+passed,\s+\d+\s+total/i.exec(text);
  if (jest) {
    const fail = parseInt(jest[1] || "0", 10);
    const skipped = parseInt(jest[2] || "0", 10);
    const pass = parseInt(jest[3], 10);
    return { format: "jest", pass, fail, skipped, hasFailure: fail > 0 };
  }

  // vitest: "Tests  2 failed | 5 passed (7)" (also without the fail segment
  // when none). Distinctive separator is the pipe.
  const vitest = /Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed\s*(?:\(|\|)/i.exec(text);
  if (vitest) {
    const fail = parseInt(vitest[1] || "0", 10);
    const pass = parseInt(vitest[2], 10);
    return { format: "vitest", pass, fail, skipped: 0, hasFailure: fail > 0 };
  }

  // node:test: TAP-ish output that includes summary lines like "# pass N",
  // "# fail N", "# skipped N". Distinct from pytest which uses "X passed".
  const nodeFail = /#\s*fail\s+(\d+)/i.exec(text);
  const nodePass = /#\s*pass\s+(\d+)/i.exec(text);
  if (nodeFail || (nodePass && /#\s*tests\s+\d+/i.test(text))) {
    const fail = nodeFail ? parseInt(nodeFail[1], 10) : 0;
    const pass = nodePass ? parseInt(nodePass[1], 10) : 0;
    return { format: "node-test", pass, fail, skipped: 0, hasFailure: fail > 0 };
  }

  // pytest: "1 failed, 3 passed in 0.14s" or "5 passed in 0.02s"
  const pytestFail = /(\d+)\s+failed/i.exec(text);
  const pytestPass = /(\d+)\s+passed/i.exec(text);
  if ((pytestFail || pytestPass) && /in\s+[\d.]+\s*s/i.test(text)) {
    const fail = pytestFail ? parseInt(pytestFail[1], 10) : 0;
    const pass = pytestPass ? parseInt(pytestPass[1], 10) : 0;
    return { format: "pytest", pass, fail, skipped: 0, hasFailure: fail > 0 };
  }

  // TAP: lines starting with "not ok N" count as failures, "ok N" as passes.
  if (/^\s*(?:ok|not ok)\s+\d+/m.test(text)) {
    const fail = (text.match(/^\s*not ok\s+\d+/gim) || []).length;
    const pass = (text.match(/^\s*ok\s+\d+/gim) || []).length;
    return { format: "tap", pass, fail, skipped: 0, hasFailure: fail > 0 };
  }

  // Nothing matched — fail-closed.
  return { format: null, pass: 0, fail: 0, skipped: 0, hasFailure: null };
}

// Regex for detecting "this Bash command ran tests". Used by PipelineExecutor
// to decide whether to parse the stdout afterward.
const TEST_COMMAND_RE = /(?:^|[;&|\s])(?:npm(?:\s+run)?\s+test|npx\s+(?:jest|vitest|tap)|jest|vitest|node\s+--test|pytest)\b/i;

function looksLikeTestCommand(command) {
  if (!command || typeof command !== "string") return false;
  return TEST_COMMAND_RE.test(command);
}

module.exports = {
  parseTestOutput,
  looksLikeTestCommand,
  TEST_COMMAND_RE,
};
