# Runbook — Field-Pilot Incident Ledger

**Slice FP-b (Phase 2 / FIELD-PILOT-0, 2026-05-05)**

This is the **incident / no-incident ledger** for the field-pilot deployment.
Each entry records a deviation from "boring" — anything the operator or the
daily probe (`scripts/field-pilot-status.js`) flagged as DEGRADED or
INCIDENT, plus any operator-observed anomaly that the script did not catch.

Entries here are **append-only**. Once recorded, do not edit a past entry —
add a follow-up entry instead. This is the field-pilot equivalent of the
audit chain: integrity is more valuable than tidiness.

---

## How to use this template

1. Copy this file to `docs/reports/<pilot-id>/incident-ledger.md` at the
   start of the pilot.
2. Whenever the daily probe returns **DEGRADED** or **INCIDENT**, or
   whenever the operator observes something that feels off (slow response,
   wrong toast, missed broadcast, surprise in the UI), open a new entry.
3. Use the entry template at the bottom. Fill the required fields; optional
   fields can be left blank if not applicable.
4. If an entry resolves later (root cause found / fix shipped / threshold
   re-tested green), append a **Resolution** sub-entry — never edit the
   original observation.
5. At end of pilot, summarize **all** entries (including resolved ones) in
   the deployment-log closeout.

> **Privacy reminder**: sanitize any user prompt, file path, secret, or PII
> in the entry. The ledger is committed evidence. If a real prompt contained
> sensitive data, summarize it (e.g. "operator pasted a code snippet
> containing a customer name; ran sanitizer") rather than quoting verbatim.

---

## Severity guidance

Pick the lowest severity that fairly describes what happened. Reviewers
prefer many DEGRADED entries to a few inflated INCIDENT entries.

| Severity | Meaning | Example |
|---|---|---|
| `info` | Notable but expected. Ledger entry exists for traceability only. | First time `policy_gate_warn` fires for a new pack — expected, just record once. |
| `degraded` | The operator could continue working but something deviated. | Codex critique took 22 min (long but completed); idle warning fired at 75% then resolved. |
| `incident` | Something the operator could not recover from without intervention. | `claim_verification_failed` audit entry; trust-store key removal returned 500; harness server crashed. |
| `critical` | Safety boundary breach or data integrity at risk — halt the pilot. | `trust_store_private_key_rejected` was bypassed; PII reached a runner unsanitized; signed-manifest gate was bypassed in production. |

**Critical entries halt the pilot.** Open the incident, page the operator
contact listed in the deployment-log Pilot context, and stop running new
deployments until a Resolution entry is appended.

---

## Ledger entries

(Append entries below. Newest at the bottom — chronological, not
reverse-chronological. This matches the audit chain ordering and makes the
operator's daily summary easy to write.)

---

### (No entries yet)

When the first entry appears, copy the template at the bottom of this file.

---

## Entry template

```markdown
### Entry NNN — YYYY-MM-DD HH:MM (operator-local)

**Severity**: info / degraded / incident / critical
**Pilot day**: N (from deployment log)
**Probe label at time of entry**: `day-N` (or `out-of-band`)
**Operator**: name

**What happened** (1–3 sentences, factual, no speculation):
- ...

**Where to look** (file paths, audit verbs, snapshot JSON keys, log lines —
sanitized):
- snapshot: `docs/reports/<pilot-id>/day-N-field-pilot-status.json`
- audit verbs in the snapshot: `audit.today.byVerb.<verb>` = N
- console output: `~/.harness/runs/<runId>/log` (line N)
- trace: (link to git commit / line range, if relevant)

**Severity reasoning** (why this severity, not the next one up or down):
- ...

**Operator action taken** (what they did at the time — even if it was
"nothing, observed only"):
- ...

**Hypothesis** (optional — what the operator thinks happened, marked as
hypothesis so it is not confused with fact):
- (hypothesis) ...

**Pilot impact**:
- can the pilot continue today: yes / no / paused
- next-day plan: continue / re-test / halt
```

---

## Resolution sub-entry template

When an open entry is resolved, append a sub-entry below the original (do
not edit the original):

```markdown
#### Resolution for Entry NNN — YYYY-MM-DD HH:MM

**Resolved by**: name
**Root cause** (factual, post-investigation):
- ...

**Fix or mitigation applied**:
- (commit / config change / pack switch / no fix needed — explain)

**Verification** (how we know it is actually fixed):
- (re-run probe / test / manual check)
- new snapshot: `docs/reports/<pilot-id>/<label>-field-pilot-status.json`

**Did this entry change the pilot verdict?**: yes / no
**Does this entry require a new troubleshooting catalog item?**: yes / no
- (if yes, link to the troubleshooting entry by anchor)
```

---

## Cross-reference: probe verdict → typical entry severity

This is a guide, not a hard rule. The operator picks severity based on what
they actually observed.

| Probe verdict | Typical entry severity | Notes |
|---|---|---|
| `OK` (exit 0) | usually no entry | Some operators record a short `info` entry on day 1 to anchor the chain. |
| `DEGRADED` (exit 1) | `degraded` | Pick `info` if the verb count was 1 and obviously expected (e.g. operator ran a deliberate idle test). |
| `INCIDENT` (exit 2) | `incident` or `critical` | Use `critical` only if the verb is in `INCIDENT_VERBS` AND the operator could not continue. |
| `CONFIG` (exit 3) | `incident` | Server unreachable or no token — operator cannot evaluate the day. |

---

## Audit verbs that map directly to ledger entries

When the daily probe shows a non-zero count for one of these, **always** open
a ledger entry — even if probe verdict is `OK` (probe weights small counts
softly):

| Verb | Default severity | Why |
|---|---|---|
| `claim_verification_failed` | `incident` | Audit chain integrity — investigate immediately. |
| `trust_store_private_key_rejected` | `critical` | Trust root surface — halt pilot until reviewed. |
| `credential_plaintext_fallback` | `critical` (if production) / `info` (if dev mode explicitly opted in) | Plaintext secret on disk in production = halt. |
| `launcher_signature_failed` | `incident` | Install gate failed; could indicate tampered manifest. |
| `runner_handshake_collision` | `incident` | Two hosts claiming the same identity — investigate before next runner spawn. |
| `runner_host_lost` | `degraded` | Network drop is normal; only escalate if frequent. |
| `pii_scan_blocked` | `degraded` (low count) / `incident` (high count) | A blocked scan is the system working; high counts mean the operator is repeatedly trying. |
| `policy_gate_blocked` (hard mode) | `degraded` | Expected when the operator hits a real gate; worth recording but not investigating. |

---

## Linking entries to external review

At the end of the pilot, the FIELD-PILOT-0 round closeout report references
this ledger by file path. The external reviewer (EXTERNAL-REVIEW-0) will:

1. Count entries by severity — fewer is better but zero is suspicious.
2. Spot-check that each `incident` and `critical` entry has a Resolution
   sub-entry.
3. Sample 1–2 `degraded` entries to confirm the snapshot JSON matches the
   description.
4. Check that no entry references unsanitized secrets, raw user prompts, or
   identifiable data.

A clean ledger means: every deviation is recorded, every incident has a
root cause, and no entry leaks. That is the bar.
