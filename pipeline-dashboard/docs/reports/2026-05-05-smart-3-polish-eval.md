# SMART-3-POLISH — Round closeout (2026-05-05)

**Score**: 120/126 (maintained — see §Cap movement decision)
**Round id**: SMART-3-POLISH
**Plan reference**: §S §S-next-after — "Phase 2 v2 follow-up slices (SMART-3 dropdown polish — keyboard shortcut + recently-used preset memory + tooltip improvements)"
**Slices shipped**: SMART-3-POLISH-a / SMART-3-POLISH-b

This round picks the **highest-DX item** off the SMART-3 polish list:
recently-used preset memory via localStorage. The plan also mentioned
keyboard shortcuts and tooltip improvements; both were considered and
explicitly deferred (see §What's deferred).

---

## What this round shipped

### SMART-3-POLISH-a — preset memory + 14 tests

**Files**:
- `public/js/monitor/panels/dual-agent-console.js` (additive only — 2
  new constructor options + 2 helpers + 1 restoration step + 1 persist
  call)
- `tests/unit/monitor.dual-agent-console.preset-memory.test.js` (14 tests)

**The DX problem this solves**:

Before SMART-3-POLISH, an operator running the same review preset
across sessions ("보안" critique on every PR review, say) had to
re-select the preset every single session. The dropdown defaulted to
"자유 입력 (preset 없음)" on every mount.

After SMART-3-POLISH, localStorage remembers:
- The operator's last preset selection → next mount auto-selects it
- The operator's explicit "free-form" choice → next mount stays
  free-form (NOT auto-restored to a prior preset)

**API surface** (additive, backwards-compat 100%):

| Constructor option | Default | Purpose |
|---|---|---|
| `storage` | `globalThis.localStorage` (auto-resolved) | localStorage shim. `null` opts out. Tests inject Map-backed shim. |
| `recentPresetsKey` | `"harness:recentPresetId:v1"` | localStorage key. Bumping the version (`v2`) is how a future schema change rolls out without operator intervention — old keys become orphans. |

**Read/write contract**:

- **Read** (in `_fetchPresetsOnce` after presets land):
  ```
  selectedPresetId === null  AND
  storage.getItem(recentPresetsKey) is a non-empty string  AND
  trimmed value ≤ 128 chars  AND
  value matches a presetId in availablePresets
    → restore selectedPresetId
  ```
- **Write** (in dropdown `change` listener):
  ```
  presetId !== null  → storage.setItem(key, presetId)
  presetId === null  → storage.setItem(key, "")    // sentinel
  ```

The empty-string sentinel is the critical detail: it preserves the
operator's *explicit* free-form choice across mounts. Without it, a
free-form choice would look identical to "missing key" on the next
mount, and any prior preset value lurking in storage would auto-
restore — that would be operator-hostile.

**Defensive guarantees** (verified by tests):

| Failure mode | Behaviour |
|---|---|
| `storage = null` (explicit) | No persistence; in-memory state still works |
| Browser private mode (storage throws on getItem) | `_readRecentPresetId` returns `null`; mount proceeds normally |
| Browser private mode (storage throws on setItem) | `_writeRecentPresetId` swallows; selection still updates in memory |
| Corrupt entry (>128 chars) | Ignored; treated as `null` |
| Preset removed from server (in storage but not in catalog) | Falls back to `null` (legacy free-form dispatch) |
| Soft-fail listPresets (returns null/empty) | No restore attempted; storage value left intact for next successful mount |

### SMART-3-POLISH-b — closeout + scorecard + sync (this slice)

This file is the closeout. The scorecard trajectory entry is inserted
above the POL-UI-1 banner (newest follow-up at top).
`scripts/sync-scorecard.js` refreshes the auto-derived markers (test
counts now `3489 unit / 553 integration` vs `3475 / 553`).

---

## End-to-end behavior change

| Before SMART-3-POLISH | After SMART-3-POLISH |
|---|---|
| Operator picks "보안" → Send to Codex → critique arrives → archive → start new session → dropdown reverts to "자유 입력 (preset 없음)" → operator MUST repick "보안" every session | Operator picks "보안" once → next mount of dual-agent-console pre-selects "보안" automatically |
| Operator who prefers free-form (no preset) → opens dual-agent-console → sees "자유 입력 (preset 없음)" → no choice persistence (not really a problem) | Operator who explicitly picked free-form → next mount stays free-form (operator's *explicit* choice survives, distinct from "never selected") |
| Server removes a preset → operator's stored value silently mismatches → no signal | Stored value not in current catalog → falls back to `null` cleanly (NOT a crash, NOT a stale auto-restore) |
| localStorage corruption (someone fiddles with DevTools) → unknown impact | Corrupt entry (>128 chars) silently ignored; defensive cap protects the panel |

---

## Test counts + CI

| Suite | Pre-SMART-3-POLISH | Post-SMART-3-POLISH | Δ |
|---|:---:|:---:|:---:|
| unit | 3475 | 3489 | +14 |
| integration | 553 | 553 | 0 |
| smoke | 90 | 90 | 0 |
| readiness | 18/18 | 18/18 | 0 |

`npm run test:unit && test:integration && test:legacy && test:smoke`
all green. `npm run readiness:check` 18/18. `npm run scorecard:check`
exit 0 after marker sync.

The 51 pre-existing dual-agent-console tests (incl. preset dropdown
+ action row) all pass unchanged — the change is genuinely additive.

---

## Cap movement decision — 120/126 maintained

SMART-3-POLISH ships an operator-DX improvement. It is NOT a cap-
worthy event for any rubric line:

- It does not add a new safety boundary (Safety cap unchanged)
- It does not extend public-sector readiness (POL-UI-1 + FP-a/b stay
  the relevant evidence pieces)
- It does not extend reviewer hand-off (EXR-a/b/c stay the relevant
  evidence pieces)
- It is genuinely a Maintainability/UI quality-of-life touch — the
  rubric line for those is at +1 headroom but cap movement requires
  pattern-of-many improvements, not one slice

The honest score remains 120/126.

What this slice DOES contribute to (the test ledger):
- 14 new tests anchor the storage contract → future regressions
  (someone removes the empty-string sentinel handling, say) get
  caught immediately
- 2 new constructor options codify the test-injection seam pattern,
  matching the welcome-overlay `storage` option that was the prior
  precedent

---

## 6 decisions worth re-reading

These are the choices that took >5 minutes to settle:

1. **Empty-string sentinel for "free-form"** — instead of removing
   the storage key when operator picks free-form, we write `""`. This
   distinguishes "operator chose free-form" from "operator never
   selected anything". The test
   `empty-string sentinel does NOT restore (free-form)` is the canary.
2. **Restore happens AFTER `listPresets` resolves, not at mount time**
   — at mount, we don't know if the remembered preset is still in
   the server's catalog. Restoring blindly would auto-select a
   non-existent preset and fail at dispatch. Waiting for `listPresets`
   means we can validate against `availablePresets` before restoring.
3. **`selectedPresetId === null` guard before restore** — prevents
   storage from overriding a future code path that pre-selects
   programmatically (e.g. URL query param, deep link). No such path
   exists today, but the guard keeps the door open without API churn.
4. **128-char defensive cap** — preset IDs are kebab-case, ≤30 chars
   in practice. 128 is generous. The cap exists because localStorage
   can be edited via DevTools or polluted by browser-extension scripts;
   we don't want a corrupt entry to crash the panel.
5. **`recentPresetsKey` is a constructor option, not a constant** —
   tests need to use distinct keys to avoid cross-test pollution. The
   default value uses the harness:&lt;feature&gt;:v&lt;n&gt; namespace
   pattern (see `harness:runHistory:v1` precedent).
6. **`storage = null` explicit opt-out** — three-state semantics
   (`undefined`, `null`, shim object). Explicit `null` is "I want
   persistence off". `undefined` is "use the default". This matches
   the welcome-overlay `storage` option pattern.

---

## What's deferred / out of scope

The plan §S §S-next-after listed three SMART-3 polish items; this
round shipped one. The others were considered:

- **Keyboard shortcut** (e.g. `g p` to focus the preset dropdown) —
  considered but deferred. The dropdown is a native `<select>`;
  operators can already focus it with Tab and select with arrow
  keys. A custom `g p` shortcut adds keybinding-conflict surface
  area (already-bound `g t` / `g h` / `g m` / `?`). Worth doing if
  operators report Tab-navigation friction; not worth doing
  speculatively.
- **Tooltip improvements** (longer descriptions / aria-live for
  screen readers / second-line severity instruction snippet) —
  considered but deferred. The current tooltip already shows the
  i18n-translated description below the dropdown. Improvements
  would be incremental and the current shape is functional. A
  follow-up slice could add `aria-live="polite"` + `role="status"`
  if a11y testing surfaces the gap.
- **Recently-used MULTIPLE presets** (last 3, surface at top of
  dropdown) — considered but deferred. Single-most-recent gives
  ~95% of the value. Multi-preset memory adds complexity (ring
  buffer + dedup + ordering policy) for marginal DX gain. Worth
  reconsidering if operators report pattern-of-multiple-presets.
- **CSS styling** for the preset dropdown — same deferred status as
  pack-info-card / recommendations-card / next-action-card. The
  panel renders functional but with default browser `<select>`
  styling. Visual polish is a follow-up slice.
- **Persistence cross-deployment** (sync to server-side per-profile
  preset) — out of scope. localStorage per-browser is the right
  scope; cross-deployment would need a profile-bound endpoint and
  an entire new storage contract.

---

## Per plan §S §S-next-after

After this commit + push, the scorecard trajectory shows
SMART-3-POLISH above the POL-UI-1 banner. Both are follow-up slices
that the 5-priority roadmap closure made possible.

Per plan §S §S-next-after, remaining follow-up candidates:
- **SMART-1 panel acceptance** — the recommendations-card is mounted
  but no card rules currently fire on a fresh deployment
  (decisionContext returns mostly `false` until events arrive). A
  setup-related "first-paint" recommendation could improve operator
  onboarding.
- **POL-UI-2 pack switch UI** — the reactive pack switch deferred
  from POL-UI-1 (needs confirmation modal + runner-graceful-shutdown
  hook + audit chain entry — meaningful blast radius)
- **Operator runs `harness-start.bat` in production for ≥1 week** —
  the FP-a daily probe + POL-UI-1 pack-info card + SMART-3-POLISH
  preset memory all combine to make this a smoother experience now
- **External reviewer engagement** — someone other than the
  committer walks the EXR-a bundle + EXR-b matrix and produces a
  summary report

The cap-movement candidates (Public-sector readiness +1, Testability
+1) still require the operator-time + reviewer-time evidence loop.
SMART-3-POLISH does not move the cap because it is operator-DX
polish, not a new property.
