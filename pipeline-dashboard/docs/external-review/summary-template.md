# External Review — Summary Report

**Slice EXR-d (Phase 2 v2 follow-up, 2026-05-05)**

This is the **reviewer-facing summary template** that closes the
EXR pipeline:

```
EXR-a (bundle JSON)  →  EXR-b (claim/evidence matrix → mark rows)
                          ↓
        EXR-d (this template) ← aggregate findings + verdicts
                          ↓
              cap-movement recommendation
```

EXR-c shipped without it as a documented gap:

> "Reviewer-facing summary report template — beyond the matrix
> itself, an aggregated `<date>-external-review-summary.md` template
> that the reviewer fills (verdicts grouped + sampling strategy +
> recommended cap movement + listed gaps)" — EXR-c closeout

EXR-d ships that template. The reviewer fills this once per review
cycle; the committed summary is the canonical artifact the cap-
movement gate consumes.

---

## How to use this template

1. Copy this file to
   `docs/reports/<YYYY-MM-DD>-external-review-summary.md`
   when starting a review cycle.
2. The reviewer fills it AFTER:
   - Walking the EXR-a bundle JSON (`<date>-external-review-bundle.json`)
   - Sampling rows in the EXR-b matrix
     (`docs/external-review/<review-id>/claim-evidence-matrix.md`)
3. Sections marked `<!-- REQUIRED -->` must be filled. Sections
   marked `<!-- OPTIONAL -->` are reviewer discretion.
4. Reviewers do NOT need to assess every category in §3 — the
   sampling strategy in §2 documents which they covered. Leaving a
   category section unfilled is acceptable AS LONG AS the sampling
   strategy explains why.
5. The committed summary becomes part of the round's evidence.
   Future reviewers can read it to understand the prior cycle's
   findings + aggregate trends.

> **Privacy reminder**: do not include real customer names, real
> project names, real operator names, real prompts, or any
> credential strings — even in reviewer-notes fields. Use abstract
> placeholders like "operator A" or "a public-sector pilot
> deployment".

---

## §0 Header <!-- REQUIRED -->

| Field | Value |
|---|---|
| Review id | `<YYYY-MM-DD>-<reviewer-handle>` (e.g. `2026-05-05-aud-1`) |
| Review date | `<YYYY-MM-DD>` |
| Reviewer | `<reviewer name OR pseudonym>` (NOT real org email) |
| Reviewer affiliation | `<role / org type — abstract>` (e.g. "external auditor", "internal compliance team") |
| Bundle reviewed | `<path to bundle JSON>` |
| Bundle sha256 | `<sha256 hex>` (recompute, don't trust the bundle's self-report) |
| Bundle verdict at capture | `OK` / `DEGRADED` / `INCIDENT` / `CONFIG` |
| Matrix copy | `<path to claim-evidence-matrix.md instance>` |
| Time invested | `<rough hours>` (review effort, for sampling-density signals) |

---

## §1 Verdict <!-- REQUIRED -->

| Field | Value |
|---|---|
| **Overall verdict** | `PASS` / `PASS-WITH-CONCERNS` / `FAIL` |
| **Cap movement recommendation** | `MOVE` / `DEFER` / `BLOCK` |

Verdict tier semantics:
- **`PASS`** — sampled rows showed no FAIL, ≤ 1 DOUBT per category,
  no concerns block cap movement. The committer's "regression-free"
  claim is verified.
- **`PASS-WITH-CONCERNS`** — sampled rows showed no FAIL, but one or
  more DOUBTs that need follow-up. Cap movement may still be
  defensible depending on the concerns; reviewer documents in §4.
- **`FAIL`** — at least one sampled row was FAIL, OR a critical
  concern was discovered outside the sampled rows. Cap movement
  blocked; reviewer documents the failure mode + remediation
  recommendation.

Cap movement recommendation semantics:
- **`MOVE`** — reviewer recommends advancing the cap (e.g. Public-
  sector readiness +1, Testability +1). §6 lists which caps + the
  per-cap justification.
- **`DEFER`** — reviewer is convinced the work is regression-free
  but evidence for cap movement is incomplete (e.g. matrix sampled
  but operator-time evidence still missing). §6 lists what would
  unblock MOVE on a future review.
- **`BLOCK`** — reviewer found something that prevents cap
  advancement until remediated. §4 documents the finding + §6
  documents what would unblock.

> **One-paragraph executive summary** (4-6 sentences max — what would
> a busy committer want to know first?):
>
> ...

---

## §2 Sampling strategy <!-- REQUIRED -->

Document HOW the reviewer chose which matrix rows to sample. Future
reviewers reading this need to understand the coverage. Examples:
- "Random N rows across all 8 categories"
- "Focused: only Category 5 (public-sector) — 100% rows + audit
  chain spot-check"
- "Risk-weighted: every row in Category 5 + 6 + 8 (cap-relevant);
  spot-checked 1-2 rows per other category"
- "Time-boxed: 2-hour review, took rows in matrix order until time"

| Field | Value |
|---|---|
| Strategy name | `<one of: random / focused / risk-weighted / time-boxed / other>` |
| Total rows in matrix | `<N>` |
| Rows sampled | `<M>` |
| Coverage % | `<M/N as %>` |
| Categories fully sampled | `<list of categories where 100% of rows were checked>` |
| Categories untouched | `<list — and why these were skipped>` |

> **One-paragraph rationale** for the chosen strategy:
>
> ...

---

## §3 Per-category verdict aggregation <!-- REQUIRED -->

For each category the reviewer sampled, count the row verdicts. A
category section MAY be left empty if the sampling strategy in §2
explains why.

The 8 baseline categories from EXR-b:

### §3.1 Pipeline orchestration & dual-agent loop

| Verdict | Count |
|---|---|
| PASS | `<N>` |
| DOUBT | `<N>` |
| FAIL | `<N>` |
| (not sampled) | `<N>` |

| Field | Value |
|---|---|
| Cap-relevance | Dual-agent integration |
| Reviewer notes | `<one paragraph max>` |

### §3.2 Multi-run isolation

| Verdict | Count |
|---|---|
| PASS | `<N>` |
| DOUBT | `<N>` |
| FAIL | `<N>` |
| (not sampled) | `<N>` |

| Field | Value |
|---|---|
| Cap-relevance | Pipeline orchestration |
| Reviewer notes | `<one paragraph max>` |

### §3.3 Long-running task survival

| Verdict | Count |
|---|---|
| PASS | `<N>` |
| DOUBT | `<N>` |
| FAIL | `<N>` |
| (not sampled) | `<N>` |

| Field | Value |
|---|---|
| Cap-relevance | Error resilience |
| Reviewer notes | `<one paragraph max>` |

### §3.4 Account / profile management & safe guidance

| Verdict | Count |
|---|---|
| PASS | `<N>` |
| DOUBT | `<N>` |
| FAIL | `<N>` |
| (not sampled) | `<N>` |

| Field | Value |
|---|---|
| Cap-relevance | Safety + UI |
| Reviewer notes | `<one paragraph max>` |

### §3.5 Public-sector posture & GOV-* defenses

| Verdict | Count |
|---|---|
| PASS | `<N>` |
| DOUBT | `<N>` |
| FAIL | `<N>` |
| (not sampled) | `<N>` |

| Field | Value |
|---|---|
| Cap-relevance | Public-sector readiness (priority cap target) |
| Reviewer notes | `<one paragraph max>` |

### §3.6 Smart arc

| Verdict | Count |
|---|---|
| PASS | `<N>` |
| DOUBT | `<N>` |
| FAIL | `<N>` |
| (not sampled) | `<N>` |

| Field | Value |
|---|---|
| Cap-relevance | Safety + Observability |
| Reviewer notes | `<one paragraph max>` |

### §3.7 Field-pilot evidence collection

| Verdict | Count |
|---|---|
| PASS | `<N>` |
| DOUBT | `<N>` |
| FAIL | `<N>` |
| (not sampled) | `<N>` |

| Field | Value |
|---|---|
| Cap-relevance | Public-sector readiness (priority cap target) |
| Reviewer notes | `<one paragraph max>` |

### §3.8 External reviewer hand-off

| Verdict | Count |
|---|---|
| PASS | `<N>` |
| DOUBT | `<N>` |
| FAIL | `<N>` |
| (not sampled) | `<N>` |

| Field | Value |
|---|---|
| Cap-relevance | Testability + reviewer trust (priority cap target) |
| Reviewer notes | `<one paragraph max>` (reviewer's experience using EXR-a/b — was the bundle/matrix usable?) |

---

## §4 Findings <!-- REQUIRED if any DOUBT or FAIL exists -->

For each FAIL or DOUBT verdict, document:

```markdown
### Finding F.<N>

**Severity**: critical / high / medium / low
**Category**: §3.<N> from above
**Matrix row(s)**: e.g. `5.2`, `6.1`
**Code anchor**: `<file:line>` (or "N/A — invariant violation")
**What I observed**:
> ...

**Why this is a finding**:
> ...

**Recommended remediation** (operator-actionable):
> ...

**Blocks cap movement?**: yes / no
```

If there are no findings (PASS verdict), explicitly state:

> No findings. All sampled rows verified.

---

## §5 Comparison against prior bundle <!-- OPTIONAL -->

If this is not the first review cycle, compare against the prior
summary:

| Field | Prior cycle | This cycle |
|---|---|---|
| Bundle date | `<YYYY-MM-DD>` | `<YYYY-MM-DD>` |
| Bundle verdict | `OK/DEGRADED/...` | `OK/DEGRADED/...` |
| Score (numerator/cap) | `<N/M>` | `<N/M>` |
| Total closeouts | `<N>` | `<N>` |
| Rounds added | — | `<list of round ids>` |
| New findings | — | `<list of F.N from §4>` |
| Findings carried forward | `<list>` | `<list>` |
| Findings closed | — | `<list — finding ids that the prior cycle flagged but no longer apply>` |

> **Trend assessment** (one paragraph): is the work converging on
> cap-ready, drifting, or stable?
>
> ...

---

## §6 Recommended cap movements <!-- REQUIRED if §1 = MOVE -->

For each cap the reviewer recommends moving, document:

```markdown
### Cap C.<N>

**Cap line**: e.g. "Public-sector readiness", "Testability"
**Current**: `<N> / <M>` (per scorecard.md at bundle capture time)
**Recommended new**: `<N+1> / <M>`
**Justification** (cite specific matrix rows + closeout reports):
> ...

**Counter-argument** (what would NOT moving look like?):
> ...
```

If §1 = `DEFER` or `BLOCK`, document what evidence WOULD enable
MOVE on a future review:

```markdown
### Future cap candidate: `<cap line>`

**What's missing today**:
> ...

**What evidence would unblock**:
> ...
```

---

## §7 Operator-actionable next steps <!-- OPTIONAL -->

If the reviewer has specific suggestions for the next operator cycle
(beyond findings in §4), list them here. These are NOT cap blockers
but quality-of-life improvements:

- e.g. "Add a row 6.6.1 specifically for pack-info-card render"
- e.g. "Future bundle could include a list of dismissed
  recommendations as additional context"
- e.g. "i18n smoke for the 10 POL-UI-1 keys would prevent silent
  translation loss"

---

## §8 Privacy & retention statement <!-- REQUIRED -->

By committing this summary, the reviewer confirms:

- [ ] No real customer / project / operator names appear in any
  field
- [ ] No credential strings (API keys, tokens, passwords) appear in
  any field
- [ ] Reviewer-notes use abstract placeholders for any specific
  incidents
- [ ] No machine identifiers (real hostnames, IPs, MAC addresses)
  appear

| Field | Value |
|---|---|
| Reviewer signature (handle) | `<reviewer name OR pseudonym>` |
| Date signed | `<YYYY-MM-DD>` |
| This summary may be shared externally? | yes / no / yes-with-redaction |

---

## Appendix — Cap-movement justification template

The cap-movement candidates documented across rounds:

| Cap | What proves it | Source closeouts |
|---|---|---|
| Public-sector readiness +1 | Operator runs orchestrator for ≥1 working week with `ORCHESTRATOR_DEPLOYMENT_PROFILE=public-sector`, daily probe snapshots committed, deployment-log filled, incident-ledger reflects real activity, feedback survey submitted, pack-info-card visibly shown 5-bullet requirements | FIELD-PILOT-0 + POL-UI-1 + EXTERNAL-REVIEW-0 |
| Testability +1 | EXR-a bundle exporter + EXR-b matrix structural tests + round-trajectory parser + verifiable sha256 chain + reviewer summary committed (this template) | EXR-a/b/c + EXR-d (this round) |
| Safety +1 | ORCHESTRATOR_HARD_GATES=1 + finance-high-privacy in production for ≥1 week + ledger samples showing `policy_gate_blocked` triggered + state-immutability verified end-to-end | SMART-2 + SMART-LV-0 + FIELD-PILOT-0 |

If the reviewer recommends a cap movement, cite the specific
combination from this table — DON'T invent new cap definitions.
Caps are codified in `docs/scorecard.md`.
