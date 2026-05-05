# Live-Evidence Schema Reference

**Slice LIVE-EVIDENCE-SCHEMA-DOC (Phase 2 v2 follow-up, 2026-05-05)**

This document is the locked schema reference for the two
operator-runnable live-verification probes that produce evidence
packets toward the v1.0.0 final-readiness gate (Blocker #1 in
[`runbooks/v1-blockers.md`](runbooks/v1-blockers.md) §2).

The probes ship today as:

- [`scripts/live-verify-smart-arc.js`](../scripts/live-verify-smart-arc.js)
  — emits `harness-smart-lv-evidence/v1`.
- [`scripts/live-verify-review-relay.js`](../scripts/live-verify-review-relay.js)
  — emits `live-verify-review-relay/v1`.

The schemas differ in shape because they verify different things
(SMART arc properties vs review-relay round-trip). They share the
same trust contract: the evidence packet committed in
`docs/reports/` is the canonical record of one probe run.

---

## §1 Why this exists

`v1.0.0-rc.2` shipped without committed real-binary evidence.
Closing Blocker #1 means an operator runs the probes against real
Claude/Codex CLIs and commits the resulting JSON to `docs/reports/`.

For that committed JSON to be **trustworthy** — auditable by an
external reviewer, comparable across probe runs, and machine-
readable for an aggregation step — its shape must be locked. This
doc is that lock.

The schemas below are the **v1** of each contract. Future probe
runs (with breaking shape changes) bump to `/v2`; older probe
output remains valid under its `/v1` lock indefinitely.

---

## §2 Schema 1 — `harness-smart-lv-evidence/v1`

Emitted by [`scripts/live-verify-smart-arc.js`](../scripts/live-verify-smart-arc.js)
to evidence the six SMART arc properties (P1–P6: hard gates,
finance pack, PII block, redacted memory, recommendations, preset
dispatch).

### §2.1 Top-level required fields

| Field | Type | Notes |
| --- | --- | --- |
| `schema` | string | Must equal `"harness-smart-lv-evidence/v1"`. |
| `runAt` | ISO-8601 string | Timestamp at which the probe began. UTC. |
| `verdict` | enum | One of `"PASS"`, `"FAIL"`, `"CONFIG"`. See §2.4 below. |
| `environment` | object | Snapshot of `/api/server/info` at probe time. May be empty `{}` on `CONFIG` exit. |
| `properties` | object | Per-property results (P1–P6). May be empty `{}` on `CONFIG` exit. |
| `auditChain` | object | Audit-ledger evidence. May be empty `{}` on `CONFIG` exit. |
| `notes` | string[] | Diagnostic notes. Always present, may be empty `[]` on `PASS`. |

### §2.2 `properties` sub-shape (when verdict ≠ CONFIG)

Each of the 6 SMART arc properties contributes one entry. Each
entry has at minimum `{ ok: boolean }`.

| Key | Property | Required sub-fields |
| --- | --- | --- |
| `p1_hard_gates_env` | HARNESS_HARD_GATES propagation | `ok`, `mode` |
| `p2_finance_high_privacy` | finance-high-privacy pack resolution | `ok`, `pack`, `hardGatesDefault` |
| `p3_policy_gate_blocked` | PII policy gate fires | `ok`, `status`, `error`, `gate`, `reason` |
| `p4_run_memory_redacted` | run memory redaction under public-sector | `ok`, `redacted`, `redactedTypes`, `sourceHashPresent` |
| `p5_recommendations` | recommendation card surface | `ok`, `decisionContext`, `recsObserved` |
| `p6_preset_dispatch` | preset-dispatched review session | `ok`, `presetId` |

### §2.3 `auditChain` sub-shape (when verdict ≠ CONFIG)

| Field | Type | Notes |
| --- | --- | --- |
| `runId` | string | The pipeline run id whose audit ledger was inspected. |
| `verbsObserved` | string[] | Audit-verb names the probe confirmed in the ledger. Must include `deployment_profile_resolved`, `policy_gate_blocked`, `review_session_dispatch_started` for a `PASS` verdict. |
| `sample` | object[] | Up to 3 raw audit-ledger entries (newest-first) included for reviewer inspection. |

### §2.4 `verdict` vocabulary

| Verdict | Meaning | Exit code |
| --- | --- | --- |
| `PASS` | All 6 SMART arc properties evidenced; audit chain verifies. | `0` |
| `FAIL` | At least one property could not be evidenced (probe ran but a step returned an unexpected response). | `1` |
| `CONFIG` | Prerequisite missing (server unreachable, no token, wrong profile). Probe did not begin substantive checks. | `2` |

### §2.5 Example — CONFIG (server unreachable)

```json
{
  "schema": "harness-smart-lv-evidence/v1",
  "runAt": "2026-05-05T02:49:37.801Z",
  "verdict": "CONFIG",
  "environment": {},
  "properties": {},
  "auditChain": {},
  "notes": [
    "server not reachable; cannot proceed"
  ]
}
```

This is the shape the committed
`docs/reports/2026-05-05-smart-arc-live-verify.json` template uses.
A `CONFIG` packet is the smallest valid evidence file — it tells a
reviewer "the probe was attempted but could not run".

### §2.6 Example — PASS (operator-run shape)

```json
{
  "schema": "harness-smart-lv-evidence/v1",
  "runAt": "2026-05-06T15:32:11.244Z",
  "verdict": "PASS",
  "environment": {
    "pack": "finance-high-privacy",
    "publicSector": true,
    "hardGatesEnv": "1"
  },
  "properties": {
    "p1_hard_gates_env":     { "ok": true, "mode": "hard" },
    "p2_finance_high_privacy":{ "ok": true, "pack": "finance-high-privacy", "hardGatesDefault": true },
    "p3_policy_gate_blocked":{ "ok": true, "status": 409, "error": "policy_gate_blocked", "gate": "pii_block", "reason": "kr_resident_id_match" },
    "p4_run_memory_redacted":{ "ok": true, "redacted": true, "redactedTypes": ["kr_resident_id"], "sourceHashPresent": true },
    "p5_recommendations":    { "ok": true, "decisionContext": "...", "recsObserved": ["audit-export"] },
    "p6_preset_dispatch":    { "ok": true, "presetId": "security" }
  },
  "auditChain": {
    "runId": "run-abc123",
    "verbsObserved": [
      "deployment_profile_resolved",
      "policy_gate_blocked",
      "review_session_dispatch_started"
    ],
    "sample": [
      /* up to 3 newest audit-ledger entries */
    ]
  },
  "notes": []
}
```

---

## §3 Schema 2 — `live-verify-review-relay/v1`

Emitted by [`scripts/live-verify-review-relay.js`](../scripts/live-verify-review-relay.js)
to evidence the Codex/Claude review-relay end-to-end chain.

### §3.1 Top-level required fields

| Field | Type | Notes |
| --- | --- | --- |
| `schema` | string | Must equal `"live-verify-review-relay/v1"`. |
| `startedAt` | ISO-8601 string | Timestamp when the probe began. UTC. |
| `verdict` | enum | See §3.4 below. |
| `options` | object | The CLI flags / env in effect at probe time. |
| `steps` | object[] | Per-step results, in execution order. |
| `sessionId` | string \| null | Review session id if step 3 succeeded. |
| `critiqueReceivedElapsedMs` | number \| null | Time-to-critique-received in ms. |
| `serverInfo` | object \| null | Snapshot of `/api/server/info`. |

### §3.2 `options` sub-shape

| Field | Type | Notes |
| --- | --- | --- |
| `base` | string | Server base URL (default `http://127.0.0.1:4201`). |
| `label` | string | Review session label. |
| `posture` | string | One of `"standard"` or `"public-sector"`. |
| `withFollowup` | boolean | Whether the follow-up Codex step was attempted. |
| `withHandback` | boolean | Whether the Claude hand-back step was attempted (standard mode only). |

### §3.3 `steps` sub-shape

Each step entry has at minimum:

| Field | Type | Notes |
| --- | --- | --- |
| `step` | string | Step identifier (e.g. `"health"`, `"create"`, `"send-codex"`, `"poll-critique"`, `"follow-up"`, `"hand-back-claude"`, `"poll-claude"`). |
| `ok` | boolean | Whether the step succeeded against its acceptance criterion. |

Steps may carry additional step-specific fields (e.g. HTTP status,
response body excerpt, elapsed time).

### §3.4 `verdict` vocabulary

| Verdict | Meaning | Exit code |
| --- | --- | --- |
| `PASS` | Every executed step succeeded. | `0` |
| `FAIL_SERVER_DOWN` | Step 1 (health) failed. | `2` |
| `FAIL_CREATE` | Step 3 (create session) failed. | `1` |
| `FAIL_SEND_CODEX` | Step 4 (send-codex) failed. | `1` |
| `FAIL_CRITIQUE_TIMEOUT` | Step 5 (poll-critique) timed out. | `1` |
| `FAIL_FOLLOWUP` | Step 6 (follow-up Codex) failed. | `1` |
| `FAIL_HANDBACK` | Step 7 (hand-back Claude) failed. | `1` |
| `FAIL_CLAUDE_TIMEOUT` | Step 8 (poll-claude) timed out. | `1` |
| `PENDING` | Probe is still running. SHOULD NOT appear in committed evidence. | n/a |

The richer `FAIL_*` vocabulary (vs SMART arc's single `FAIL`)
preserves the failure mode in the committed packet so a reviewer
can read the verdict alone and know which step broke.

### §3.5 Example — server unreachable

```json
{
  "schema": "live-verify-review-relay/v1",
  "startedAt": "2026-05-06T15:30:00.000Z",
  "verdict": "FAIL_SERVER_DOWN",
  "options": {
    "base": "http://127.0.0.1:4201",
    "label": "operator-live-probe",
    "posture": "standard",
    "withFollowup": false,
    "withHandback": false
  },
  "steps": [
    { "step": "health", "ok": false, "error": "connection refused" }
  ],
  "sessionId": null,
  "critiqueReceivedElapsedMs": null,
  "serverInfo": null
}
```

### §3.6 Example — PASS shape (operator-run)

```json
{
  "schema": "live-verify-review-relay/v1",
  "startedAt": "2026-05-06T15:30:00.000Z",
  "verdict": "PASS",
  "options": {
    "base": "http://127.0.0.1:4201",
    "label": "operator-live-probe",
    "posture": "standard",
    "withFollowup": true,
    "withHandback": true
  },
  "steps": [
    { "step": "health",            "ok": true,  "elapsedMs": 12 },
    { "step": "server-info",       "ok": true,  "pack": "standard" },
    { "step": "create",            "ok": true,  "sessionId": "rs-abc" },
    { "step": "send-codex",        "ok": true,  "dispatched": true, "runner": "codex" },
    { "step": "poll-critique",     "ok": true,  "elapsedMs": 4200 },
    { "step": "follow-up",         "ok": true },
    { "step": "hand-back-claude",  "ok": true,  "dispatched": true, "runner": "claude" },
    { "step": "poll-claude",       "ok": true,  "elapsedMs": 6700 }
  ],
  "sessionId": "rs-abc",
  "critiqueReceivedElapsedMs": 4200,
  "serverInfo": { "pack": "standard", "publicSector": false }
}
```

---

## §4 Schema 3 — `harness-live-evidence-bundle/v1` (aggregation)

Emitted by [`scripts/collect-live-evidence.js`](../scripts/collect-live-evidence.js)
when an operator runs `npm run collect-live-evidence` after committing
the per-probe evidence files. The bundle inlines both component
evidence files plus a derived top-level verdict, producing a
single artifact suitable for the v1.0.0 release evidence packet.

### §4.1 Top-level required fields

| Field | Type | Notes |
| --- | --- | --- |
| `schema` | string | Must equal `"harness-live-evidence-bundle/v1"`. |
| `createdAt` | ISO-8601 string | Timestamp at which the bundle was assembled. UTC. |
| `verdict` | enum | One of `"PASS"`, `"FAIL"`, `"INCOMPLETE"`. See §4.4 below. |
| `summary` | object | Per-component summary. See §4.2. |
| `components` | object | Full per-component evidence inlined. See §4.3. |
| `missing` | string[] | Names of components not found (`"smartArc"`, `"reviewRelay"`). Empty if both present. |

### §4.2 `summary` sub-shape

Each entry is `null` when that component was not found, otherwise:

| Field | Type | Notes |
| --- | --- | --- |
| `sourceFile` | string | Relative path of the file the bundle was assembled from. |
| `schema` | string | Re-stated for convenience (`harness-smart-lv-evidence/v1` or `live-verify-review-relay/v1`). |
| `verdict` | string | Component verdict (per §2.4 / §3.4). |
| `timestamp` | ISO-8601 string | Component's `runAt` (smart-arc) or `startedAt` (review-relay). |

The summary mirrors the most operator-relevant top-level fields
of each component so a reviewer can read the bundle's `summary`
without parsing the full `components` object.

### §4.3 `components` sub-shape

Each entry is the **full** evidence object as emitted by the
underlying probe, or `null` if the component was missing. This
makes the bundle self-contained: an offline reviewer can verify
schema-1 conformance against `components.smartArc` and schema-2
conformance against `components.reviewRelay` without needing the
original per-probe files.

### §4.4 `verdict` vocabulary

| Verdict | Meaning | Exit code |
| --- | --- | --- |
| `PASS` | Both components present and both have component-verdict `"PASS"`. | `0` |
| `FAIL` | Both components present, at least one has an explicit FAIL verdict. | `1` |
| `INCOMPLETE` | At least one component missing, OR the smart-arc component has verdict `"CONFIG"`, OR the review-relay component has verdict `"PENDING"`. The partial bundle is still written so the gap is visible to a reviewer. | `1` |

### §4.5 Example — INCOMPLETE (smart-arc CONFIG)

```json
{
  "schema": "harness-live-evidence-bundle/v1",
  "createdAt": "2026-05-05T15:00:00.000Z",
  "verdict": "INCOMPLETE",
  "summary": {
    "smartArc": {
      "sourceFile": "docs/reports/2026-05-05-smart-arc-live-verify.json",
      "schema": "harness-smart-lv-evidence/v1",
      "verdict": "CONFIG",
      "timestamp": "2026-05-05T02:49:37.801Z"
    },
    "reviewRelay": null
  },
  "components": {
    "smartArc": { "schema": "harness-smart-lv-evidence/v1", "...": "..." },
    "reviewRelay": null
  },
  "missing": ["reviewRelay"]
}
```

### §4.6 Example — PASS shape

```json
{
  "schema": "harness-live-evidence-bundle/v1",
  "createdAt": "2026-05-06T15:35:00.000Z",
  "verdict": "PASS",
  "summary": {
    "smartArc": {
      "sourceFile": "docs/reports/2026-05-06-smart-arc-live-verify.json",
      "schema": "harness-smart-lv-evidence/v1",
      "verdict": "PASS",
      "timestamp": "2026-05-06T15:32:11.244Z"
    },
    "reviewRelay": {
      "sourceFile": "docs/reports/2026-05-06-review-relay-live-verify.json",
      "schema": "live-verify-review-relay/v1",
      "verdict": "PASS",
      "timestamp": "2026-05-06T15:30:00.000Z"
    }
  },
  "components": {
    "smartArc":    { "...": "(full schema-1 evidence)" },
    "reviewRelay": { "...": "(full schema-2 evidence)" }
  },
  "missing": []
}
```

A `PASS` bundle is the artifact that ships alongside `v1.0.0` and
is referenced from the v1.0.0 release notes as the live-binary
evidence anchor.

---

## §5 Audit-chain anchors (cross-cutting)

Both schemas can reference the harness audit ledger. Three anchor
audit verbs MUST appear in the committed evidence for v1.0.0
Blocker #1 closure (per
[`runbooks/v1-blockers.md`](runbooks/v1-blockers.md) §2.3):

| Verb | Probe that observes it | Means |
| --- | --- | --- |
| `deployment_profile_resolved` | smart-arc P2 | The pack/posture resolution wrote an audit row. |
| `policy_gate_blocked` | smart-arc P3 | A PII policy gate fired and was recorded. |
| `review_session_dispatch_started` | both probes | A review session reached the dispatcher. |

For the smart-arc probe these appear in `auditChain.verbsObserved`.
For the review-relay probe an operator-side audit-export step
(`scripts/external-review-bundle.js`) is the recommended way to
attach the matching ledger entries to the committed evidence.

---

## §6 Schema versioning policy

The schemas above are **v1**. They are locked: existing committed
evidence under v1 remains valid indefinitely. New probe versions
that change shape in any of these ways MUST bump to v2 (or higher):

- Any required field renamed, removed, or repurposed.
- Any required field type changed (string → number, etc.).
- A new required field that older probe runs would not have populated.
- A change in the meaning of an existing `verdict` value.

Additive changes that v1 readers can ignore are allowed in v1:

- New optional fields at any level.
- New audit-verb names appended to `verbsObserved` (still string[]).
- New step entries in the review-relay `steps` array (still
  `{step, ok, ...}` shape).

When a v2 ships, the corresponding probe script bumps its
`schema` constant string. This doc adds a §2 / §3 v2 sub-section
under the v1 sub-section; the v1 sub-section is preserved for
historical reference.

---

## §7 Schema convergence notes (v2 candidates)

The two v1 schemas evolved independently and are **deliberately
not normalized** in v1 to avoid silently breaking the existing
committed template. The following inconsistencies are documented
for resolution in a future v2:

1. **`schema` prefix** — smart-arc uses `harness-smart-lv-evidence/v1`
   (with `harness-` prefix); review-relay uses `live-verify-review-relay/v1`
   (no prefix). v2 should standardize on a single prefix convention.
2. **Timestamp field name** — smart-arc uses `runAt`, review-relay
   uses `startedAt`. v2 should pick one (`startedAt` is more
   accurate when the probe takes minutes).
3. **`verdict` vocabulary** — smart-arc has 3 verdicts (`PASS` /
   `FAIL` / `CONFIG`); review-relay has a richer FAIL_* vocabulary.
   v2 could either keep both shapes (different probes have
   different needs) or collapse to a `verdict` + `failReason` pair.
4. **`PENDING` verdict** — review-relay defines `PENDING` as the
   in-flight state but advises it not appear in committed evidence.
   v2 should either remove `PENDING` from the schema (probes
   guarantee a terminal verdict) or formalize it as a probe-only
   internal state.

These are tracked as v2 follow-up; not blocking v1.0.0.

---

## §8 References

- [`runbooks/v1-blockers.md`](runbooks/v1-blockers.md) §2 — the
  blocker this schema doc unlocks (Real-binary live verification).
- [`scripts/live-verify-smart-arc.js`](../scripts/live-verify-smart-arc.js)
  — SMART arc probe (the source of `harness-smart-lv-evidence/v1`).
- [`scripts/live-verify-review-relay.js`](../scripts/live-verify-review-relay.js)
  — review-relay probe (the source of `live-verify-review-relay/v1`).
- [`runbooks/live-verify-review-relay.md`](runbooks/live-verify-review-relay.md)
  — operator runbook for the review-relay probe.
- [`reports/2026-05-05-smart-arc-live-verify.json`](reports/2026-05-05-smart-arc-live-verify.json)
  — committed schema-shape sample (CONFIG verdict).
- [`reports/2026-04-30-review-relay-live-verification.md`](reports/2026-04-30-review-relay-live-verification.md)
  — historical review-relay verification report.
