// Slice E (v4) — RunHistoryStore pure-logic tests.
//
// Exercises the in-memory / localStorage-shaped layer only. A fake storage
// object with getItem/setItem/removeItem mirrors the browser API so the logic
// is tested end-to-end without jsdom.

const test = require("node:test");
const assert = require("node:assert/strict");
const { RunHistoryStore, STORAGE_KEY, DEFAULT_MAX_ENTRIES } = require("../../public/js/run-history");

function makeFakeStorage() {
  const map = new Map();
  let throwOnSet = false;
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (throwOnSet) throw new Error("QuotaExceededError");
      map.set(k, String(v));
    },
    removeItem: (k) => map.delete(k),
    _dump: () => Object.fromEntries(map.entries()),
    _throwOnNextSet: () => { throwOnSet = true; },
    _settleSet: () => { throwOnSet = false; },
  };
}

function sampleEntry(id = "run-1") {
  return {
    id,
    meta: { label: "default · A · active", templateId: "default", status: "active" },
    body: { snapshot: { status: "active" }, events: [], exportedAt: new Date().toISOString() },
  };
}

test("add() stores an entry and list() returns metadata-only view", () => {
  const storage = makeFakeStorage();
  const store = new RunHistoryStore({ storage });
  const r = store.add(sampleEntry("run-a"));
  assert.ok(r.added);
  const list = store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "run-a");
  assert.equal(list[0].meta.templateId, "default");
  // list() strips the body
  assert.ok(!("body" in list[0]));
});

test("list() returns newest-first", () => {
  const storage = makeFakeStorage();
  const store = new RunHistoryStore({ storage });
  store.add(sampleEntry("run-old"));
  store.add(sampleEntry("run-mid"));
  store.add(sampleEntry("run-new"));
  assert.deepEqual(store.list().map((e) => e.id), ["run-new", "run-mid", "run-old"]);
});

test("re-adding the same id overwrites in place without duplication", () => {
  const storage = makeFakeStorage();
  const store = new RunHistoryStore({ storage });
  store.add({ id: "run-x", meta: { label: "v1" }, body: {} });
  store.add({ id: "run-x", meta: { label: "v2" }, body: {} });
  const list = store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].meta.label, "v2");
});

test("maxEntries cap evicts oldest on overflow", () => {
  const storage = makeFakeStorage();
  const store = new RunHistoryStore({ storage, maxEntries: 3 });
  for (let i = 0; i < 5; i++) store.add(sampleEntry("run-" + i));
  const ids = store.list().map((e) => e.id);
  assert.deepEqual(ids, ["run-4", "run-3", "run-2"], "newest 3 survive");
});

test("rejects entries that exceed MAX_ENTRY_BYTES", () => {
  const storage = makeFakeStorage();
  const store = new RunHistoryStore({ storage });
  const huge = {
    id: "run-huge",
    meta: { label: "big" },
    body: { events: new Array(3000).fill({ event: { type: "tool_recorded", data: { x: "X".repeat(200) } } }) },
  };
  const r = store.add(huge);
  assert.equal(r.rejected, "entry-too-large");
  assert.equal(store.list().length, 0);
});

test("get(id) returns the full entry with body", () => {
  const storage = makeFakeStorage();
  const store = new RunHistoryStore({ storage });
  store.add({ id: "run-g", meta: { label: "g" }, body: { events: [{ event: { type: "phase_update" } }] } });
  const got = store.get("run-g");
  assert.ok(got);
  assert.equal(got.body.events[0].event.type, "phase_update");
});

test("remove(id) deletes a specific entry", () => {
  const storage = makeFakeStorage();
  const store = new RunHistoryStore({ storage });
  store.add(sampleEntry("a"));
  store.add(sampleEntry("b"));
  store.remove("a");
  assert.deepEqual(store.list().map((e) => e.id), ["b"]);
});

test("clear() wipes the manifest key", () => {
  const storage = makeFakeStorage();
  const store = new RunHistoryStore({ storage });
  store.add(sampleEntry("one"));
  store.clear();
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.equal(store.list().length, 0);
});

test("quota exceeded → falls back to half the entries rather than throwing", () => {
  const storage = makeFakeStorage();
  const store = new RunHistoryStore({ storage, maxEntries: 4 });
  store.add(sampleEntry("a"));
  store.add(sampleEntry("b"));
  // Simulate quota error on next add()
  storage._throwOnNextSet();
  // add() doesn't throw despite storage rejecting; it silently trims.
  assert.doesNotThrow(() => store.add(sampleEntry("c")));
});

test("no-storage environment is a no-op rather than a crash", () => {
  const store = new RunHistoryStore({}); // storage: null
  assert.deepEqual(store.list(), []);
  assert.doesNotThrow(() => store.add(sampleEntry("x")));
  assert.doesNotThrow(() => store.clear());
});

test("list() tolerates corrupt storage payload", () => {
  const storage = makeFakeStorage();
  storage.setItem(STORAGE_KEY, "{{ not json");
  const store = new RunHistoryStore({ storage });
  assert.deepEqual(store.list(), []);
});

test("DEFAULT_MAX_ENTRIES is exported as 10", () => {
  assert.equal(DEFAULT_MAX_ENTRIES, 10);
});
