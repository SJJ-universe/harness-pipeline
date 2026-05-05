# I18N-PARITY-1 — Round closeout (2026-05-05)

**Score**: 120/126 (maintained — see §Cap movement decision)
**Round id**: I18N-PARITY-1
**Plan reference**: §S §S-next-after — extends the existing
`tests/unit/i18n.coverage.test.js` gate (Slice I, v5) with a class
of regression that the prior gate didn't catch
**Slices shipped**: I18N-PARITY-1-a / I18N-PARITY-1-b

This round closes a **silent-translation-loss** regression class
that the existing `i18n.coverage.test.js` couldn't catch. Across
the 5 prior follow-up rounds, many i18n keys were added (POL-c +23,
SMART-3 +17, POL-UI-1 +10, SMART-1-BASELINE +3 per locale, etc.).
The existing gate verified key-set parity + non-empty string
values, but NOT that templated `{placeholder}` names matched
across locales.

---

## What this round shipped

### I18N-PARITY-1-a — placeholder consistency gate + 9 tests

**Files**:
- `tests/unit/i18n.placeholder-parity.test.js` (NEW, 290 lines)

**The regression class this closes**:

Before I18N-PARITY-1, a committer could write:
```js
ko["x"] = "하드 게이트: {mode}"
en["x"] = "Hard gates: {m}"      // typo: {m} instead of {mode}
```

Existing tests pass (key sets match, both non-empty). At runtime
`HarnessI18n.t("x", { mode: "hard" })` substitutes correctly in
ko ("하드 게이트: hard") but leaves the literal `{m}` in en
("Hard gates: {m}"). Operators on English see broken UI;
operators on Korean see correct UI; the committer is none the
wiser. CI is green.

After I18N-PARITY-1-a, the test fails fast with:
```
1 key(s) have placeholder drift between ko and en — fix all of
them in one commit:
  - "x": ko=["mode"] en=["m"] missingInEn=["mode"] missingInKo=["m"]
```

**The 9 tests**:

| # | Test | Catches |
|---|---|---|
| 1 | Per-key placeholder set parity | The headline drift case |
| 2 | "Looks like placeholder but isn't" detection | Translator typos: `{ mode }` (space-padded), `{tool-name}` (hyphenated), `{}` (empty) — patterns that look like placeholders but don't match the runtime regex |
| 3 | Mixed-case anomalies across locales | ko `{mode}` vs en `{Mode}` (case-sensitive substitution) |
| 4 | Sanity: ≥ 80% keys have translated values | Block accidentally synced from English into ko |
| 5 | No leading/trailing whitespace | Edge-whitespace typos in localized strings |
| 6 | Anchor: extractPlaceholders matches runtime regex | Belt-and-suspenders if HarnessI18n.t regex changes |
| 7 | Anchor: findSuspiciousBraces detects typos correctly | Regression test for the helper itself |
| 8 | Total key count ≥ 200 | Block-deletion canary (existing test gates at ≥ 40 — tightened in light of accumulated surface) |
| 9 | Round-trip: substitution produces no leftover `{word}` patterns | Verifies the runtime regex + value + params triple is internally consistent |

**Drift collection** (one-shot fail message): the headline test
collects all drifts across the 221+ keys before failing, so a
committer fixing 5 silent drifts doesn't have to re-run the test
5 times. The fail message lists every drifting key with both
locales' placeholder sets + the missing names per locale.

### I18N-PARITY-1-b — closeout + scorecard + sync (this slice)

This file is the closeout. The scorecard trajectory entry is inserted
above the EXR-d banner. `scripts/sync-scorecard.js` refreshes the
auto-derived markers (test counts now `3563 unit / 553 integration`
vs `3554 / 553`).

---

## End-to-end behavior change

| Before I18N-PARITY-1 | After I18N-PARITY-1 |
|---|---|
| Committer adds `ko["x"] = "{mode}"` + `en["x"] = "{m}"` (typo) → existing tests pass → UI silently broken for one locale | Same scenario → I18N-PARITY-1-a fails with structured "fix all of them in one commit" message listing every drift |
| Translator typos like `{ mode }` (space-padded) or `{tool-name}` (hyphenated) silently survive into rendered strings | Caught explicitly with "looks like placeholder but isn't" detection |
| ko has `{mode}` but en has `{Mode}` (case-sensitive substitution) → fails silently in production | Mixed-case anomaly test catches this drift across locales |
| Whitespace-edged values like `" 닫기 "` silently introduce alignment bugs | "No leading/trailing whitespace" test catches it |
| Block of English keys accidentally synced into ko.js → invisible until an operator reports broken UI | Sanity threshold (≥ 80% translated) catches this |

---

## Test counts + CI

| Suite | Pre-I18N-PARITY-1 | Post-I18N-PARITY-1 | Δ |
|---|:---:|:---:|:---:|
| unit | 3554 | 3563 | +9 |
| integration | 553 | 553 | 0 |
| smoke | 90 | 90 | 0 |
| readiness | 18/18 | 18/18 | 0 |

`npm run test:unit && test:integration && test:legacy && test:smoke`
all green. `npm run readiness:check` 18/18. `npm run scorecard:check`
exit 0 after marker sync.

---

## Cap movement decision — 120/126 maintained

I18N-PARITY-1 ships a tests-only gate. It is NOT a cap-worthy event:
- It does not add a new safety boundary (Safety cap unchanged)
- It does not extend public-sector readiness (POL-UI-1 + FP-a/b
  remain the relevant evidence)
- It does not extend reviewer hand-off (EXR-a/b/c/d remain relevant)
- It is genuinely a Testability/Maintainability quality-of-life
  touch — same rubric position as the prior 5 follow-up rounds

What this slice DOES contribute:
- 9 new tests close a real regression class (silent translation
  loss). The existing 221+ i18n keys all pass — confirms the
  existing translation table is healthy AND establishes a baseline
  for future additions.
- The harness now has TWO complementary i18n gates:
  - `i18n.coverage.test.js` (Slice I, v5): key set parity +
    non-empty values
  - `i18n.placeholder-parity.test.js` (this round): placeholder
    set parity + suspicious-brace detection + casing parity +
    sanity thresholds

The honest score remains 120/126.

---

## 5 decisions worth re-reading

1. **One-shot fail message, not fail-fast** — the headline test
   collects every drift across all 221+ keys before failing.
   Fail-fast on the first drift would force the committer to
   re-run the test once per fix; one-shot lets them fix all in
   one commit. Cost: slightly slower test (still <1ms total).
2. **Anchor tests for both helpers** — `extractPlaceholders` and
   `findSuspiciousBraces` each have a dedicated unit test that
   pins their expected output for known-good and known-bad inputs.
   These guard against silent helper drift if a future edit
   changes the regex or the suspicious-brace logic.
3. **80% translation threshold, not per-key** — some keys
   legitimately have ko === en (proper nouns like "Codex CLI",
   schema strings like `harness-policy-pack/v1`). A strict
   per-key check would have many false positives. 80% is the
   "would catch a block-sync mistake but tolerate proper nouns"
   threshold.
4. **200-key floor, not 40** — the existing
   `i18n.coverage.test.js` gates at ≥ 40 (the original v5
   threshold). Today's surface is 221+ keys; ≥ 200 is the
   block-deletion canary that tightens the floor without forcing
   a brittle exact-count match.
5. **Round-trip test, not just static parity** — test #9 actually
   substitutes stub values and verifies no `{word}` patterns
   remain. This catches a class of bug where the regex is right
   but the parameter shape isn't (e.g. `{mode}` accidentally typed
   as `{Mode}` everywhere — static parity passes; round-trip
   fails because case-sensitive substitution leaves the literal).

---

## What's deferred / out of scope

Foundation is shipped; these are follow-up slices:

- **Stricter casing convention** — currently the test allows
  both `{mode}` and `{count}` mixed (snake_case-friendly chars),
  but doesn't force snake_case OR camelCase consistently. A
  future round could enforce one convention globally — but that's
  a cosmetic policy decision.
- **Translation-quality detection** — beyond mechanical parity, a
  future test could check that ko values contain Korean characters
  (Hangul) and en values are predominantly Latin. Today the test
  only checks length + identical-pct.
- **Pluralization parity** — i18n keys today don't use ICU
  plural forms (`{count, plural, ...}`); the harness handles
  count by including the number in the value ("3개 작업"). If
  ICU is added later, parity would need new logic.
- **i18n key namespace conventions** — keys are dot-namespaced
  ("smart.rec.systemReady.title") but no test verifies the
  namespace is consistent within a feature. A future round
  could enforce that all `smart.rec.*` keys have a sibling
  `.title` / `.body` / `.cta` triple, etc.
- **Multi-locale support** — today only ko + en. If a future
  round adds ja or zh, the test will need to compare 3+ locales
  (currently hardcoded to 2).

---

## Per plan §S §S-next-after

After this commit + push, the scorecard trajectory shows
I18N-PARITY-1 above the EXR-d banner. I18N-PARITY-1 is the sixth
follow-up slice since the 5-priority roadmap closed.

Per plan §S §S-next-after, remaining follow-up candidates:
- **POL-UI-2 pack switch UI** — reactive switch with confirmation
  modal + runner-graceful-shutdown hook + audit chain entry
  (meaningful blast radius — runtime mutation of policy state)
- **Operator runs `harness-start.bat` in production for ≥1 week** —
  the FP-a daily probe + 5 follow-up rounds + I18N-PARITY-1 now
  combine to a smoother experience
- **External reviewer engagement** — apparatus is fully ready
  (EXR-a/b/c/d all shipped)
- **Pixel-diff visual testing** — Playwright/Puppeteer baseline
- **CSS-2** — additional surfaces (most candidates already styled;
  would need to find new targets)
- **Multi-summary aggregation tool** — speculative until
  multiple summaries exist
- **Translation-quality detection** — beyond mechanical parity
  (the deferred item from this round)

The cap-movement candidates (Public-sector readiness +1,
Testability +1, Safety +1) remain apparatus-complete. The
operator-time + reviewer-time evidence loop is the only remaining
gate. I18N-PARITY-1 does not move the cap because it is a
test-only addition, not a new property.
