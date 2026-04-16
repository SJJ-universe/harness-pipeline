const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createCheckpointStore } = require("../../executor/checkpoint");

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "harness-checkpoint-"));
}

test("checkpoint store saves and loads active phase snapshot", () => {
  const root = tempRoot();
  const store = createCheckpointStore({ repoRoot: root, ttlMs: 60_000 });
  const active = {
    templateId: "default",
    template: { id: "default", phases: [{ id: "A" }, { id: "B" }] },
    phaseIdx: 1,
    iteration: 2,
    gateRetries: 1,
    userPrompt: "please implement",
    startedAt: 1234,
  };
  const state = { snapshot: () => ({ metrics: { toolCount: 3 } }) };

  store.save(active, state);
  const loaded = store.load();

  assert.equal(loaded.templateId, "default");
  assert.equal(loaded.phaseIdx, 1);
  assert.equal(loaded.iteration, 2);
  assert.equal(loaded.gateRetries, 1);
  assert.deepEqual(loaded.templateSnapshot.phases.map((p) => p.id), ["A", "B"]);
  assert.equal(loaded.stateSnapshot.metrics.toolCount, 3);
});

test("checkpoint store clears checkpoint file", () => {
  const root = tempRoot();
  const store = createCheckpointStore({ repoRoot: root, ttlMs: 60_000 });
  store.save({
    templateId: "default",
    template: { id: "default", phases: [{ id: "A" }] },
    phaseIdx: 0,
    iteration: 0,
    gateRetries: 0,
    userPrompt: "x",
    startedAt: Date.now(),
  }, { snapshot: () => ({}) });

  assert.ok(fs.existsSync(store.path));
  store.clear();
  assert.equal(fs.existsSync(store.path), false);
});

test("checkpoint store ignores expired checkpoint", () => {
  const root = tempRoot();
  const store = createCheckpointStore({ repoRoot: root, ttlMs: 1 });
  store.save({
    templateId: "default",
    template: { id: "default", phases: [{ id: "A" }] },
    phaseIdx: 0,
    iteration: 0,
    gateRetries: 0,
    userPrompt: "x",
    startedAt: Date.now(),
  }, { snapshot: () => ({}) });

  const raw = JSON.parse(fs.readFileSync(store.path, "utf-8"));
  raw.savedAt = Date.now() - 10_000;
  fs.writeFileSync(store.path, JSON.stringify(raw), "utf-8");

  assert.equal(store.load(), null);
  assert.equal(fs.existsSync(store.path), false);
});

test("checkpoint store quarantines corrupt checkpoint", () => {
  const root = tempRoot();
  const store = createCheckpointStore({ repoRoot: root, ttlMs: 60_000 });
  fs.mkdirSync(path.dirname(store.path), { recursive: true });
  fs.writeFileSync(store.path, "{not-json", "utf-8");

  assert.equal(store.load(), null);
  assert.equal(fs.existsSync(store.path), false);
  const files = fs.readdirSync(path.dirname(store.path));
  assert.ok(files.some((name) => name.includes("pipeline-checkpoint.corrupt")));
});
