# POL-DIFF-1 — Round closeout (2026-05-05)

**Score**: 120/126 (maintained)
**Round id**: POL-DIFF-1 (eighth follow-up slice)
**Plan reference**: §S §S-next-after — pack rule preview/diff (between POL-UI-1 alt-card badges and POL-UI-2 runtime switch)
**Slices shipped**: POL-DIFF-1-a / POL-DIFF-1-b

## What this round shipped

Alt-cards in pack-info-card now have a **Compare** button that
expands a 3-column rule diff. Read-only preview of "what would change
if I switched packs" — fills the gap between POL-UI-1's 3-badge
summary and POL-UI-2's actual runtime switch (deferred).

**POL-DIFF-1-a** (commit 7ece565):
- `diffPacks(packA, packB)` helper — exports `{changed, rows[]}`
  for 11 rule fields (10 boolean + scannerFailurePolicy string)
- Per alt-card diff toggle button (only mounted when changed > 0)
- 3-column diff table: rule / current / target, changed rows
  sorted first
- 5 new i18n keys per locale (toggle/collapse + 3 header labels)
- CSS for diff table + mobile collapse
- 16 tests (7 helper + 9 UI integration)

3574 → 3590 unit (+16), all green.

## End-to-end behavior change

| Before | After |
|---|---|
| Operator sees 3 quick badges per alt-card. To see what changes, reads JSON/scorecard manually. | Click "Compare (N differ)" → 3-col table shows every changed rule with from→to highlighting. Preview without restart, without mutation. |

## Cap movement: 120/126 maintained

Read-only feature; same rubric position as 7 prior follow-up rounds.
Builds on POL-UI-1 + sets up POL-UI-2 (operators understand what
switching would do).

## What's deferred

- **POL-UI-2 actual runtime switch** — still risky, still deferred
- Per-pack policy preview (extended diff context)
- Multi-pack side-by-side compare
