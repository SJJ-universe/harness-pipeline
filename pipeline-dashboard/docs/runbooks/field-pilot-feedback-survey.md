# Runbook — Field-Pilot Feedback Survey

**Slice FP-b (Phase 2 / FIELD-PILOT-0, 2026-05-05)**

This is the **end-of-week feedback survey** for the field pilot. It captures
*subjective* operator experience — what the daily probe (`field-pilot-status.js`)
and the deployment log cannot measure.

The survey complements the machine evidence:

- **Probe** → did anything in the audit chain look wrong?
- **Deployment log** → what did the operator do each day?
- **Incident ledger** → what deviated from boring?
- **Survey (this file)** → did the harness *feel* like a tool the operator
  trusts?

A pilot can be technically green (no incidents, all probes OK) and still
fail this survey — and that is a regression worth fixing.

---

## How to use this template

1. Copy this file to `docs/reports/<pilot-id>/feedback-survey.md` once at
   the start of the pilot. Each operator fills their own copy.
2. Fill it at the **end** of the pilot week. Do not pre-fill day-by-day —
   the survey is intentionally a retrospective.
3. Be honest about discomfort. A "5/5 everywhere" survey is a regression
   signal — it means the operator did not stress-test the tool.
4. Link the completed survey from the deployment-log Closeout section.
5. The reviewer (EXTERNAL-REVIEW-0) reads this with the rest of the
   evidence bundle.

> **Privacy reminder**: do not put names, customer references, or specific
> prompts in this survey. Refer to scenarios abstractly ("a code review of
> a financial calculation") rather than identifying detail.

---

## Section 1 — Operator context

| Field | Value |
|---|---|
| Pilot ID | `2026-MM-DD-<short-name>` |
| Operator role | (e.g. backend developer, security reviewer, ops engineer) |
| Years of experience with AI-assisted dev tools | none / <1 / 1-3 / 3+ |
| Pack mode used | `standard` / `public-sector` / `finance-high-privacy` / `offline-internal-network` / `developer-lab` |
| Days in pilot | N (1-7) |
| Tasks attempted (rough categories) | code review / refactor / bug investigation / infra change / other |

---

## Section 2 — Per-area Likert (1–5)

For each row, pick a single number:

- **1** — Felt broken or actively misleading.
- **2** — Worked but I avoided using it.
- **3** — Worked. I had no strong opinion.
- **4** — Worked well. I would use it again.
- **5** — Made my work measurably better.

Then add a short comment **regardless of score** — even a 5 deserves one
sentence on what made it work.

| Area | Score | Comment (one sentence) |
|---|:---:|---|
| Install & first-run (launcher → wizard → first review) |   |   |
| Account / login flow (`COPY_LOGIN_COMMAND_*` CTAs) |   |   |
| Profile management (switch / test / set API key) |   |   |
| Codex critique quality |   |   |
| Claude hand-back behavior (after critique) |   |   |
| Approval flow for write tools (R3-e — only if used) |   |   |
| Pack-rule blocks (`policy_gate_blocked` — only if hit) |   |   |
| PII scan behavior (only if hit) |   |   |
| Long-running task survival (RR0 — only if you ran > 10 min) |   |   |
| Daily probe (`field-pilot-status.js`) |   |   |
| Audit chain readability (when investigating an incident) |   |   |
| Dashboard simple shell (4 cards) |   |   |
| Dashboard advanced shell (full timeline + audit + approvals) |   |   |
| First-run guidance (initial CTA cards / pack catalog) |   |   |
| Korean / English UX parity (if relevant to your locale) |   |   |
| Overall trust in the tool (would you recommend it to a peer?) |   |   |

---

## Section 3 — Open-ended

### 3.1 What surprised you (positive)?

> ...

### 3.2 What surprised you (negative)?

> ...

### 3.3 What did you turn off, work around, or wish you could turn off?

> ...

(This question is critical — workarounds are the most reliable signal of
friction. Be specific.)

### 3.4 What did you wish was there but was not?

> ...

### 3.5 If you only had 1 hour to fix one thing, what would it be?

> ...

### 3.6 Did you ever feel the tool was making a decision you should have made?

> yes / no — and one example.

(This is a safety question. AI tools that overstep operator authority are
the highest-risk failure mode. Even one "yes" is worth investigating.)

### 3.7 Did you ever feel the tool was being too cautious / too restrictive?

> yes / no — and one example.

(Mirror of 3.6. Both directions matter.)

---

## Section 4 — Pack-specific feedback

If you used `public-sector`, `finance-high-privacy`, or
`offline-internal-network`, answer 4.1–4.4. Otherwise skip this section.

### 4.1 Did the pack's hard gates block legitimate work?

> ...

### 4.2 Did the pack's audit / evidence requirements feel proportionate?

> ...

### 4.3 Was the pack catalog (POL-c `publicSectorRequirements`) clear about
> *why* each rule exists?

> ...

### 4.4 Would you deploy this pack to your team without modification?

> yes / no — and what modification, if any.

---

## Section 5 — Recommendation

| Field | Value |
|---|---|
| Recommend running another 1-week pilot? | yes / no / yes-with-changes |
| Recommend extending this pilot to 2 weeks? | yes / no |
| Recommend rolling out to a wider team? | not yet / yes-as-is / yes-after-changes |
| Top 3 changes you would request before next pilot | 1. ... 2. ... 3. ... |

---

## Section 6 — Free-form closing note

This is the operator's last word on the pilot. 3–5 sentences. Reviewer reads
this first.

> ...

---

## Privacy & retention

This survey is committed to the repo as evidence. Do **not** include:

- Real customer names, real internal project names, real client work.
- Specific prompts that contained secrets, PII, or proprietary code.
- Names of teammates or operators (other than your role).
- Any machine identifiers (real hostnames, IPs, MAC addresses).

If a survey answer would be too sensitive without specifics, write the
generic version. The reviewer values "I had a critique that took 27 min and
felt slow" over "[specific customer] critique took 27 min".

When the pilot closes, the survey becomes part of the FIELD-PILOT-0 round
closeout. Survey content is not retroactively edited — if a fact changes
post-survey, append a `Postscript` section, do not edit the original.
