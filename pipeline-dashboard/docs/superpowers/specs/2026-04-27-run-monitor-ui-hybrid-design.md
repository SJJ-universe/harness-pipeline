# Run Monitor UI Hybrid Design

Date: 2026-04-27
Status: Draft approved for spec write-up
Scope: Monitoring-first UI redesign for the canonical harness dashboard at `pipeline-dashboard`

## 1. Why this exists

The dashboard already has the raw ingredients for monitoring:

- per-run state and replay export via `/api/runs/current`
- run scoping and replay filtering in the browser
- child-process lifecycle tracking via `childRegistry`
- subagent, critique, tool-feed, analytics, and terminal surfaces

What it does not yet have is a monitoring-first shell that turns those pieces into a coherent operating console. The current UI still centers the pipeline canvas and treats monitoring as attached panels. That limits extensibility, makes the main screen harder to scan during active runs, and keeps the frontend coupled to `public/app.js`.

This design shifts the dashboard toward a monitoring-first operating console while preserving the existing runtime, routes, and UMD-based frontend so the team can later migrate to a fuller rewrite without throwing away the new work.

## 2. Goals

Primary goal:

- Make the main dashboard best at monitoring active runs and agents.

Secondary goals:

- Improve extensibility without forcing an immediate frontend framework migration.
- Increase perceived responsiveness by separating hot-path UI updates from heavy panels.
- Reuse the current replay, analytics, and event-stream capabilities instead of replacing them.
- Prepare clear contracts for a future React-style or protocol-driven rewrite.

Non-goals for this round:

- No full visual rewrite for aesthetics alone.
- No framework/platform migration to LangGraph, CrewAI, Dify, or Microsoft Agent Framework.
- No replacement of the existing WebSocket event system.
- No remote/team execution feature work beyond contract preparation.

## 3. Design principles

1. Monitoring over orchestration
   The default landing experience should answer: what is running, what is stuck, what is risky, and what changed recently.

2. Hybrid now, rewrite-ready later
   New UI structure should sit on framework-independent state and event contracts so the future rewrite can swap rendering technology without redoing server semantics.

3. Progressive extraction
   Existing modules such as `run-tab-bar`, `analytics-panel`, `subagent-tray`, `run-history`, `ws-client`, and `api-client` should be reused through adapters before any replacement is considered.

4. Hot path vs cold path
   Fast-changing data such as status badges, counters, and live events should update cheaply. Heavy views such as analytics, replay, and long histories should remain on-demand.

5. Preserve current runtime guarantees
   Multi-run isolation, replay correctness, auth boundaries, and child shutdown behavior must remain unchanged.

## 4. Proposed user experience

The dashboard becomes a mixed monitoring console: high-level fleet view on the left and top, focused run analysis in the center, and drill-down inspection on the right and bottom.

### 4.1 Main layout

- Global bar
  Server health, Codex health, active run count, active child count, high-severity indicator, quick restart/stop controls.
- Left navigation rail
  Run Tree, Agent Tree, and replay/history entry points.
- Center workspace
  Selected run summary, pipeline graph, phase/gate summary, and tool/event timeline.
- Right inspector
  Contextual detail for the currently selected event, tool call, child process, finding, or subagent.
- Bottom dock
  Terminal, raw event log, replay, and debug tabs.

### 4.2 Default behaviors

- The dashboard opens into current active run focus when one exists.
- When multiple runs exist, the left rail becomes the primary run-switching affordance; the existing run tab bar can remain as a lightweight quick-switch strip during transition.
- Completed runs remain visible but visually dimmed until dismissed or archived.
- Replay and analytics stay available but move behind focused views rather than acting as separate modal-first workflows.

### 4.3 Information hierarchy

The UI should answer questions in this order:

1. Is the system healthy?
2. What runs are active, blocked, or failed?
3. Which run should I inspect?
4. What is happening inside that run right now?
5. What exactly happened at the selected event or tool call?

## 5. Frontend architecture

This round does not adopt a new frontend framework. It creates a framework-ready UI core under the current static/UMD delivery model.

### 5.1 New monitor layer

Add a new frontend layer under `public/js/monitor/`:

- `store.js`
  Canonical in-browser monitor state for runs, selected run, active panels, server summary, child summary, and recent normalized events.
- `normalizer.js`
  Converts current HTTP payloads and WebSocket events into a stable monitor event envelope.
- `layout.js`
  Mounts the monitor shell and coordinates panel rendering.
- `panels/run-tree.js`
  Left-rail run list and basic hierarchy.
- `panels/agent-tree.js`
  Subagent and child-process hierarchy for the selected run.
- `panels/run-summary.js`
  Center summary cards and phase/gate status.
- `panels/timeline.js`
  Tool/event timeline focused on recent activity.
- `panels/inspector.js`
  Right-side detail panel for the selected item.
- `panels/bottom-dock.js`
  Terminal, replay, raw log, and debug docking shell.

### 5.2 Reused existing modules

These modules remain valid and should be wrapped or integrated rather than replaced:

- `public/js/ws-client.js`
- `public/js/api-client.js`
- `public/js/event-dispatcher.js`
- `public/js/run-tab-bar.js`
- `public/js/run-history.js`
- `public/js/analytics-panel.js`
- `public/js/subagent-tray.js`

Each should be treated as a service or transitional panel, not as the future top-level state owner.

### 5.3 State ownership

- `monitor/store.js` becomes the only place that owns monitor-facing UI state.
- `public/app.js` becomes a compatibility shell that forwards incoming events into the monitor normalizer/store and still supports legacy panels during transition.
- Panel modules become consumers of store snapshots plus explicit callbacks, not hidden global state.

### 5.4 Performance model

Three update lanes are used:

- Hot lane
  Status pills, counts, run activity state, child count, and selected-run summary. These update immediately from incoming events.
- Warm lane
  Tool feed, event timeline, critique timeline, and subagent tree. These batch or append updates with lightweight rendering.
- Cold lane
  Analytics, replay, archived history, and heavy detail fetches. These load on demand.

### 5.5 Rewrite readiness

The monitor store and normalizer must be DOM-free and testable under Node. That is the main seam that later allows:

- React islands for selected panels
- full React migration
- AG-UI or other protocol-driven clients
- external observability consumers

## 6. Server contract

The server side should evolve conservatively. Existing routes stay valid; new monitor-oriented read APIs are additive.

### 6.1 Preserve current contracts

Keep:

- `GET /api/runs/current`
- `GET /api/server/info`
- current event WebSocket stream

These remain compatibility surfaces for the current UI and tests.

### 6.2 Add monitor bootstrap contract

Add:

- `GET /api/monitor/bootstrap`

Purpose:

- provide the first screenful of monitoring data without stitching multiple requests client-side

Suggested payload:

- server summary
- active run list
- selected/default run summary
- active child snapshot
- global counters
- feature flags relevant to monitor behavior

### 6.3 Add run-focused detail contract

Add:

- `GET /api/monitor/runs/:runId`

Purpose:

- load selected-run detail without overloading bootstrap payloads

Suggested payload:

- run snapshot
- recent normalized event window
- findings summary
- subagent summary
- child-process summary
- replay/export metadata

### 6.4 Extend server info for operations

Extend `GET /api/server/info` with child observability:

- active child count
- child summaries by run or type
- shutdown state
- recent lifecycle timestamp

This makes the S3-a lifecycle work visible at the operations layer.

### 6.5 Canonical monitor event envelope

The client should normalize all event sources into:

- `type`
- `runId`
- `ts`
- `scope`
- `summary`
- `payload`

The server does not need to emit this shape natively in the first round. Client-side normalization is sufficient for transition.

## 7. UI rollout plan

### UI-0 Foundation

- document monitor event envelope
- add monitor store
- add event normalizer
- add bootstrap route design
- define mounting boundaries in `index.html`

Outcome:

- the current UI can coexist with the new monitor shell

### UI-1 Monitor Shell

- add global bar summary
- add left run tree
- add center selected-run workspace
- add right inspector shell
- add bottom dock shell

Outcome:

- mixed monitoring console exists without deleting the legacy modules

### UI-2 Observability Upgrade

- show childRegistry data
- show subagent hierarchy
- improve tool/event timeline
- add filtering, pinning, and focus behavior

Outcome:

- the dashboard becomes operationally useful for long or parallel runs

### UI-3 Rewrite Readiness

- narrow `public/app.js` responsibilities
- move panel ownership out of legacy globals
- keep DOM-free store/normalizer under test
- optionally pilot a React island for one panel only after contracts settle

Outcome:

- the app is ready for later staged rewrite without redoing backend contracts

## 8. Testing expectations

This UI work should be validated as architecture work, not just screenshot work.

Required test categories:

- unit tests for monitor store transitions
- unit tests for event normalization
- unit tests for panel pure render helpers where feasible
- integration tests for bootstrap and run detail routes
- integration tests for run selection and cross-run isolation in the monitor shell
- regression coverage for existing replay, auth, and child shutdown behavior

Important rule:

- no UI refactor is allowed to weaken existing guarantees around run scoping, replay filtering, token gating, or child lifecycle cleanup

## 9. Risks and mitigations

- Risk: `public/app.js` remains too central for too long
  Mitigation: explicitly route all new state ownership into `monitor/store.js`

- Risk: duplicated UI state between legacy modules and monitor shell
  Mitigation: choose one owner per concern and use adapters for the rest

- Risk: payload bloat in bootstrap endpoints
  Mitigation: keep bootstrap summary-only; fetch deep details on selection

- Risk: overcommitting to React too early
  Mitigation: keep the first-generation monitor core framework-free

- Risk: monitor UI regresses low-latency feel under event bursts
  Mitigation: enforce hot/warm/cold update lanes and avoid full-tree rerender patterns

## 10. How this prepares the next five planning priorities

This UI spec is intentionally the front door to the next planning wave.

### 10.1 Repo-local docs as system of record

This spec should become one of the canonical repo docs and drive updates to:

- `docs/harness-architecture.md`
- `docs/scorecard.md`
- a future UI/monitor architecture doc

### 10.2 Internal trace schema

The monitor event envelope and store model provide the seed for a trace schema that can later feed:

- internal observability
- export to Langfuse/OpenLIT-class tooling
- future remote execution traces

### 10.3 Agent Tree / Run Tree UI

That work becomes the first implementation slice rather than a separate design exercise. This spec already defines its role and screen position.

### 10.4 Remote sandbox RFC

The monitor contracts should reserve room for run origin, isolation class, and remote/container metadata so future remote mode does not force UI contract churn.

### 10.5 Harness readiness / eval bundle

Once the monitor shell exists, readiness checks can explicitly score:

- run visibility
- child visibility
- replay visibility
- event integrity
- operational server summary quality

## 11. Recommended next step after spec approval

After this spec is reviewed, the next artifact should be an implementation plan that starts with:

1. UI-0 Foundation
2. Agent Tree / Run Tree slice inside UI-1
3. server-side monitor bootstrap/read contracts

That sequence preserves current behavior while giving the next planning wave a stable base.
