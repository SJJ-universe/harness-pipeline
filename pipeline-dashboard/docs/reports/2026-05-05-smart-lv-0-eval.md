# SMART-LV-0 Closeout — Live Verification of SMART arc properties

- **Date**: 2026-05-05
- **Round**: Phase 2 / SMART-LV-0 (User-supplied 5-priority roadmap, priority 2)
- **Plan reference**: 2026-05-05 user recommendation
- **Score before**: 120/126
- **Score after**: 120/126 (cap movement awaiting operator field deployment evidence)

## What this round shipped

3 sub-slices closing the SMART arc evidence loop:

### Sub-slice LV0-a — Integration test (6 properties end-to-end)
- New `tests/integration/smart-arc-live-evidence.test.js`
- 13 deterministic in-process tests exercising the full SMART arc:
  | Property | Module | Test count |
  |---|---|---|
  | 1. ORCHESTRATOR_HARD_GATES env | policyGates.resolveGateMode | 2 |
  | 2. finance-high-privacy pack auto-applies hard rules | deploymentProfile + policyPackRegistry | 2 |
  | 3. Hard gate block on PII | policyGates.gatePiiBlock | 2 |
  | 4. Run memory redaction at write | runMemory.recordRunMemory | 2 |
  | 5. Recommendations from decisionContext | recommendationEngine | 2 |
  | 6. Expert preset dispatch | reviewSpawnDispatcher + presetLibrary | 1 |
  | HEADLINE: 6-property full chain | All combined | 1 |
  | HEADLINE: chain detects tampering | EvidenceLedger.verify | 1 |
- Real `evidenceLedger` + real `runMemory` + real `presetLibrary` + real `policyGates` + real `recommendationEngine` + real `deploymentProfile` exercised together
- Privacy invariants pinned: raw email/phone/secrets NEVER in persisted ledger

### Sub-slice LV0-b — Operator probe script
- New `scripts/live-verify-smart-arc.js` (~440 LOC) — Node-only probe
- New `scripts/live-verify-smart-arc.sh` + `.ps1` — bash + PowerShell wrappers
- 6 unit tests for CLI surface (`--help`, CONFIG exit, JSON shape)
- Probe steps:
  | # | Step | Property |
  |---|---|---|
  | 0 | Health probe + auth token | (prereq) |
  | 1 | GET /api/server/info | P1 + P2 |
  | 3a | POST /api/review-sessions (create) | (prereq) |
  | 3b | POST send-codex with PII → 409 | P3 |
  | 6a | GET /api/review-presets (catalog) | P6 prep |
  | 6b | POST send-codex clean + preset=security | P6 |
  | 5 | GET /api/decision-context | P5 |
  | 4 | GET /api/runs/<id>/memory | P4 (route shape) |
  | audit | GET /api/audit/runs/system | chain integrity |
- Evidence packet schema `harness-smart-lv-evidence/v1`:
  ```json
  {
    "schema": "harness-smart-lv-evidence/v1",
    "runAt": "2026-05-05T...",
    "verdict": "PASS",
    "environment": { "pack", "publicSector", "hardGatesDefault", "hardGatesEnv" },
    "properties": {
      "p1_hard_gates_env": { "ok", "hardGatesEnv" },
      "p2_finance_high_privacy": { "ok", "pack", "hardGatesDefault", ... },
      "p3_policy_gate_blocked": { "ok", "status", "error", "gate", ... },
      "p4_run_memory_redacted": { "ok", "status", "record" },
      "p5_recommendations": { "ok", "booleans", "counts", "posture" },
      "p6_preset_dispatch": { "ok", "presetId", "runner", ... }
    },
    "auditChain": { "sessionId", "systemRun": { ... } },
    "notes": [...]
  }
  ```
- Exit codes: 0 PASS / 1 FAIL / 2 CONFIG (server down / wrong env / no token)

### Sub-slice LV0-c — Closeout + evidence packet template
- This document
- Scorecard SMART-LV-0 closure marker

## Evidence packet template (operator-fillable)

When an operator runs the probe in their actual deployment, they get a JSON evidence packet. Below is a sample shape for the report:

```json
{
  "schema": "harness-smart-lv-evidence/v1",
  "runAt": "<ISO timestamp>",
  "verdict": "PASS",
  "environment": {
    "pack": "finance-high-privacy",
    "publicSector": true,
    "hardGatesDefault": true,
    "hardGatesEnv": true
  },
  "properties": {
    "p1_hard_gates_env": { "ok": true, "hardGatesEnv": true },
    "p2_finance_high_privacy": {
      "ok": true,
      "pack": "finance-high-privacy",
      "hardGatesDefault": true,
      "publicSector": true
    },
    "p3_policy_gate_blocked": {
      "ok": true,
      "status": 409,
      "error": "policy_gate_blocked",
      "gate": "pii_block",
      "reason": "pii_detected",
      "findingTypes": ["email"]
    },
    "p4_run_memory_redacted": {
      "ok": true,
      "status": 404,
      "note": "expected — review session id is not a pipeline run; route shape verified"
    },
    "p5_recommendations": {
      "ok": true,
      "booleans": { "publicSector": true, "hardGatesDefault": true, ... },
      "counts": { "activeRuns": 0, ... },
      "posture": { "mode": "finance-high-privacy" }
    },
    "p6_preset_dispatch": {
      "ok": true,
      "status": 200,
      "runner": "codex",
      "presetId": "security",
      "dispatched": true
    }
  },
  "auditChain": {
    "sessionId": "<sid>",
    "systemRun": {
      "ok": true,
      "verbsObserved": [
        "deployment_profile_resolved",
        "policy_gate_blocked",
        ...
      ],
      "verbsExpected": ["deployment_profile_resolved", "policy_gate_blocked"],
      "verbsMatched": ["deployment_profile_resolved", "policy_gate_blocked"],
      "total": 12
    }
  },
  "notes": []
}
```

## Why deterministic in-process + operator-runnable both

The SMART arc closeouts (SMART-2/4/5) all queued the cap-movement landing to "operator runs in production for 1+ week". That's a real evidence gate. SMART-LV-0 ships TWO complementary layers:

1. **In-process deterministic test (LV0-a)** — proves the 6 properties WIRE TOGETHER correctly today. CI-runnable. Catches regressions.
2. **Operator-runnable probe (LV0-b)** — produces evidence the operator can attach to a field-deployment report. Not CI-runnable (needs real harness boot with specific env). Captures the probe verdict as a JSON packet a reviewer can verify offline.

Together they close the SMART arc evidence question without forcing the closeout to wait for a 1-week production run.

## Cap movement decision

**Decision: Stay at 120/126.**

Rationale:
1. LV0-a in-process integration test proves the wiring works end-to-end deterministically — a useful regression anchor but NOT a cap movement trigger by itself
2. LV0-b probe is a tool for operators; the actual evidence packets that would justify cap movement still need to be generated against real production deployments
3. Per user roadmap priority 4 (FIELD-PILOT-0): "1주 production 무회귀 운영 기록 / field deployment log template / incident/no-incident ledger / 설치/계정/timeout 문제 기록 / 실제 사용성 피드백 수집" — this is the cap movement landing
4. Cap candidate evidence: when an operator (a) runs `live-verify-smart-arc.sh` against finance-high-privacy in production and gets verdict=PASS, AND (b) runs the harness for 1+ week without regressions, AND (c) the JSON evidence packet is committed in `docs/reports/`

The plan §S §S-score-trajectory matched this pattern across SMART-2/4/5 closeouts. LV0 follows it.

## Test counts

|              | Before | After  | Δ    |
|--------------|-------:|-------:|-----:|
| Unit         |   3282 |   3288 | +6   |
| Integration  |    525 |    538 | +13  |
| Smoke        |     90 |     90 |  0   |

Per sub-slice:
- LV0-a: +13 integration (smart-arc-live-evidence.test.js)
- LV0-b: +6 unit (live-verify-smart-arc.cli.test.js)

## Files touched

### Created
- `tests/integration/smart-arc-live-evidence.test.js`
- `scripts/live-verify-smart-arc.js`
- `scripts/live-verify-smart-arc.sh`
- `scripts/live-verify-smart-arc.ps1`
- `tests/unit/live-verify-smart-arc.cli.test.js`
- `docs/reports/2026-05-05-smart-lv-0-eval.md` (this file)

### Modified
- `docs/scorecard.md` (SMART-LV-0 closure marker)

## Decisions worth re-reading later

1. **Two-layer evidence**: In-process deterministic test + operator-runnable probe with the same evidence-packet shape. The integration test serves as the "blueprint" the probe matches against — both layers verify the same 6 properties, just at different layers (in-process vs HTTP).

2. **Probe is dependency-free Node**: No npm install needed; uses globalThis.fetch (Node 18+) and node:fs / node:path stdlib. Operators in air-gapped environments can run it without external network access.

3. **Evidence packet is a frozen schema**: `harness-smart-lv-evidence/v1` — a future v2 schema would require an explicit code change. Reviewers can grep the schema string to find evidence packets across multiple operator deployments.

4. **CONFIG vs FAIL exit semantics**: CONFIG (exit 2) means the operator can't run the probe in the first place (server down, no token, wrong env). FAIL (exit 1) means the probe ran but at least one property didn't verify. PASS (exit 0) means all 6 properties evidenced. CI/scripting can `case` on these three exits.

5. **Probe writes evidence file even on CONFIG/FAIL**: A failed probe still produces a JSON packet so reviewers can see WHAT failed. Only `--json` mode skips the file (operators choose stdout vs file).

6. **In-process test verifies privacy invariant via JSON.stringify check**: The headline integration test asserts `!JSON.stringify(memoryRow).includes("jane.doe@example.com")` — the entire serialized ledger row never carries raw PII. This is the strongest privacy invariant we can express at this layer.

7. **Tampering test changes `eventHash` not `data`**: The verify() method recomputes expected eventHash from `previousHash + type + dataHash`. Tampering with `data` while leaving `dataHash` intact wouldn't be caught (since data isn't re-hashed during verify). Tampering with `eventHash` directly is what verify() detects. R1-c HMAC signing covers the data-tamper case at a different layer.

8. **Probe's P4 test is route-shape-only**: A real pipeline_complete + run_memory_recorded would need an actual pipeline to run during the probe. That's heavy to set up in a 30-second probe. Instead the probe verifies the route shape (404 expected for review-session id since not a pipeline run) — the actual redaction is exercised by LV0-a's in-process test.

## What's deferred / out of scope

- **Field-deployment evidence packets**: The probe is the tool; actual operator-generated JSON evidence packets attached to a 1-week field deployment report are FIELD-PILOT-0 round territory.
- **Real-binary live evidence**: The probe verifies HTTP shape against the running server. Real Codex/Claude binaries actually emitting `[Preset: Security]` content in their critique → LV0 doesn't probe binary content (would slow probe to multiple minutes). The existing `live-verify-review-relay.js` covers real-binary evidence for review-relay; an extended LV0-d probe could add Codex output content verification (deferred).
- **Probe in CI**: The probe needs a running harness server with specific env. Adding it to CI requires a multi-step CI job (boot server with finance-high-privacy → run probe → tear down). Defer to FIELD-PILOT-0 round when the CI evidence pipeline lands.
- **Audit-chain integrity probe**: LV0-a tests `ledger.verify()` for tampering. The probe could add a step that GETs `/api/audit/runs/system/verify` and asserts `valid:true`. Deferred.
- **Operator writes their findings**: LV0-c provides the closeout template + cap-movement decision; an operator who runs the probe attaches their JSON evidence + 1-week regression report to a NEW evaluation document (e.g., `docs/reports/<date>-field-pilot-evidence.md`). That's FIELD-PILOT-0 territory.

## Per plan §S §S-next-after — SMART-LV-0 → POLICY-UX-0

User-supplied roadmap: "SMART-LV-0 뒤에는 POLICY-UX-0를 추천합니다 — policy pack을 env-only에서 UI 선택 가능하게 만드는 작업".

POLICY-UX-0 deliverables (per user spec):
- policy pack selector
- hardGatesDefault runtime 반영
- runMemoryEnabled runtime 반영
- pack 변경 전 경고/확인
- 공공기관 pack 선택 시 sandbox/account 요구사항 표시

End of SMART-LV-0 closeout.
