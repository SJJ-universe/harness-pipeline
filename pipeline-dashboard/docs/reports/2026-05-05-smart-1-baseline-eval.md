# SMART-1-BASELINE — Round closeout (2026-05-05)

**Score**: 120/126 (maintained — see §Cap movement decision)
**Round id**: SMART-1-BASELINE
**Plan reference**: §S §S-next-after — "SMART-1 panel acceptance (no card rules fire on fresh deployment; setup-related first-paint recommendation could improve onboarding)"
**Slices shipped**: SMART-1-BASELINE-a / SMART-1-BASELINE-b

This round closes the recommendations-card empty-state UX gap that
the SMART-3-POLISH closeout flagged as a candidate. On fresh
deployments with an active profile but no events yet, operators were
landing on "현재 권장 행동이 없습니다." (technically correct,
operator-hostile). The baseline rule fills that gap with a positive
"✓ 시스템 준비됨" confirmation while never competing for slot space
with real urgent recommendations.

---

## What this round shipped

### SMART-1-BASELINE-a — engine baseline rule + 14 tests

**Files**:
- `public/js/runtime/recommendationEngine.js` (additive only — 1 new
  rule entry + 1 post-processing pass)
- `public/js/i18n/{ko,en}.js` (3 new keys per locale, parity)
- `tests/unit/recommendationEngine.test.js` (2 invariant updates)
- `tests/unit/monitor.recommendations-card.test.js` (1 update — the
  "ready-state empty" test now asserts the populated baseline)
- `tests/unit/recommendationEngine.baseline.test.js` (14 new tests)

**The new rule**:

```js
{
  id: "system-ready",
  severity: "info",
  isBaseline: true,
  appliesTo: function (ctx) {
    const b = ctx && ctx.booleans;
    return !!(b && b.hasActiveProfile);
  },
  ctaActionId: "open-setup-wizard",  // safe — never mutates state
  // titleKey / bodyKey / ctaKey + Korean fallbacks
}
```

**The engine post-processing** (the key contract):

After all rules evaluate, `recommendFromContext` runs:
1. Collect all matching rules (existing behavior)
2. **NEW**: If any non-baseline rule matches, filter out all baseline
   matches before sorting + returning
3. Sort by severity then rule index (existing behavior)
4. Return — output preserves `isBaseline` on every rec so panels can
   branch (e.g. CSS variant for the "all clear" state)

This means:
- Quiet context (hasActiveProfile=true, nothing else) → 1 rec: `system-ready`
- Any urgent signal (PII / approval / active runs / public-sector PII) → urgent recs only, baseline filtered
- !hasActiveProfile → `complete-profile-setup` (critical) — baseline can never apply because its `appliesTo` requires hasActiveProfile=true

### SMART-1-BASELINE-b — closeout + scorecard + sync (this slice)

This file is the closeout. The scorecard trajectory entry is inserted
above the SMART-3-POLISH banner (newest follow-up at top).
`scripts/sync-scorecard.js` refreshes the auto-derived markers (test
counts now `3503 unit / 553 integration` vs `3489 / 553`).

---

## End-to-end behavior change

| Before SMART-1-BASELINE | After SMART-1-BASELINE |
|---|---|
| Operator boots harness with active profile + no events → recommendations-card lands on "현재 권장 행동이 없습니다." Empty. Operator unsure if system is OK or broken. | Same scenario → "✓ 시스템 준비됨" rec appears with reassuring body + non-mutating CTA to setup wizard. Operator confidence: explicit "all clear" signal. |
| When recommendations exist, the empty-state path is dead code — but it's the dominant first-paint experience for new operators (no work done yet → no recs). | When real recommendations fire, the baseline is filtered out and the urgent recs take the slot. The empty-state markup remains as a fallback for operators who explicitly dismiss the baseline. |
| The empty state was technically correct ("nothing to recommend") but operationally hostile — it didn't communicate "system is healthy". | The baseline communicates "system is healthy + you're set up + here's what you might do". |

---

## Test counts + CI

| Suite | Pre-SMART-1-BASELINE | Post-SMART-1-BASELINE | Δ |
|---|:---:|:---:|:---:|
| unit | 3489 | 3503 | +14 |
| integration | 553 | 553 | 0 |
| smoke | 90 | 90 | 0 |
| readiness | 18/18 | 18/18 | 0 |

`npm run test:unit && test:integration && test:legacy && test:smoke`
all green. `npm run readiness:check` 18/18. `npm run scorecard:check`
exit 0 after marker sync.

The 71 pre-existing recommendation-related tests (RULES + card
rendering + simple-shell mount + store) all pass after 2 small
invariant updates: RULES.length 7→8 and the "ready-state empty" test
now asserts populated-baseline behavior.

---

## Cap movement decision — 120/126 maintained

SMART-1-BASELINE ships an operator-DX improvement on the
recommendations-card. It is NOT a cap-worthy event:

- It does not add a new safety boundary (Safety cap unchanged)
- It does not extend public-sector readiness (POL-UI-1 + FP-a/b stay
  the relevant evidence pieces)
- It does not extend reviewer hand-off (EXR-a/b/c stay the relevant
  evidence pieces)
- It is genuinely a Maintainability/UI quality-of-life touch — same
  rubric position as SMART-3-POLISH and POL-UI-1

What this slice DOES contribute (the test ledger):
- 14 new tests anchor the baseline contract (rule shape + filtering
  + dismissal + appliesTo defensive guards)
- 2 invariant updates codify the "exactly one baseline rule" + "8
  total rules" facts
- 1 canary updated (recommendations-card ready-state) so a future
  accidental disabling of the baseline reverts to checking for
  "empty"

The honest score remains 120/126.

---

## 8 decisions worth re-reading

These are the choices that took >5 minutes to settle:

1. **`isBaseline: true` flag, not severity-based filtering** — the
   alternative was "filter out info-severity recs when high+ recs
   exist", but that would also filter the existing `monitor-active-runs`
   and `export-audit-evidence` rules (both info severity), which IS
   the intended behavior for them but only in some contexts. A
   dedicated flag is more precise.
2. **Filter pass AFTER matching, not in `appliesTo`** — putting the
   "no other rule matched" check inside `appliesTo` would require
   either two passes or a stateful match phase. The post-processing
   pass is cleaner: appliesTo stays pure (depends only on ctx) and
   filtering is a single-line predicate.
3. **Baseline rec output carries `isBaseline=true`** — so panels can
   branch reliably without re-querying `getRule(id).isBaseline`.
   Non-baseline recs carry `isBaseline=false` (explicit, NOT
   undefined) so consumers don't have to do "loose-falsy" checks.
4. **CTA = "open-setup-wizard"** — the safest destination for an
   "all clear, verify config" rec. Setup wizard is read-only-by-
   default + provides operator-actionable next steps. NOT "open
   recent results" or "scroll to approvals" because those would be
   confusing when the system is actually idle.
5. **`appliesTo: hasActiveProfile === true`** — defense in depth.
   The engine's post-processing filter would drop the baseline when
   `complete-profile-setup` (also critical) fires, but the appliesTo
   guard makes the contract explicit: baseline NEVER fires without
   an active profile, regardless of what other recs do.
6. **One baseline rule, not many** — the test
   "only one baseline rule in the registry" pins this down. A future
   round adding a second baseline (e.g. "first-week onboarding tip")
   MUST update the test alongside the engine logic — implicit
   multi-baseline behavior would be a footgun.
7. **The baseline can be dismissed** — operator agency. If an
   experienced operator finds the "✓ 시스템 준비됨" message
   uninformative, dismissing it returns the card to its true empty
   state (`data-state="empty"`). This is the EXACT behavior of every
   other rec — the baseline isn't special in this regard.
8. **Updated the canary test rather than deleting it** — the test
   `monitor.recommendations-card.test.js:145` originally asserted
   `data-state === "empty"` for hasActiveProfile=true + nothing else.
   Now it asserts `data-state === "populated"` + `data-rec-id ===
   "system-ready"`. The intent is preserved: if a future change
   accidentally disables the baseline, the test catches it (state
   reverts to "empty").

---

## What's deferred / out of scope

Foundation is shipped; these are follow-up slices:

- **Multi-baseline rules** — e.g. "first-week onboarding tip" or
  "post-first-run welcome" recs that fire under specific narrow
  conditions but still respect the "filter when urgent" semantics.
  Today there's exactly one baseline; the test pins this down.
- **Baseline-specific CSS** — the panel's
  `data-rec-id="system-ready"` + `data-severity="info"` are styling
  hooks but the actual color / icon polish is a CSS follow-up
  (same deferred status as POL-UI-1 / SMART-3-POLISH visual polish).
- **Localized baseline copy by deployment posture** — public-sector
  operators might want a different phrasing ("✓ 공공기관 모드: 모든
  검사 통과" or similar). Today the baseline copy is generic; a
  posture-aware version would need additional ctx booleans + a
  posture-resolved title/body lookup.
- **Baseline metrics** — does anyone actually find the baseline
  reassuring vs. just noise? The dismiss event is a signal but isn't
  separately surfaced. A future round could track baseline-dismissal
  rate as part of operator engagement metrics.
- **Welcome-overlay integration** — the welcome-overlay (UI-H8) and
  baseline rec both target first-time operators but live at different
  layers (overlay = above grid; baseline rec = inside grid). They
  could be unified or one could be removed — but that's a UX
  decision, not a regression risk.

---

## Per plan §S §S-next-after

After this commit + push, the scorecard trajectory shows
SMART-1-BASELINE above the SMART-3-POLISH banner. Both are follow-up
slices that the 5-priority roadmap closure made possible.

Per plan §S §S-next-after, remaining follow-up candidates:
- **POL-UI-2 pack switch UI** — reactive switch with confirmation
  modal + runner-graceful-shutdown hook + audit chain entry
  (meaningful blast radius — runtime mutation of policy state)
- **Operator runs `harness-start.bat` in production for ≥1 week** —
  the FP-a daily probe + POL-UI-1 pack-info card + SMART-3-POLISH
  preset memory + SMART-1-BASELINE rec all combine to make this a
  smoother experience now
- **External reviewer engagement** — someone other than the
  committer walks the EXR-a bundle + EXR-b matrix and produces a
  summary report
- **CSS styling** for the simple-shell cards — the deferred CSS
  across pack-info-card / recommendations-card / next-action-card /
  baseline-rec is becoming visible debt

The cap-movement candidates (Public-sector readiness +1, Testability
+1) still require the operator-time + reviewer-time evidence loop.
SMART-1-BASELINE does not move the cap because it is operator-DX
polish, not a new property.
