// Slice Z (Phase 2.5) — checkpointStore per-run path routing.
//
// Verifies the `runId` option on createCheckpointStore:
//   - no runId               → legacy path `.harness/pipeline-checkpoint.json`
//   - runId === "default"    → same legacy path (singleton compat)
//   - any other runId        → `.harness/runs/{runId}/checkpoint.json`
//
// Also proves save/load round-trip isolation: two runIds must never see each
// other's checkpoint, and the default path must keep working untouched so
// existing single-run users need no migration.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createCheckpointStore } = require("../../executor/checkpoint");

function mkRepoRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "harness-ckpt-perrun-"));
}

function sampleActive(id) {
  return {
    templateId: "default",
    template: {
      id: "default",
      phases: [{ id: "A", label: "A", name: "Plan", allowedTools: [] }],
    },
    phaseIdx: 0,
    iteration: 0,
    gateRetries: 0,
    userPrompt: `prompt-${id}`,
    startedAt: Date.now(),
  };
}

test("default (no runId) → legacy path .harness/pipeline-checkpoint.json", () => {
  const repoRoot = mkRepoRoot();
  const store = createCheckpointStore({ repoRoot });
  assert.equal(
    store.path,
    path.join(repoRoot, ".harness", "pipeline-checkpoint.json"),
    "no runId keeps the legacy path"
  );
});

test('runId="default" → same legacy path (singleton compat)', () => {
  const repoRoot = mkRepoRoot();
  const store = createCheckpointStore({ repoRoot, runId: "default" });
  assert.equal(
    store.path,
    path.join(repoRoot, ".harness", "pipeline-checkpoint.json"),
    'runId="default" is treated as singleton and keeps the legacy path'
  );
});

test('non-default runId → .harness/runs/{runId}/checkpoint.json', () => {
  const repoRoot = mkRepoRoot();
  const storeA = createCheckpointStore({ repoRoot, runId: "runA" });
  const storeB = createCheckpointStore({ repoRoot, runId: "session-xyz" });
  assert.equal(
    storeA.path,
    path.join(repoRoot, ".harness", "runs", "runA", "checkpoint.json")
  );
  assert.equal(
    storeB.path,
    path.join(repoRoot, ".harness", "runs", "session-xyz", "checkpoint.json")
  );
});

test("save/load round-trip is isolated between runIds", () => {
  const repoRoot = mkRepoRoot();
  const storeA = createCheckpointStore({ repoRoot, runId: "A" });
  const storeB = createCheckpointStore({ repoRoot, runId: "B" });

  storeA.save(sampleActive("A"), { snapshot: () => ({ who: "A" }) });
  storeB.save(sampleActive("B"), { snapshot: () => ({ who: "B" }) });

  const loadedA = storeA.load();
  const loadedB = storeB.load();

  assert.ok(loadedA, "A's checkpoint loads");
  assert.ok(loadedB, "B's checkpoint loads");
  assert.equal(loadedA.userPrompt, "prompt-A", "A sees its own prompt");
  assert.equal(loadedB.userPrompt, "prompt-B", "B sees its own prompt");
  assert.notEqual(loadedA.userPrompt, loadedB.userPrompt, "no cross-bleed");
  assert.deepEqual(loadedA.stateSnapshot, { who: "A" });
  assert.deepEqual(loadedB.stateSnapshot, { who: "B" });
});

test("non-default runId auto-creates the .harness/runs/{runId}/ directory on save", () => {
  const repoRoot = mkRepoRoot();
  const runDir = path.join(repoRoot, ".harness", "runs", "fresh");
  assert.equal(fs.existsSync(runDir), false, "directory does not exist before save");

  const store = createCheckpointStore({ repoRoot, runId: "fresh" });
  store.save(sampleActive("fresh"), { snapshot: () => ({}) });

  assert.equal(fs.existsSync(runDir), true, "save() created the per-run directory");
  assert.equal(fs.existsSync(store.path), true, "checkpoint file exists at the expected path");
});

test("default path is untouched when a non-default run saves (singleton data safety)", () => {
  const repoRoot = mkRepoRoot();
  const defaultStore = createCheckpointStore({ repoRoot }); // no runId → legacy
  const runStore = createCheckpointStore({ repoRoot, runId: "sibling" });

  defaultStore.save(sampleActive("default"), { snapshot: () => ({ who: "default" }) });
  runStore.save(sampleActive("sibling"), { snapshot: () => ({ who: "sibling" }) });

  // Both files should exist independently.
  assert.ok(fs.existsSync(defaultStore.path), "legacy checkpoint file present");
  assert.ok(fs.existsSync(runStore.path), "per-run checkpoint file present");

  // The default path must still resolve to the singleton data.
  const reloaded = defaultStore.load();
  assert.equal(reloaded.userPrompt, "prompt-default", "legacy data unchanged");
});

test("clear() on a non-default store only removes its own file", () => {
  const repoRoot = mkRepoRoot();
  const defaultStore = createCheckpointStore({ repoRoot });
  const runStore = createCheckpointStore({ repoRoot, runId: "x" });

  defaultStore.save(sampleActive("default"), { snapshot: () => ({}) });
  runStore.save(sampleActive("x"), { snapshot: () => ({}) });

  runStore.clear();

  assert.equal(fs.existsSync(runStore.path), false, "per-run file cleared");
  assert.equal(fs.existsSync(defaultStore.path), true, "legacy file survives");
});
