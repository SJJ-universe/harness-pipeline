// Slice SMART-1-b (Phase 2 SMART arc, 2026-05-04) — dismissed-
// recommendations slice tests.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createMonitorStore } = require("../../public/js/monitor/store");

test("SMART-1 store: dismissed-rec actions exposed in API", () => {
  const store = createMonitorStore();
  for (const fn of ["dismissRecommendation", "undoDismissRecommendation",
                    "clearDismissedRecommendations"]) {
    assert.equal(typeof store[fn], "function",
      `store API must expose "${fn}"`);
  }
});

test("SMART-1 store: initial snapshot.dismissedRecommendations is empty array", () => {
  const store = createMonitorStore();
  assert.deepEqual(store.snapshot().dismissedRecommendations, []);
});

test("SMART-1 store: dismissRecommendation adds to slice", () => {
  const store = createMonitorStore();
  store.dismissRecommendation("complete-profile-setup");
  store.dismissRecommendation("monitor-active-runs");
  assert.deepEqual(
    store.snapshot().dismissedRecommendations.slice().sort(),
    ["complete-profile-setup", "monitor-active-runs"].sort(),
  );
});

test("SMART-1 store: dismissRecommendation is idempotent (no double-publish)", () => {
  const store = createMonitorStore();
  let publishes = 0;
  store.subscribe(() => { publishes += 1; });
  store.dismissRecommendation("rule-1");
  const after = publishes;
  store.dismissRecommendation("rule-1");  // duplicate
  assert.equal(publishes, after,
    "duplicate dismiss must not publish (no notify churn)");
  assert.equal(store.snapshot().dismissedRecommendations.length, 1);
});

test("SMART-1 store: dismissRecommendation rejects empty/invalid IDs", () => {
  const store = createMonitorStore();
  store.dismissRecommendation("");
  store.dismissRecommendation(null);
  store.dismissRecommendation(42);
  store.dismissRecommendation(undefined);
  assert.deepEqual(store.snapshot().dismissedRecommendations, [],
    "invalid input must be ignored");
});

test("SMART-1 store: undoDismissRecommendation removes from slice", () => {
  const store = createMonitorStore();
  store.dismissRecommendation("rule-1");
  store.dismissRecommendation("rule-2");
  store.undoDismissRecommendation("rule-1");
  assert.deepEqual(store.snapshot().dismissedRecommendations, ["rule-2"]);
});

test("SMART-1 store: undoDismissRecommendation no-op when not dismissed", () => {
  const store = createMonitorStore();
  let publishes = 0;
  store.subscribe(() => { publishes += 1; });
  store.undoDismissRecommendation("never-dismissed");
  assert.equal(publishes, 0,
    "undo on non-dismissed → no publish");
});

test("SMART-1 store: clearDismissedRecommendations empties slice + publishes", () => {
  const store = createMonitorStore();
  store.dismissRecommendation("rule-1");
  store.dismissRecommendation("rule-2");
  let publishes = 0;
  store.subscribe(() => { publishes += 1; });
  store.clearDismissedRecommendations();
  assert.deepEqual(store.snapshot().dismissedRecommendations, []);
  assert.equal(publishes, 1, "clear must publish exactly once");
});

test("SMART-1 store: clearDismissedRecommendations no-op when already empty", () => {
  const store = createMonitorStore();
  let publishes = 0;
  store.subscribe(() => { publishes += 1; });
  store.clearDismissedRecommendations();
  assert.equal(publishes, 0,
    "clear on empty → no publish (notify-churn avoidance)");
});

test("SMART-1 store: snapshot returns sorted array (stable test asserts)", () => {
  const store = createMonitorStore();
  store.dismissRecommendation("c-rule");
  store.dismissRecommendation("a-rule");
  store.dismissRecommendation("b-rule");
  assert.deepEqual(
    store.snapshot().dismissedRecommendations,
    ["a-rule", "b-rule", "c-rule"],
  );
});

test("SMART-1 store: snapshot returns NEW array (caller mutation isolation)", () => {
  const store = createMonitorStore();
  store.dismissRecommendation("rule-1");
  const arr1 = store.snapshot().dismissedRecommendations;
  // Caller mutates retrieved array
  arr1.push("tampered");
  arr1.length = 0;
  // Store internal Set unaffected
  const arr2 = store.snapshot().dismissedRecommendations;
  assert.deepEqual(arr2, ["rule-1"],
    "caller mutation of returned array must not affect store");
});
