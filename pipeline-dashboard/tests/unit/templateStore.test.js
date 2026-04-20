// Slice E (v4) — templateStore atomic read/write + backup regression.
//
// Exercises:
//   - Empty/missing manifest starts with empty custom set
//   - upsert() persists and returns { id, savedAt }
//   - Backups are created on rewrite
//   - remove() returns false for unknown ids
//   - Built-in ids can't be written or deleted via the store
//   - Atomic write: the manifest never contains a partial object on disk

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createTemplateStore, CUSTOM_ID_RE } = require("../../src/templates/templateStore");

const BUILTINS = {
  default: { id: "default", name: "Default", phases: [] },
  "code-review": { id: "code-review", name: "Code Review", phases: [] },
};

function mkTmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "harness-tplstore-"));
}

test("listCustom() / listAll() start empty when no manifest exists", () => {
  const store = createTemplateStore({ repoRoot: mkTmpRoot(), builtins: BUILTINS });
  assert.deepEqual(store.listCustom(), {});
  assert.deepEqual(Object.keys(store.listAll()).sort(), ["code-review", "default"]);
});

test("upsert() writes atomic file + returns savedAt", () => {
  const root = mkTmpRoot();
  const store = createTemplateStore({ repoRoot: root, builtins: BUILTINS });
  const before = Date.now();
  const res = store.upsert({ id: "custom-a", name: "A", phases: [{ id: "A" }] });
  const after = Date.now();
  assert.equal(res.id, "custom-a");
  assert.ok(res.savedAt >= before && res.savedAt <= after + 10);
  // manifest file exists on disk
  const manifest = JSON.parse(fs.readFileSync(path.join(root, ".harness", "templates.json"), "utf-8"));
  assert.equal(manifest["custom-a"].name, "A");
});

test("listAll() merges built-ins with customs; built-ins stay intact", () => {
  const root = mkTmpRoot();
  const store = createTemplateStore({ repoRoot: root, builtins: BUILTINS });
  store.upsert({ id: "custom-x", name: "X", phases: [{ id: "A" }] });
  const merged = store.listAll();
  assert.equal(merged["custom-x"].name, "X");
  assert.equal(merged["default"].name, "Default");
  assert.equal(merged["code-review"].name, "Code Review");
});

test("upsert() rejects built-in ids (defense in depth)", () => {
  const store = createTemplateStore({ repoRoot: mkTmpRoot(), builtins: BUILTINS });
  assert.throws(
    () => store.upsert({ id: "default", name: "hijack", phases: [] }),
    /(match)|(cannot overwrite)/
  );
});

test("upsert() rejects ids that don't match /^custom-[a-z0-9_-]{1,40}$/", () => {
  const store = createTemplateStore({ repoRoot: mkTmpRoot(), builtins: BUILTINS });
  assert.throws(() => store.upsert({ id: "myplan" }), /match/);
  assert.throws(() => store.upsert({ id: "custom-" }), /match/); // empty suffix
  assert.throws(() => store.upsert({ id: "custom-" + "x".repeat(41) }), /match/);
});

test("remove() returns false for missing ids, true on delete", () => {
  const store = createTemplateStore({ repoRoot: mkTmpRoot(), builtins: BUILTINS });
  assert.equal(store.remove("custom-missing"), false);
  store.upsert({ id: "custom-rm", name: "rm", phases: [{ id: "A" }] });
  assert.equal(store.remove("custom-rm"), true);
  assert.equal(store.listCustom()["custom-rm"], undefined);
});

test("remove() rejects non-custom ids", () => {
  const store = createTemplateStore({ repoRoot: mkTmpRoot(), builtins: BUILTINS });
  assert.throws(() => store.remove("default"), /not a custom id/);
});

test("backups are created on overwrite", () => {
  const root = mkTmpRoot();
  const store = createTemplateStore({ repoRoot: root, builtins: BUILTINS });
  store.upsert({ id: "custom-a", name: "v1", phases: [{ id: "A" }] });
  store.upsert({ id: "custom-a", name: "v2", phases: [{ id: "A" }] });
  const backupDir = path.join(root, ".harness", "templates-backup");
  assert.ok(fs.existsSync(backupDir), "backup dir should exist");
  const backups = fs.readdirSync(backupDir);
  assert.ok(backups.length >= 1, "at least one backup file");
});

test("corrupt manifest falls back to empty without throwing", () => {
  const root = mkTmpRoot();
  const harnessDir = path.join(root, ".harness");
  fs.mkdirSync(harnessDir, { recursive: true });
  fs.writeFileSync(path.join(harnessDir, "templates.json"), "{ not json :(");
  const store = createTemplateStore({ repoRoot: root, builtins: BUILTINS });
  assert.deepEqual(store.listCustom(), {});
  // Upsert on top of the corrupt file recovers atomically.
  store.upsert({ id: "custom-after-corrupt", name: "y", phases: [{ id: "A" }] });
  assert.ok(store.listCustom()["custom-after-corrupt"]);
});

test("manifest load strips entries whose ids aren't custom-* (defense in depth)", () => {
  const root = mkTmpRoot();
  const harnessDir = path.join(root, ".harness");
  fs.mkdirSync(harnessDir, { recursive: true });
  // Manually craft a manifest that tries to smuggle in a default override.
  fs.writeFileSync(
    path.join(harnessDir, "templates.json"),
    JSON.stringify({
      "default": { id: "default", name: "hijacked", phases: [] },
      "custom-ok": { id: "custom-ok", name: "ok", phases: [] },
    })
  );
  const store = createTemplateStore({ repoRoot: root, builtins: BUILTINS });
  const listed = store.listCustom();
  assert.ok(!listed["default"], "built-in smuggling must be dropped on load");
  assert.ok(listed["custom-ok"]);
});

test("isBuiltinId / isCustomId helpers match their regex contract", () => {
  const store = createTemplateStore({ repoRoot: mkTmpRoot(), builtins: BUILTINS });
  assert.ok(store.isBuiltinId("default"));
  assert.ok(!store.isBuiltinId("custom-x"));
  assert.ok(store.isCustomId("custom-x"));
  assert.ok(!store.isCustomId("default"));
  assert.ok(CUSTOM_ID_RE.test("custom-ok"));
});

test("filePath points at .harness/templates.json under repoRoot", () => {
  const root = mkTmpRoot();
  const store = createTemplateStore({ repoRoot: root, builtins: BUILTINS });
  assert.equal(store.filePath, path.join(root, ".harness", "templates.json"));
});
