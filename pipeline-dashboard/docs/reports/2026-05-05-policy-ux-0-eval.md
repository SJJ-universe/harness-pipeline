# POLICY-UX-0 Closeout — Pack-rule runtime wiring + operator-facing pack catalog

- **Date**: 2026-05-05
- **Round**: Phase 2 / POLICY-UX-0 (User-supplied 5-priority roadmap, priority 3)
- **Plan reference**: 2026-05-05 user recommendation
- **Score before**: 120/126
- **Score after**: 120/126 (cap movement candidate; deferred — full UI panel + operator field deployment evidence per FIELD-PILOT-0)

## What this round shipped

3 sub-slices closing the SMART-5 deferred wiring + operator pack catalog API + UI foundation:

### Sub-slice POL-a — Runtime wiring (the SMART-5 deferred work)
- `src/policy/policyGates.js`:
  - `resolveGateMode(env, deploymentProfile?)` — new 2-arg signature with 4-step precedence:
    1. env `HARNESS_HARD_GATES=1/true/hard` → "hard"
    2. env `HARNESS_HARD_GATES=0/false/warn/no` → "warn" (operator override)
    3. `deploymentProfile.hardGatesDefault === true` → "hard" (pack rule)
    4. "warn" (default; legacy 1-arg callers see this)
  - All 4 gate functions (gatePiiBlock / gateReleaseSigned / gateEvidenceExportReady / gateCompletionAllowed) updated to pass deploymentProfile to resolveGateMode internally
- `src/runtime/runMemory.js`:
  - `_isOptOut(env, deploymentProfile?)` — new 2-arg signature
  - `recordRunMemory` passes opts.deploymentProfile through
  - Pack `runMemoryEnabled === false` → opt out (in addition to env)
- 21 + 11 = 32 unit tests covering precedence matrix + scenarios + backwards-compat

### Sub-slice POL-b — Operator-facing pack catalog API
- New `src/routes/policyPackRoutes.js` — single endpoint:
  - `GET /api/policy-packs` returns:
    - `schema` ("harness-policy-pack/v1")
    - `currentPack` (modeId from deploymentProfile or null)
    - `packs[]` — all 5 frozen packs with full rule fields + `isCurrent` flag
    - `metadata.hardGatesEffectiveMode` — POL-a runtime resolution result
    - `metadata.runMemoryEffective` — POL-a runtime opt-out check
    - `metadata.hardGatesEnvOverride` / `runMemoryEnvOverride` — bool whether operator set env explicitly
    - `metadata.publicSectorRequirements[]` — 5-bullet operator checklist
- server.js mount after `createRunMemoryRoutes`
- 15 integration tests covering schema / cross-field invariants / metadata reflects POL-a precedence / public-sector requirements text / serverTime range

### Sub-slice POL-c — Store slice + legacy-bridge fetch + i18n foundation
- `public/js/monitor/store.js`:
  - new `policyPacks` state slice + 2 mutators (setPolicyPacks / clearPolicyPacks)
  - schema check on setPolicyPacks (rejects foreign schema silently)
  - idempotent (same payload no notify-churn)
  - snapshot defensive shallow copy of inner packs + requirements list
- `public/js/monitor/legacy-bridge.js`:
  - new `DEFAULT_POLICY_PACKS_URL` + `policyPacksUrl` install option
  - new `refreshPolicyPacks()` one-shot fetch on install (packs are frozen at boot)
  - exposed on returned handle for manual re-fetch
  - new stats counters: `policyPacksRefreshes` / `policyPacksErrors`
- `public/js/i18n/{ko,en}.js`:
  - 23 new keys per locale (parity preserved)
  - 6 catalog labels (cardLabel / aria.region / currentLabel / changeHint / runtimeEffective.* placeholders)
  - 5 modeId labels (operator-friendly localization for kebab-case ids)
  - 9 rule field labels (publicSector / allowLocalExecutor / etc.)
  - 3 public-sector requirements headers
- 16 store unit tests + 6 bridge unit tests

## End-to-end behavior change

**Pre-POLICY-UX-0**:
- Operator chooses `HARNESS_DEPLOYMENT_PROFILE=finance-high-privacy` expecting strict gates
- Pack rule `hardGatesDefault=true` exists but isn't consulted at runtime
- Operator must ALSO set `HARNESS_HARD_GATES=1` to actually get hard gates
- Pack catalog only visible by reading source code or `policyPackRegistry.js` directly

**Post-POLICY-UX-0**:
- Operator chooses finance-high-privacy → automatic hard gates (pack rule consulted)
- Operator can override to warn during incident triage with `HARNESS_HARD_GATES=0`
- `GET /api/policy-packs` returns full catalog with `hardGatesEffectiveMode` reflecting actual runtime resolution
- Dashboard UI (when panel ships) can render the comparison view from `store.policyPacks`
- 5-bullet `publicSectorRequirements` checklist visible in API + i18n keys ready for UI rendering

## Cap movement decision

**Decision: Stay at 120/126.**

Rationale:
1. POL-a closes the SMART-5 deferred wiring — that's a regression-anchor improvement, not a cap movement event by itself
2. POL-b ships the read-only catalog API — no behavior change for end-users
3. POL-c is foundation for a future UI panel — the actual UI rendering (pack-info card, public-sector requirement banner, restart-instructions modal) is deferred to a follow-up
4. Cap movement evidence requires operator field deployment (per FIELD-PILOT-0 round) where:
   - Operator runs finance-high-privacy in production for 1+ week
   - `live-verify-smart-arc.sh` from SMART-LV-0 produces verdict=PASS
   - Evidence packets demonstrate hardGatesDefault auto-applied without manual `HARNESS_HARD_GATES=1`
   - No incident reports related to the runtime wiring change

The plan §S §S-score-trajectory has consistently followed this pattern across SMART-2/4/5/RR0/LV0 closeouts. POL maintains it.

## Test counts

|              | Before | After  | Δ    |
|--------------|-------:|-------:|-----:|
| Unit         |   3288 |   3340 | +52  |
| Integration  |    538 |    553 | +15  |
| Smoke        |     90 |     90 |   0  |

Per sub-slice:
- POL-a: +21 unit (policyGates.pola) + +11 unit (runMemory.pola) = +32
- POL-b: +15 integration (policy-pack-routes)
- POL-c: +16 unit (store.policyPacks) + +6 unit (legacy-bridge.policyPacks) − 2 (i18n already counted) = +20

## Files touched

### Created
- `src/routes/policyPackRoutes.js`
- `tests/unit/policyGates.pola.test.js`
- `tests/unit/runMemory.pola.test.js`
- `tests/integration/policy-pack-routes.test.js`
- `tests/unit/monitor.store.policyPacks.test.js`
- `tests/unit/monitor.legacy-bridge.policyPacks.test.js`
- `docs/reports/2026-05-05-policy-ux-0-eval.md` (this file)

### Modified
- `src/policy/policyGates.js` (resolveGateMode 2-arg + 4 gate functions consult dp)
- `src/runtime/runMemory.js` (_isOptOut 2-arg + recordRunMemory passes dp)
- `server.js` (mount policy-pack route)
- `public/js/monitor/store.js` (policyPacks slice + 2 mutators)
- `public/js/monitor/legacy-bridge.js` (one-shot fetch + refresh handle + stats)
- `public/js/i18n/{ko,en}.js` (23 new keys per locale)
- `docs/scorecard.md` (POLICY-UX-0 closure marker)

## Decisions worth re-reading later

1. **2-arg signature beats 1-arg renames**: `resolveGateMode(env, deploymentProfile)` keeps full backwards compatibility with pre-POL-a 1-arg callers (legacy tests + production callers without `deploymentProfile` see legacy behavior). Renaming or breaking the signature would have forced cascading test updates with no benefit.

2. **Operator override beats pack default**: An operator on finance-high-privacy who needs to triage an incident can set `HARNESS_HARD_GATES=0` to soften gates WITHOUT changing the pack id (which would also flip sandbox / signing requirements). This was anchored by the "incident triage on finance-high-privacy" scenario test. Plan §S §S-SMART-5 anticipated this.

3. **Pack catalog is READ-ONLY**: Changing pack mid-run would require auditing + atomic re-resolution + restart of every active runner. Out of scope for POLICY-UX-0. The route documents "restart required" via `metadata.changeHint` (i18n) and the `publicSectorRequirements` checklist explains what the operator needs to set up before booting with a public-sector pack.

4. **One-shot fetch on bridge install**: Packs are frozen at boot — polling /api/policy-packs every 5 seconds would waste cycles + bandwidth. Bridge fetches once at install, exposes `refreshPolicyPacks()` for manual re-fetch (operator dev tools). The runtime-resolved metadata (effective hard gate mode, env overrides) reflects the boot-time state — env can't change without server restart.

5. **publicSectorRequirements as a frozen string array, not a single paragraph**: Rendered as a checklist in the future UI panel. Each bullet is a discrete requirement an operator can verify against their setup. Keeping it as an array makes it easier for the panel to render with checkboxes / icons / per-item detail.

6. **i18n labels for kebab-case modeIds**: The frozen modeIds (`finance-high-privacy`, `offline-internal-network`) are stable identifiers — but they're not readable for operators. i18n keys like `policyPack.modeId.finance-high-privacy` map to "🛡 금융 / 고강도 프라이버시 (Finance High-Privacy)" in Korean. Both ko and en have full parity (verified by i18n.coverage.test.js).

7. **Snapshot defensive copy of `publicSectorRequirements`**: An external panel that mutates the requirements list shouldn't pollute the stored slice. Test pins this — `caller mutating array → stored unchanged`. Same pattern as runnerActivity / accountStatus / decisionContext slices.

8. **Schema check on setPolicyPacks**: A future v2 schema (e.g., adding new rule fields to packs) would have a different `schema` value. Pre-v2 client mutators reject foreign schemas silently — preventing partial-shape rendering. Same rationale as decisionContext slice.

9. **Foreign schema in HTTP response: counter ticks "refreshes" not "errors"**: From the bridge's perspective, HTTP succeeded (got JSON, status 200). The store layer's schema check is the silent rejector. This split keeps "network errors" and "schema mismatches" separately observable in stats.

10. **POL-c UI panel deferred — foundation only**: Building the actual pack-info card with restart-instructions banner + public-sector requirement display + comparison-table is substantial UI work. POL-c lays the foundation (slice + bridge + i18n); the panel itself is a follow-up. The data is plumbed; only the DOM is missing.

## What's deferred / out of scope

- **Pack-info UI panel**: The actual simple-shell card that reads `store.policyPacks` and renders the catalog with the "current pack" highlight + 4 alternatives + 5-bullet publicSectorRequirements + restart-instructions banner. Foundation is ready; DOM is the missing piece.
- **Pack change runtime mutation**: A `POST /api/policy-packs/select` endpoint that re-resolves the deploymentProfile + restarts all runners + emits an audit row. Substantial work + auditing surface; out of scope for POLICY-UX-0.
- **Pack comparison side-by-side view**: When the UI panel ships, an operator might want to compare 2 packs field-by-field. The data is in the route response (`packs[]` carries all rule fields); the comparison renderer is a future enhancement.
- **i18n for English-language operators picking a Korean translation**: All 23 keys land in both locales. If a future operator wants to add Japanese / Chinese / etc., they'd add a new locale file matching the parity.
- **Operator-defined custom packs**: A `policyPackRegistry.json` that operators can edit at install time. Plan §S §S-SMART-5 explicitly deferred this — frozen-in-code is the security-conscious choice for now.
- **Pack change audit verb**: When the UI eventually allows selecting a pack (with restart), the server should emit `deployment_profile_change_requested` audit row with the requested vs current pack. Verb defined; not yet emitted.

## Per plan §S §S-next-after — POLICY-UX-0 → FIELD-PILOT-0

User-supplied roadmap: "POLICY-UX-0 뒤에는 FIELD-PILOT-0를 추천합니다 — 1주 production 무회귀 운영 기록".

FIELD-PILOT-0 deliverables (per user spec):
- 1주 production 무회귀 운영 기록
- field deployment log template
- incident/no-incident ledger
- 설치/계정/timeout 문제 기록
- 실제 사용성 피드백 수집

End of POLICY-UX-0 closeout.
