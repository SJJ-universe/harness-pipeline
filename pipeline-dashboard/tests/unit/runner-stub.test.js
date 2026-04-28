// Slice R1-f (Phase D R1, 2026-04-28) — harness-runner stub entrypoint test.
//
// The R1-f runner/index.js is a placeholder until R1-e ships the real
// agent. We assert it exits with the documented EX_CONFIG (78) code,
// not a generic 1, so:
//
//   - Container orchestrators / CI gates can distinguish "stub" (78)
//     from "broken" (anything else).
//   - The stderr message points operators at R1-e if they wonder why
//     starting the container does nothing.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("R1-f: runner/index.js exits with EX_CONFIG (78)", () => {
  const result = spawnSync(
    process.execPath,
    [path.resolve(__dirname, "../../runner/index.js")],
  );
  assert.equal(result.status, 78, `expected exit 78, got ${result.status} (signal=${result.signal})`);
});

test("R1-f: runner/index.js stderr message references R1-e", () => {
  const result = spawnSync(
    process.execPath,
    [path.resolve(__dirname, "../../runner/index.js")],
  );
  // Operators searching the logs for the Phase D slice should land on R1-e.
  assert.match(result.stderr.toString(), /R1-e/i);
});

test("R1-f: runner/index.js stub never writes to stdout (silent on stdout)", () => {
  // Anything written to stdout would be picked up by orchestrator log
  // collectors as runner-emitted data — the stub has no data to emit.
  const result = spawnSync(
    process.execPath,
    [path.resolve(__dirname, "../../runner/index.js")],
  );
  assert.equal(result.stdout.toString(), "");
});
