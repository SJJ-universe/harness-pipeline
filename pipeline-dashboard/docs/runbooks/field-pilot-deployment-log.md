# Runbook — Field-Pilot Deployment Log

**Slice FP-b (Phase 2 / FIELD-PILOT-0, 2026-05-05)**

This is the **operator's daily log** for the 1-week field-pilot deployment of
the orchestrator. It pairs with `scripts/field-pilot-status.js` (FP-a): the script
captures *machine* signal (audit verbs / readiness / posture); this log
captures *human* signal (what was deployed, who used it, what felt off).

The combined evidence — daily JSON snapshot + this log + the incident ledger
— is what the operator and external reviewer use to decide whether the
orchestrator is **production-no-regression** at the end of week 1.

---

## How to use this template

1. Copy this file to `docs/reports/<pilot-id>/deployment-log.md` at the start
   of the pilot. (`<pilot-id>` = e.g. `2026-05-05-pilot-team-alpha`.)
2. Fill the **Pilot context** block once on day 1.
3. For each operator working day, copy the **Daily entry template** at the
   bottom and fill it in.
4. Run `node scripts/field-pilot-status.js --label day-N --notes "<paste day's
   summary line>"` at end of day so the JSON snapshot and this log share the
   same human note.
5. At the end of the week, summarize in **Closeout** at the bottom and link
   the closeout to the FIELD-PILOT-0 round closeout report.

> **Privacy reminder**: do not put real customer data, real API keys, real
> trust-store private keys, or any secret in this log. Use placeholders. The
> log is committed to the repo as evidence and is reviewable.

---

## Pilot context

Fill once on day 1.

| Field | Value |
|---|---|
| Pilot ID | `2026-MM-DD-<short-name>` |
| Operator(s) | name / role |
| Reviewer (external) | name / role (optional, if any) |
| Pack mode | `standard` / `public-sector` / `finance-high-privacy` / `offline-internal-network` / `developer-lab` |
| Deployment posture | `loopback` / (other — explain) |
| Orchestrator version (commit) | `git rev-parse HEAD` at start of pilot |
| Node version | `node --version` |
| Codex CLI | `codex --version` (or "not used") |
| Claude CLI | `claude --version` (or "not used") |
| Trust-store keys count | `node scripts/launcher-cli.js list-keys \| wc -l` |
| Manifest signing | `signed` / `dev-escape` / `not-applicable` |
| Goal of pilot | one sentence — what would convince us this is regression-free |
| Definition of "incident" | short threshold — what would force us to halt |

---

## Daily entries

Append a new block per operator working day. Most days should be **boring** —
that is the point of a no-regression run.

Use the template at the bottom; copy-paste, fill in, do not edit prior days.

---

### Day 1 — `<YYYY-MM-DD>`

(Copy template below.)

### Day 2 — `<YYYY-MM-DD>`

(Copy template below.)

### Day 3 — `<YYYY-MM-DD>`

(Copy template below.)

### Day 4 — `<YYYY-MM-DD>`

(Copy template below.)

### Day 5 — `<YYYY-MM-DD>`

(Copy template below.)

### Day 6 — `<YYYY-MM-DD>`

(Copy template below.)

### Day 7 — `<YYYY-MM-DD>`

(Copy template below.)

---

## Daily entry template

```markdown
### Day N — YYYY-MM-DD

**Probe verdict**: OK / DEGRADED / INCIDENT / CONFIG  ← from `field-pilot-status.js` exit code
**Probe label**: `day-N`
**Snapshot file**: `docs/reports/<pilot-id>/day-N-field-pilot-status.json`

**What was deployed today**:
- (commits / config changes / pack switches / new trust-store keys)
- (or "no changes — same as yesterday")

**What was used today** (rough operator activity):
- review sessions started: N
- approvals requested / granted / denied / timed-out: N / N / N / N
- run memory entries written: N (from snapshot `audit.today.byVerb.run_memory_recorded`)
- long-running runs (>10 min): N
- subagents spawned: N

**Anomalies observed (if any)**:
- (1 sentence each — full detail goes in the incident ledger if any reaches threshold)
- example: "Codex took 22 min on the security review at 3 PM, no idle kill, no incident."

**Operator note** (free-form, 2–4 sentences):
- what felt smooth / what felt rough / any UX surprise

**Tomorrow's plan**:
- (or "continue as today")
```

---

## Closeout

Fill once at end of pilot.

| Field | Value |
|---|---|
| Pilot end date | `YYYY-MM-DD` |
| Final orchestrator version (commit) | `git rev-parse HEAD` |
| Days fully boring (verdict OK) | N / 7 |
| Days DEGRADED | N / 7 |
| Days INCIDENT | N / 7 |
| Incidents requiring investigation | N (link to incident ledger entries) |
| Incidents requiring rollback | N |
| New troubleshooting entries added | N (link to troubleshooting catalog) |
| Operator overall verdict | "regression-free" / "regression-with-mitigation" / "regression — halt" |
| Reviewer overall verdict (if any) | (same options) |
| Recommendation for next pilot | (e.g. "extend to 2 weeks", "add second operator", "halt and fix") |

**Closeout summary** (3–5 sentences for the FIELD-PILOT-0 round closeout report):

> ...

**Linked artifacts**:

- `docs/reports/<pilot-id>/day-1-field-pilot-status.json` … `day-7-field-pilot-status.json`
- `docs/reports/<pilot-id>/incident-ledger.md`
- `docs/reports/<pilot-id>/feedback-survey.md`
- (added troubleshooting entries: link by anchor)

---

## Field-pilot-status JSON cross-reference

For each daily entry, the matching JSON snapshot is at
`<evidence-dir>/<label>-field-pilot-status.json` and follows schema
`orchestrator-field-pilot-status/v1`.

Top-level keys (frozen — see `scripts/field-pilot-status.js`):

| Key | Meaning |
|---|---|
| `schema` | always `orchestrator-field-pilot-status/v1` |
| `capturedAt` | ISO timestamp when the probe ran |
| `verdict` | `OK` / `DEGRADED` / `INCIDENT` / `CONFIG` |
| `environment` | server-info subset (pack, posture, runtime) |
| `health` | per-check pass/fail with reason |
| `audit` | today's audit verb counts + anomalies + unknownVerbs |
| `runtime` | readiness score + scorecard freshness |
| `notes` | the `--notes` string passed on the CLI |

Reviewer can grep across the 7 daily files for trend (e.g.
`jq -r '.audit.today.byVerb.policy_gate_blocked' day-*.json`) — that is the
purpose of the frozen schema.
