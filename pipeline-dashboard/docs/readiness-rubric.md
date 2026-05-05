# Harness Readiness Rubric

Date: 2026-04-27
Status: Initial draft (Slice MB5 of Phase D Round 2)
Last expanded: 2026-05-05 (Slice READINESS-DOC-1 — per-category narrative + operator workflow)
Parent spec: `docs/superpowers/specs/2026-04-27-five-priority-roadmap.md` (P5)

## 1. Why this exists

The harness has strong unit + integration coverage (<!-- AUTO:test-counts -->**3826 unit / 553 integration**<!-- /AUTO -->) — but unit coverage tells you "the code does what it says". It does NOT tell you whether the system is OPERATIONALLY usable for the next wave. This rubric defines that operational view.

_(test-count line above auto-derived by `npm run scorecard:sync`; do not hand-edit between markers.)_

A passing test count is necessary; a passing readiness check is what tells the team "we are ready to ship Phase D Round 2 / start Phase 3 design / cut a release".

## 2. The six readiness categories

Each category has 0..3 stars. Total 18 stars across the rubric. A category at 0 stars means **blocking** — the release can't go out. 1 star is acceptable for an internal preview. 2+ stars is required for an external release.

> Slice R1-i (Phase D R1, 2026-04-28) added the **remote-isolation** category, lifting the cap from 15 to 18 stars and re-scaling the gate thresholds proportionally.

### 2.1 Run visibility

**Question**: Can an operator answer "what is running right now and what's it doing?" in under 5 seconds?

**Why it matters**: An operator who can't tell *what is happening at this moment* can't trust any output the harness produces. Run visibility is the bedrock of every other operator-trust signal in this rubric — a 0/3 here makes the rest of the stars effectively vacuous, because the operator has no fixed point to evaluate them against.

| Stars | Criterion |
| --- | --- |
| ★ | `/api/server/info` and `/api/monitor/bootstrap` both respond 200 with a usable shape. |
| ★★ | The monitor shell (opt-in) renders the run-tree + run-summary panels with live data within 1s of the user opting in. |
| ★★★ | `/api/monitor/runs/:runId` returns run detail (events / children / subagents / findings) for every run in the orchestrator's list. |

**Star progression**: ★ tests the lowest-effort surface — the HTTP control plane returns *something* sensible. ★★ ensures that 200 wires through to live UI panels under realistic latency (a 200 that takes 30 seconds is functionally a failure here). ★★★ adds detail-on-demand: the per-run endpoint must serve every active run, not just the first or most-recent — this was the gap that triggered Slice MB1.

### 2.2 Child visibility

**Question**: If the harness spawns 3 children (Codex + Claude + subagent), can an operator see all three from the dashboard?

**Why it matters**: A typical run can spawn 3+ child processes — Codex (critic), Claude (executor), plus any subagents the executor delegates to. If a single child becomes invisible to the operator (e.g. a subagent stuck in a tight loop, or a runaway Codex token burst), there is no in-band way to catch it before it consumes resources. The agent-tree panel is what makes "spawn happened" survive into "spawn is observable".

| Stars | Criterion |
| --- | --- |
| ★ | `childRegistry.snapshot()` is exposed via `/api/server/info.activeChildren`. |
| ★★ | The agent-tree panel renders one row per active child grouped by runId. |
| ★★★ | The agent-tree panel ALSO renders active subagents (server-authoritative snapshot, MB2). Long-running subagents survive event-ring eviction. |

**Star progression**: ★ exposes the registry over the read-only HTTP surface so an external scraper or CLI can see active children. ★★ groups children per-run in the in-browser shell — operators routinely run multiple pipelines and need to attribute children to the right one. ★★★ extends the visibility to subagents (the long-running, often-deep-in-the-tree spawns that simple event-ring inspection would lose first); MB2's server-authoritative snapshot is what closes this gap.

### 2.3 Replay visibility

**Question**: If a client reconnects mid-run, can it reproduce the recent timeline accurately?

**Why it matters**: Operators reconnect mid-run for ordinary reasons — network blip, browser tab crash, dashboard reload after editing a file. Without faithful replay, the timeline desynchronizes from server state and the operator's next decision is based on a stale screenshot. This is the category that catches a whole class of "the dashboard showed X but it actually was Y" bugs.

| Stars | Criterion |
| --- | --- |
| ★ | `eventReplayBuffer` exposes a 500-event ring with `snapshot({runId, includeGlobal})` filter. |
| ★★ | WS reconnect → client receives `pipeline_replay` with the correct run-scoped events (Phase 2.5 AA-2). |
| ★★★ | Pinned events (MA6) survive ring eviction in the monitor store; the timeline still surfaces them after 200+ events have flowed past. |

**Star progression**: ★ confirms the ring exists and supports the run-scoped filter the dashboard needs. ★★ ensures cross-run leakage is impossible on reconnect — a client that asked for run A doesn't accidentally see run B's events. ★★★ closes the operator-emphasis gap: when an operator pins an interesting event, that pin must survive the next 200+ events flowing past, otherwise the manual highlight is meaningless within minutes.

### 2.4 Event integrity

**Question**: When the legacy WS stream and the monitor store both observe the same event, are they consistent?

**Why it matters**: Two independent paths emit the same event today (legacy WS for the original dashboard, monitor store for the MA1+ shell). If they diverge, operators can't reason about "what really happened" — one panel asserts X, another asserts Y, and there is no privileged source of truth. Event integrity is the property that lets multiple panels disagree about *presentation* (filtering, sorting, highlighting) while agreeing on *substance*.

| Stars | Criterion |
| --- | --- |
| ★ | All MA1 envelope fields (type / runId / ts / scope / summary / payload) are emitted for every normalised event. |
| ★★ | The monitor legacy-bridge (MB4-a) forwards every event into the monitor store via the dispatcher tap. Stats expose `eventsForwarded` and `eventsDropped`. |
| ★★★ | A timeline filter chip toggle (MA6) drops the matching events from the monitor view but the bottom-dock raw log still shows them — the bridge stayed authoritative. |

**Star progression**: ★ canonicalizes the envelope shape so downstream consumers don't have to dispatch on event-name patterns. ★★ verifies the bridge actually forwards every event (not "every event we remembered to add a case for") and exposes its own stats so silent drops are visible. ★★★ enforces "filtering is a UI concern, not a data concern" — a filter chip changes the rendered view but the underlying log retains every event the bridge saw.

### 2.5 Contract stability

**Question**: Can a future panel be added without changing the server contract?

**Why it matters**: New panels must arrive without breaking shipped clients. If shipping a feature requires changing `/api/server/info`'s shape, every external integration (CLI tools, third-party dashboards, smoke probes) breaks on upgrade. Contract stability is what lets the harness keep growing without the cost of growing scaling super-linearly with downstream consumer count.

| Stars | Criterion |
| --- | --- |
| ★ | `/api/monitor/bootstrap` and `/api/monitor/runs/:runId` shapes are documented + locked by integration tests. |
| ★★ | The legacy `/api/server/info` and `/api/runs/current` shapes are unchanged from before Phase D — additive contracts only (MB1 was additive). |
| ★★★ | A new monitor panel can be added by registering a `panels.X` override in `HarnessMonitorLayout.mount` without modifying any other module. |

**Star progression**: ★ documents the contracts and locks them with tests so deviation is loud. ★★ enforces the additive-only rule for legacy contracts — older clients keep working when new fields land. ★★★ extends the additive principle to UI: a new panel is an inversion-of-control registration, not a multi-file edit, which is what lets contributors ship in isolation.

### 2.6 Remote isolation

**Question**: When the operator opts into the remote-runner subsystem, does the trust boundary actually hold?

**Why it matters**: When the operator opts into remote runners, the trust boundary is the difference between local-only inspection and exposing the orchestrator's authority to a distributed agent. A breach in this category is materially worse than any other star drop in this rubric — a compromised remote runner could potentially access local resources or forge audit entries. This is the only category where the *default* posture matters as much as the verified-behavior posture: the harness ships fail-closed and only opens the boundary on explicit operator opt-in.

| Stars | Criterion |
| --- | --- |
| ★ | `HARNESS_REMOTE_MODE` defaults to `"off"` (workspace-boundary closed). `setupRemoteRunner({ env: {} })` returns `mode="off"`, `runnerRegistry=null`, both keys `null`; `createRunnerRoutes(mode="off")` 404s every route. |
| ★★ | Token model with HKDF domain separation. The JWT signing key (`info="runner-jwt"`) and the audit-ledger signing key (`info="audit-ledger"`) derive from the same `HARNESS_TOKEN` IKM but produce two independent 32-byte keys. Compromising one must not compromise the other. |
| ★★★ | **Live end-to-end round-trip** (R1-g upgrade). An in-process orchestrator + RunnerAgent: handshake → WS hello → `agent_started` frame → orchestrator's `childRegistry` shows the remote child with the right `runId` + `hostIdentity` + `remote:true` flag, AND the audit chain still verifies under HMAC. Subsumes the previous "audit chain only" check — a regression in path-aware demux, JWT verify, WS frame routing, child projection, OR ledger signing makes this star drop. |

**Star progression**: ★ verifies the default-off posture — the most important security invariant in the harness. ★★ tests the cryptographic property that lets the two signing keys live in the same process without one's compromise cascading to the other. ★★★ exercises the entire remote pathway end-to-end so a regression anywhere in WS demux, JWT verify, frame routing, child projection, or ledger HMAC drops the star — there is no place to silently break this.

> The full agent flow (handshake → heartbeat sliding TTL → JWT-authenticated WS hook → graceful release) is exercised by the integration suite (`tests/integration/runner-server-wiring.test.js`, `runner-routes.test.js`, `runner-ws-r1g.test.js`). The readiness rubric verifies these three invariants live; the suite covers the broader choreography.

## 3. Current readiness (auto-derived, live mode)

The numbers below come from `npm run scorecard:sync` running
`scripts/readiness-report.js` in **live mode** — i.e. the script spawns
a throwaway harness (`node server.js` on `HARNESS_READINESS_PORT=5099`)
and exercises the http endpoints alongside the in-process module
checks. This is the canonical signal; the rest of this document and
the doc-sync test suite agree that "readiness" means "live readiness".

**Total** (live, server-spawned): <!-- AUTO:readiness-total -->**18 / 18**<!-- /AUTO -->.

Per-category breakdown (live):

<!-- AUTO:readiness-stars -->  - run-visibility: 3/3
  - child-visibility: 3/3
  - replay-visibility: 3/3
  - event-integrity: 3/3
  - contract-stability: 3/3
  - remote-isolation: 3/3<!-- /AUTO -->

A 12+ score means "ready for external preview"; 17+ for a release tag.

_(totals + per-category breakdown above auto-derived by `npm run scorecard:sync`; do not hand-edit between markers.)_

### Two modes — when each is appropriate

| Mode | Command | What it scores | When to use |
| --- | --- | --- | --- |
| **Live** (default) | `npm run readiness:check` <br> `npm run scorecard:sync` | All 6 categories × 3 stars (18 max). HTTP checks plus in-process behavior. | Local dev, CI, release gating. |
| **Static** | `node scripts/readiness-report.js --no-spawn` <br> `node scripts/sync-scorecard.js --no-spawn` | Only stars verifiable without a server (currently 9/18: replay-visibility 2/3 + event-integrity 3/3 + contract-stability 1/3 + remote-isolation 3/3). | Sandboxed runners that cannot bind a port. |

The static score is **honest, not artificially low** — it tells you
exactly how many readiness criteria you can verify when you can't boot
the server. If a CI job has to use `--no-spawn`, the scorecard:check gate
will compare against the static baseline, not the live one.

### Star ledger (history)

Each entry below records when a category last hit its third star.

| Category | Reached ★★★ at | What unlocked it |
| --- | --- | --- |
| Run visibility | MB1 | `/api/monitor/runs/:runId` per-run detail endpoint |
| Child visibility | MB2 | `PipelineExecutor.getSubagentSnapshot()` exposed via run detail |
| Replay visibility | MA6 + AA-2 | Pinned events survive ring eviction; `snapshot({runId, includeGlobal})` |
| Event integrity | MC4 | Bridge forward + run-sync verifications upgraded to behavior checks |
| Contract stability | MC4 | Layout panels-override checked by stub-panel behavior, not just type-check |
| Remote isolation | R1-i → R1-g | Default off + HKDF domain separation + (R1-g) **live agent → orchestrator round-trip** projecting remote child + chain verify |

## 4. How readiness checks run

`scripts/readiness-report.js` runs a one-shot check that produces:

```
$ node scripts/readiness-report.js
=== Harness Readiness Report ===
  run-visibility       ★★★  (3/3)
  child-visibility     ★★★  (3/3)
  replay-visibility    ★★★  (3/3)
    + pin survives ring eviction (behavior verified)
  event-integrity      ★★★  (3/3)
    + normalize() yields canonical envelope shape
    + bridge forwards live event into store (behavior verified)
    + bridge run sync upserts run on pipeline_start (behavior verified)
  contract-stability   ★★★  (3/3)
    + layout panels override invokes stub panel.create (behavior verified)
  remote-isolation     ★★★  (3/3)
    + HARNESS_REMOTE_MODE default = off (fail-closed, behavior verified)
    + HKDF JWT + ledger keys derive with domain separation (behavior verified)
    + live runner agent → orchestrator round-trip projects remote child + ledger chain verifies (behavior verified)
  ───────────────────────────────
  total                18/18  → release-ready
```

**Slice MC4 (Phase D Round 2.5)**: every star is now BEHAVIOR-verified — the
report instantiates real modules, drives them with test data, and asserts
the runtime outcome. Previously several stars passed simply because a
module export existed.

**Slice R1-i (Phase D R1)**: a sixth category, **remote-isolation**, joins
the rubric with three in-process behavior checks (default fail-closed,
HKDF domain separation, audit-chain HMAC round-trip). The cap rises from
15 to 18 stars and the gate thresholds re-scale proportionally.

**Slice R1-g (Phase D R1)**: Star 3 of remote-isolation upgrades from the
in-process audit-chain-only check to a LIVE end-to-end round-trip. The
new check spins up an in-process orchestrator + connects a RunnerAgent +
drives an `agent_started` frame, then asserts the remote child appears
in `childRegistry.snapshot()` with the right metadata AND the audit
chain still verifies. Catches a much wider regression surface: WS demux,
JWT verify, frame routing, child projection, ledger HMAC.

Exit codes (post-R1-i, with READINESS-BOOT-FAILURE-CONFIG):
- `0` — total ≥ 17 (release-ready)
- `1` — total ≥ 12 (preview-ready)
- `2` — total ≥ 7  (internal-only)
- `3` — total < 7  (blocking — do not ship)
- `4` — CONFIG: harness server boot failed (sandboxed shell, EPERM, EACCES, ENOENT, timeout, premature exit).

The `--json` flag produces machine-readable output for PR gates.

The `--no-spawn` flag skips the server boot. Use it when the runner
cannot bind a port — the resulting score (currently 9/18) only counts
the in-process behavior checks. CI runs in live mode by default.

The `--allow-static-fallback` flag restores the legacy silent-fallback
behavior: a spawn failure no longer exits 4 (CONFIG); it falls through
to static-only scoring as `--no-spawn` would. Use it only when you
deliberately accept that "I tried to boot but couldn't" should look
like "I never tried" in the auto-markers.

**Slice READINESS-BOOT-FAILURE-CONFIG (Phase 2 v2 follow-up,
2026-05-05)**: previously a spawn failure silently fell back to
static scoring (9/18) and exited 2 (internal-only), making
environment restrictions look like real regressions. The CONFIG-tier
exit (4) makes the distinction loud: an operator hitting it knows
the score did not regress — the environment cannot run the live
checks. `npm run scorecard:check` and `npm run scorecard:sync` both
propagate exit 4 instead of writing a half-signal into the markers.

## 5. Out of scope

- Per-category sub-rubrics (e.g. run-visibility-by-route). Adding those before they're needed bloats the report.
- A web UI for the rubric. Operators read the script output from the terminal.

## 6. Sources

- `docs/superpowers/specs/2026-04-27-five-priority-roadmap.md` (P5)
- `docs/superpowers/specs/2026-04-27-run-monitor-ui-hybrid-design.md` (Section 8)
- Plan file `swift-waddling-hanrahan.md` Part E (Phase D Round 2 MB5 spec)

## 7. Operator workflow — when to use this rubric

This rubric is consulted in three operator workflows. Each has a different entry point and a different action on the result.

### 7.1 Pre-deployment gate

Before tagging a release, run `npm run readiness:check`. The exit code is the action:

| Exit | Total | Action |
| --- | --- | --- |
| `0` | ≥ 17 / 18 | Proceed with the release. |
| `1` | ≥ 12 / 18 | Release as preview only — note in changelog "preview-quality, see readiness report". |
| `2` | ≥ 7  / 18 | Internal-only — do not advertise externally. |
| `3` | < 7  / 18 | Do not ship. Investigate which categories dropped before the next attempt. |
| `4` | n/a (CONFIG) | Environment cannot run the live checks (sandboxed shell, EPERM/EACCES/ENOENT, boot timeout, premature exit). NOT a regression — the score did not drop. Re-run from a normal terminal or CI runner. Use `--no-spawn` for intentional static-only scoring; `--allow-static-fallback` for the legacy silent-fallback behavior. |

The CI gate uses the same exit codes. A category at 0 stars is blocking regardless of total — `readiness:check` will not return 0 if any category is fully empty. Exit 4 (CONFIG) is *not* a release-blocking signal in itself — it means the environment is wrong, not the code; running from a normal terminal will produce the real signal.

### 7.2 Regression diagnostics

When a category drops between two consecutive `npm run scorecard:sync` runs, the auto-markers in §3 update and the diff in `docs/readiness-rubric.md` between versions tells you which category regressed. The protocol:

1. `git log -p docs/readiness-rubric.md` to see the markers' last change.
2. Read §2 narrative for the affected category to refresh on what each star measures.
3. Pair with `docs/external-review/claim-evidence-matrix.md` to identify which slice was the cause.
4. If the regression is real, file an internal investigation and revert (or fix-forward) before the next deployment gate.

### 7.3 Onboarding orientation

New committers reading this document first should follow the sections in order: §1 (why this exists) → §2 categories with star tables → §2 sub-rationales for the *why* of each star → §3 current readiness markers for live state. The narrative is what closes the gap between "I see a number" and "I know what changing the number costs". A reviewer who has read §1–§3 once should be able to evaluate any future PR's effect on readiness without re-reading.
