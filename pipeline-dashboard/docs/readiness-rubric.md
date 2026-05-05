# Harness Readiness Rubric

Date: 2026-04-27
Status: Initial draft (Slice MB5 of Phase D Round 2)
Parent spec: `docs/superpowers/specs/2026-04-27-five-priority-roadmap.md` (P5)

## 1. Why this exists

The harness has strong unit + integration coverage (<!-- AUTO:test-counts -->**3489 unit / 553 integration**<!-- /AUTO -->) — but unit coverage tells you "the code does what it says". It does NOT tell you whether the system is OPERATIONALLY usable for the next wave. This rubric defines that operational view.

_(test-count line above auto-derived by `npm run scorecard:sync`; do not hand-edit between markers.)_

A passing test count is necessary; a passing readiness check is what tells the team "we are ready to ship Phase D Round 2 / start Phase 3 design / cut a release".

## 2. The six readiness categories

Each category has 0..3 stars. Total 18 stars across the rubric. A category at 0 stars means **blocking** — the release can't go out. 1 star is acceptable for an internal preview. 2+ stars is required for an external release.

> Slice R1-i (Phase D R1, 2026-04-28) added the **remote-isolation** category, lifting the cap from 15 to 18 stars and re-scaling the gate thresholds proportionally.

### 2.1 Run visibility

**Question**: Can an operator answer "what is running right now and what's it doing?" in under 5 seconds?

| Stars | Criterion |
| --- | --- |
| ★ | `/api/server/info` and `/api/monitor/bootstrap` both respond 200 with a usable shape. |
| ★★ | The monitor shell (opt-in) renders the run-tree + run-summary panels with live data within 1s of the user opting in. |
| ★★★ | `/api/monitor/runs/:runId` returns run detail (events / children / subagents / findings) for every run in the orchestrator's list. |

### 2.2 Child visibility

**Question**: If the harness spawns 3 children (Codex + Claude + subagent), can an operator see all three from the dashboard?

| Stars | Criterion |
| --- | --- |
| ★ | `childRegistry.snapshot()` is exposed via `/api/server/info.activeChildren`. |
| ★★ | The agent-tree panel renders one row per active child grouped by runId. |
| ★★★ | The agent-tree panel ALSO renders active subagents (server-authoritative snapshot, MB2). Long-running subagents survive event-ring eviction. |

### 2.3 Replay visibility

**Question**: If a client reconnects mid-run, can it reproduce the recent timeline accurately?

| Stars | Criterion |
| --- | --- |
| ★ | `eventReplayBuffer` exposes a 500-event ring with `snapshot({runId, includeGlobal})` filter. |
| ★★ | WS reconnect → client receives `pipeline_replay` with the correct run-scoped events (Phase 2.5 AA-2). |
| ★★★ | Pinned events (MA6) survive ring eviction in the monitor store; the timeline still surfaces them after 200+ events have flowed past. |

### 2.4 Event integrity

**Question**: When the legacy WS stream and the monitor store both observe the same event, are they consistent?

| Stars | Criterion |
| --- | --- |
| ★ | All MA1 envelope fields (type / runId / ts / scope / summary / payload) are emitted for every normalised event. |
| ★★ | The monitor legacy-bridge (MB4-a) forwards every event into the monitor store via the dispatcher tap. Stats expose `eventsForwarded` and `eventsDropped`. |
| ★★★ | A timeline filter chip toggle (MA6) drops the matching events from the monitor view but the bottom-dock raw log still shows them — the bridge stayed authoritative. |

### 2.5 Contract stability

**Question**: Can a future panel be added without changing the server contract?

| Stars | Criterion |
| --- | --- |
| ★ | `/api/monitor/bootstrap` and `/api/monitor/runs/:runId` shapes are documented + locked by integration tests. |
| ★★ | The legacy `/api/server/info` and `/api/runs/current` shapes are unchanged from before Phase D — additive contracts only (MB1 was additive). |
| ★★★ | A new monitor panel can be added by registering a `panels.X` override in `HarnessMonitorLayout.mount` without modifying any other module. |

### 2.6 Remote isolation

**Question**: When the operator opts into the remote-runner subsystem, does the trust boundary actually hold?

| Stars | Criterion |
| --- | --- |
| ★ | `HARNESS_REMOTE_MODE` defaults to `"off"` (workspace-boundary closed). `setupRemoteRunner({ env: {} })` returns `mode="off"`, `runnerRegistry=null`, both keys `null`; `createRunnerRoutes(mode="off")` 404s every route. |
| ★★ | Token model with HKDF domain separation. The JWT signing key (`info="runner-jwt"`) and the audit-ledger signing key (`info="audit-ledger"`) derive from the same `HARNESS_TOKEN` IKM but produce two independent 32-byte keys. Compromising one must not compromise the other. |
| ★★★ | **Live end-to-end round-trip** (R1-g upgrade). An in-process orchestrator + RunnerAgent: handshake → WS hello → `agent_started` frame → orchestrator's `childRegistry` shows the remote child with the right `runId` + `hostIdentity` + `remote:true` flag, AND the audit chain still verifies under HMAC. Subsumes the previous "audit chain only" check — a regression in path-aware demux, JWT verify, WS frame routing, child projection, OR ledger signing makes this star drop. |

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

Exit codes (post-R1-i):
- `0` — total ≥ 17 (release-ready)
- `1` — total ≥ 12 (preview-ready)
- `2` — total ≥ 7  (internal-only)
- `3` — total < 7  (blocking — do not ship)

The `--json` flag produces machine-readable output for PR gates.

The `--no-spawn` flag skips the server boot. Use it when the runner
cannot bind a port — the resulting score (currently 9/18) only counts
the in-process behavior checks. CI runs in live mode by default.

## 5. Out of scope

- Per-category sub-rubrics (e.g. run-visibility-by-route). Adding those before they're needed bloats the report.
- A web UI for the rubric. Operators read the script output from the terminal.

## 6. Sources

- `docs/superpowers/specs/2026-04-27-five-priority-roadmap.md` (P5)
- `docs/superpowers/specs/2026-04-27-run-monitor-ui-hybrid-design.md` (Section 8)
- Plan file `swift-waddling-hanrahan.md` Part E (Phase D Round 2 MB5 spec)
