# Harness Readiness Rubric

Date: 2026-04-27
Status: Initial draft (Slice MB5 of Phase D Round 2)
Parent spec: `docs/superpowers/specs/2026-04-27-five-priority-roadmap.md` (P5)

## 1. Why this exists

The harness has strong unit + integration coverage (878 unit / 186 integration as of MB4-d) — but unit coverage tells you "the code does what it says". It does NOT tell you whether the system is OPERATIONALLY usable for the next wave. This rubric defines that operational view.

A passing test count is necessary; a passing readiness check is what tells the team "we are ready to ship Phase D Round 2 / start Phase 3 design / cut a release".

## 2. The five readiness categories

Each category has 0..3 stars. Total 15 stars across the rubric. A category at 0 stars means **blocking** — the release can't go out. 1 star is acceptable for an internal preview. 2+ stars is required for an external release.

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

## 3. Current readiness (as of MB4-d)

| Category | Stars | Justification |
| --- | :---: | --- |
| Run visibility | ★★★ | All three criteria green. MB1 lit up the third star. |
| Child visibility | ★★★ | MA6 + MB2 lit up the third star (server-authoritative subagent snapshot). |
| Replay visibility | ★★★ | MA6 pinned events + AA-2 includeGlobal policy = all green. |
| Event integrity | ★★ | First two stars green; the third needs MB5's flow test to verify the bridge behaviour under filter pressure. |
| Contract stability | ★★ | First two stars green; the third star ("new panel via override only") is **proven by the existing layout tests**, but no regression test specifically locks it. |

**Total: 13 / 15** stars. A 12+ score means "ready for external preview"; 14+ for a release tag.

## 4. How readiness checks run

`scripts/readiness-report.js` runs a one-shot check that produces:

```
$ node scripts/readiness-report.js
=== Harness Readiness Report ===
  run-visibility       ★★★  (3/3)
  child-visibility     ★★★  (3/3)
  replay-visibility    ★★★  (3/3)
  event-integrity      ★★    (2/3)  ← gap: bridge filter assertion not in CI yet
  contract-stability   ★★    (2/3)
  ───────────────────────────────
  total                13/15  → ready for external preview
```

Exit codes:
- `0` — total ≥ 14 (release-ready)
- `1` — total ≥ 10 (preview-ready)
- `2` — total ≥ 6  (internal-only)
- `3` — total < 6  (blocking — do not ship)

The `--json` flag produces machine-readable output for PR gates.

## 5. Out of scope

- Per-category sub-rubrics (e.g. run-visibility-by-route). Adding those before they're needed bloats the report.
- Auto-failing tests on readiness regressions. P5 plan ships that as a follow-up — for now, the rubric is informational.
- A web UI for the rubric. Operators read the script output from the terminal.

## 6. Sources

- `docs/superpowers/specs/2026-04-27-five-priority-roadmap.md` (P5)
- `docs/superpowers/specs/2026-04-27-run-monitor-ui-hybrid-design.md` (Section 8)
- Plan file `swift-waddling-hanrahan.md` Part E (Phase D Round 2 MB5 spec)
