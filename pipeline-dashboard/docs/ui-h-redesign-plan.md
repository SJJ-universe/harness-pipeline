# UI-H Hybrid Redesign Plan

**SJ Orchestrator Dashboard mockup integration — design extraction +
shell-mode foundation + Orchestrator Track + Dual Agent Console +
Claude↔Codex review relay + public-sector integration + Simple
dashboard polish**

> Status: **UI-H plan — design only**. Execution starts tomorrow
> (post 2026-04-29 GOV-APPROVAL-0 closeout).
> Source: `C:\Users\SJ\Downloads\web page\UI Plan.txt` (operator
> directive) + `sj-orchestrator-dashboard/` mockup
> (React/Babel reference, NOT the production stack).
> Cross-refs:
> - [Plan file Part O (Phase E)](../../../.claude/plans/swift-waddling-hanrahan.md)
>   for the broader Phase E productization context.
> - [GOV-APPROVAL-0 + UX-2 closeout commit `a6e1d84`](https://github.com/SJJ-universe/orchestrator-pipeline)
>   for the approval flow this plan integrates.
> - [Scorecard](./scorecard.md) for the rubric the plan moves.

The UI-H round captures the qualitative shift from "monitor shell
overlays the legacy app" to "monitor shell IS the operator
workspace, with simple/advanced/legacy modes". The mockup at
`Downloads/web page/sj-orchestrator-dashboard/` is reference-only — we
adopt design tokens + UX patterns, NOT the React/Babel/CDN/Google-
Fonts stack the mockup uses for rapid prototyping.

The seven sub-rounds (UI-H0 → UI-H6) are sized so the highest-risk
surface — opening a Claude↔Codex review relay backend — sequences
after the shell foundation and the dual-console UI are stable.
Public-sector integration lands second-to-last so all defenses
(GOV-SB-0 / GOV-PII-0/1 / GOV-APPROVAL-0) can be cross-wired into
the new shell at once.

---

## 0. Scope, non-goals, prerequisites

### 0.1. Scope

**In scope** (UI-H0 ~ UI-H6, sequencing committed):

1. Extract design tokens from the mockup (color / typography /
   spacing / motion) into a single CSS file consumable by the
   existing UMD panels.
2. Foundation for **simple / advanced / legacy** shell modes,
   selected via URL `?mode=` → localStorage → env default →
   `simple` fallback.
3. **Orchestrator Track** panel — the running-horse animation tied
   to ACTUAL run state (no fake progress; unknown → "대기 중").
4. **Dual Agent Console** — Claude on the left, Codex on the
   right, structured-action input below. **Read-only stream
   panels first**; the actual input flows through a structured
   API (see UI-H4).
5. **Claude → Codex → Claude review relay backend** — the
   defining feature: an operator can ask Codex to critique a
   Claude plan, follow up with their own questions, and hand
   the verified plan back to Claude. Server contract +
   WebSocket events.
6. **Public-sector integration** — reduced motion + policy-gate
   timeline + sandbox stream + PII scan results all surfaced in
   the new shell. Bash/Edit/Write hooks routed through the
   existing R3-e + GOV-APPROVAL-0 approval card.
7. **Simple dashboard polish** — first-run UX + 4 cards + onboarding
   copy.

**Round-end exit criterion**: an operator opening
`?monitor=1&mode=simple` (or just `?mode=simple` after default
flips) sees the operator-friendly view and can drive a Claude →
Codex → Claude review cycle without leaving the page. Operators
opting into `?mode=advanced` see the full pipeline rail + dual
console + monitor cards.

### 0.2. Non-goals (intentional carve-outs)

Per UI Plan.txt §"채택하지 않을 것":

- **No CDN React/Babel** — the mockup uses
  `unpkg.com/react@18.3.1` + `babel.min.js`. Production already
  has a UMD-pattern panel architecture (`store.js`, `layout.js`,
  `monitor/panels/*.js`); this round preserves it. The mockup
  is reference for STYLES + UX patterns only.
- **No Google Fonts** — the mockup imports Pretendard / JetBrains
  Mono / Fraunces from `fonts.googleapis.com`. We use a self-
  hosted system-font stack:
    - body: `system-ui, -apple-system, "Segoe UI", "Apple SD Gothic Neo", sans-serif`
    - mono: `ui-monospace, "Cascadia Code", "Consolas", monospace`
    - serif accents (where needed): `Georgia, "Apple SD Gothic Neo", serif`
  Operators self-host Pretendard if they want it (not bundled).
- **No hardcoded logs / tokens / state** — the mockup contains
  static `CLAUDE_LINES` / `CODEX_LINES` / `findings` arrays. Every
  UI element in the production round MUST read from the store
  (or unknown → placeholder).
- **No Tweaks panel** — designer-only, not operator workflow.
- **No token usage card** — UI Plan §"채택하지 않을 것" + matches
  Phase E philosophy (operator's API key = operator's billing).
- **No local Bash terminal in public-sector mode** — security
  policy. Sandbox stream only.
- **No real PTY connections in the Dual Agent Console** — the
  console is a READ-ONLY stream view; operator input flows through
  the review-relay backend (UI-H4) as structured API actions, NOT
  raw stdin. This prevents the dual console from becoming a
  policy-bypass surface.

Per Phase E architecture invariants:

- **No new external dependencies** — the round adds no `npm i ...`.
  Every panel ships as a UMD-pattern external script + CSS.
- **No CSP relaxation** — every new panel mounts as
  `<script src="...">`, not inline. nonce stays for the existing
  legacy app.js.
- **No public-sector defense weakening** — every existing GOV
  layer (sandbox / inline PII / file-content PII / approval gate)
  remains active. UI changes surface posture; they don't change it.

### 0.3. Prerequisites

- ✅ R3-e + GOV-APPROVAL-0 + UX-2-a/b/c shipped (commit `a6e1d84`,
  scorecard 111/119).
- ✅ Existing monitor shell: store + normalizer + dispatcher +
  legacy-bridge + 9 panels (global-bar / run-tree / run-summary /
  agent-tree / inspector / timeline / bottom-dock / settings-
  accounts / approval-card).
- ✅ horse-animation.js (legacy app.js companion) — UI-H2 lifts
  the running-horse semantics into the monitor shell.
- ✅ ORCHESTRATOR_DEPLOYMENT_PROFILE env + publicSectorPolicy module —
  UI-H5 reads posture flags to swap to reduced-motion / policy-
  gate-timeline visuals.
- ✅ /api/server/info AccountStatus block (D3-a) — UI-H3 reads
  Claude/Codex CLI readiness from here.
- ✅ approval-card panel mounted between global-bar + shell-body
  — UI-H5 wires Bash/Edit/Write hooks through it.

---

## 1. Sub-rounds

| Sub-round | Topic | Risk | Closes |
|---|---|:---:|---|
| **UI-H0** | Design token extraction + asset preparation | low | foundational |
| **UI-H1** | Shell mode foundation (simple/advanced/legacy) | low | UI Plan §UX-H1 |
| **UI-H2** | Orchestrator Track panel (real run state binding) | medium | UI Plan §UX-H2 |
| **UI-H3** | Dual Agent Console (read-only stream) | medium | UI Plan §UX-H3 |
| **UI-H4** | Review relay backend (WS + HTTP) | high | UI Plan §UX-H4 (the defining feature) |
| **UI-H5** | Public-sector integration | medium | UI Plan §UX-H5 |
| **UI-H6** | Simple dashboard polish | low | UI Plan §UX-H6 |

Sequencing: UI-H4 follows UI-H3 because the structured-action
console depends on a stable read-only viewer. UI-H5 follows UI-H4
because public-sector posture must apply uniformly across the
review-relay flow (no policy bypass through the relay).

---

## 2. Sub-round detail

### 2.1. UI-H0 — Design extraction

**Goal**: extract design tokens from the mockup into a single CSS
file (`public/css/orchestrator-shell.css`) the existing panels can
consume without breaking their current styles.

**Work**:

- New `public/css/orchestrator-shell.css` — CSS custom properties for:
  - color: `--bg-base: #08090B`, `--bg-card: #101115`,
    `--bronze: #C9A66B` (primary accent), `--codex-blue: #7FA9CB`,
    `--green-pass: #9BD8A6`, `--red-danger: #E55B5B`,
    `--orange: #E89B4B`, `--yellow: #D9C24A`, `--text: #E8E6E1`,
    `--text-dim: rgba(232,230,225,0.55)`,
    `--border: rgba(255,255,255,0.06)`.
  - typography: `--font-body`, `--font-mono`, `--font-serif`
    (system-font stack — see §0.2).
  - density: `--radius: 3px`, `--radius-pill: 999px`,
    `--space-1: 4px`, `--space-2: 8px`, `--space-3: 12px`,
    `--space-4: 16px`.
  - motion: `--anim-pulse: hpulse 1.4s ease-in-out infinite`,
    `--anim-slide: hslide 1.6s ease-in-out infinite`,
    `--anim-caret: caretBlink 1s steps(1) infinite`.
- Extend existing `public/style.monitor.css` to consume the
  tokens (no breaking changes — every existing class keeps its
  color/density verbatim, just sourced from the variables).
- New `docs/ui-dashboard-design-notes.md` — a brief operator-
  facing doc that explains: token vocabulary, light/dark theme
  policy (dark only for now), reduced-motion contract, public-
  sector visual policy (UI-H5 enforces).

**Files**:
- New: `public/css/orchestrator-shell.css` (≤300 lines)
- New: `docs/ui-dashboard-design-notes.md` (≤150 lines)
- Modify: `public/index.html` (add `<link rel="stylesheet"
  href="css/orchestrator-shell.css">` BEFORE style.monitor.css so
  variables are defined first)
- Modify: `public/style.monitor.css` (replace hardcoded color
  hex with `var(--*)` references; behavior preserved).

**Tests**:
- New: `tests/integration/css-tokens-present.test.js` — JSDOM-
  free check that the production CSS file declares every token
  the panels consume. Catches regressions where someone removes
  a `--bronze` reference and a panel renders with default color.
- Existing CSP nonce + monitor-shell tests must stay green.

**DoD**:
- `public/css/orchestrator-shell.css` exists + every token defined.
- Existing panels render with same visual output (no regression).
- design-notes.md describes the policy contract for UI-H5
  (reduced-motion + public-sector visual mode).
- 0 new external dependencies. 0 new CDN includes. CSP enforce
  test stays green.

**Score impact**: 0 (foundational; extends UI feedback loop cap
implicitly via subsequent rounds).

---

### 2.2. UI-H1 — Shell mode foundation

**Goal**: introduce `simple | advanced | legacy` mode selection
into the monitor shell without breaking existing `?monitor=1`
URL.

**Work**:

- New `public/js/monitor/mode.js` — single-source-of-truth for
  mode resolution. Priority: URL `?mode=` > localStorage
  `orchestrator.monitor.mode` > env default (`ORCHESTRATOR_MONITOR_MODE`
  read at boot via `/api/server/info`) > `simple`.
- New layout switch in `public/js/monitor/layout.js`:
  - `mode === "simple"` → mount only the new Simple shell
    (UI-H6 fills out the cards; UI-H1 builds the skeleton)
  - `mode === "advanced"` → mount the existing 9 panels
    (current behavior)
  - `mode === "legacy"` → bypass the monitor shell entirely;
    the legacy `app.js` view is shown unmodified
- New `public/js/monitor/panels/mode-toggle.js` — a thin pill
  button group in the global-bar that lets the operator switch
  modes without touching the URL. Three buttons: 일반사용자
  (Simple) / 전문사용자 (Advanced) / 레거시 (Legacy). Click
  writes to localStorage + reloads the page (mode change is
  destructive of the current panel mount; reload is the simplest
  correctness story).

**Files**:
- New: `public/js/monitor/mode.js` (≤120 lines)
- New: `public/js/monitor/panels/mode-toggle.js` (≤180 lines)
- Modify: `public/js/monitor/layout.js` — branch on mode at
  layout.mount entry; mode-aware panel mount.
- Modify: `public/index.html` — script tag for mode-toggle.js
  before layout.js.
- Modify: `src/routes/serverControlRoutes.js` — extend
  `accountStatus` block with `mode.envDefault` (read from
  `process.env.ORCHESTRATOR_MONITOR_MODE`; defaults to `"simple"`).

**Tests**:
- New: `tests/unit/monitor.mode.test.js` — resolveMode priority
  (URL > localStorage > envDefault > "simple"); validation
  rejects garbage modes; ignored mode falls back to default.
- New: `tests/unit/monitor.mode-toggle.test.js` — mode-toggle
  panel renders 3 buttons; click sets localStorage + reloads
  (assert reload was called via stub).
- Modify: `tests/unit/monitor.layout.test.js` — layout
  branching: `mode: "simple"` mounts only the simple shell;
  `mode: "advanced"` mounts the existing panels; `mode: "legacy"`
  exits early with an unmodified DOM.
- Modify: `tests/integration/monitor-shell-html.test.js` —
  asserts the new `<link rel="stylesheet" href="css/orchestrator-shell.css">`
  + ensures the mode-toggle script tag is loaded.

**DoD**:
- `?mode=simple` shows the placeholder simple shell (UI-H6 fills
  it later).
- `?mode=advanced` is identical to today's `?monitor=1`.
- `?mode=legacy` shows today's pre-monitor app.js view, unmodified.
- Mode-toggle pill in global-bar persists choice via localStorage.
- 0 regressions in existing monitor tests.

**Score impact**: +0.5 (UI feedback loop — mode infrastructure
opens the door to operator-tier UX. Cap shift deferred to UI-H6
when Simple cards actually work).

---

### 2.3. UI-H2 — Orchestrator Track panel

**Goal**: replace the legacy `horse-animation.js` static animation
with an operator-meaningful "horse running through pipeline gates"
visual tied to ACTUAL run state. Per UI Plan §"가져올 요소
§Orchestrator Track Animation":

> 매핑:
>   Plan: Claude 계획 생성
>   Critique: Codex 비평
>   Revise: Claude 수정
>   Approval: 사용자 승인 대기
>   Execute: 실행
>   Verify: 테스트/검증
>   Done: 산출물 봉인

**Work**:

- New `public/js/monitor/panels/orchestrator-track.js` — UMD panel
  that mounts a horizontal lane strip with 7 stages mapped to
  pipeline phases. Reads:
  - `snapshot.runs[selectedRunId].phase` → current lane index
  - `snapshot.pendingApprovals.length > 0` → "approval pending"
    state (horse rears at the Approval gate)
  - `snapshot.runDetails[selectedRunId].verifyStatus` (from
    runDetails endpoint) → "verify gate" pass/fail badge
  - `snapshot.accountStatus.deployment.publicSector` → reduced-
    motion + policy-gate-timeline visual (UI-H5 hardens).
- The horse moves between lanes only when the store says so.
  Unknown phase → "대기 중" placeholder. NEVER fakes progress.
- Track replaces the legacy app.js horse for the monitor shell
  (the legacy view keeps its current horse).

**Files**:
- New: `public/js/monitor/panels/orchestrator-track.js` (≤350 lines)
- New: `public/js/monitor/horse-state-machine.js` (≤200 lines)
  — pure state machine that takes `(phase, approvalPending,
  verifyResult) → {laneIdx, displayState}` where displayState
  is `"running" | "rearing" | "idle"`.
- Modify: `public/js/monitor/layout.js` — mount orchestrator-track
  in advanced mode below global-bar (replacing the gap where
  approval-card-region sits; or adjacent to it).
- Modify: `public/style.monitor.css` — `.orchestrator-track-region`,
  `.ht-lane`, `.ht-horse`, `.ht-rearing-callout` styles.
- Existing horse-frames.png (`Downloads/web page/sj-orchestrator-dashboard/
  dashboard/horse-frames.png`, 12-frame sprite) — copy into
  `public/images/horse-frames.png` if not already present.

**Tests**:
- New: `tests/unit/monitor.horse-state-machine.test.js` —
  transition pinning: every (phase, approvalPending, verify)
  combo → expected (laneIdx, displayState). 30+ cases.
- New: `tests/unit/monitor.orchestrator-track.test.js` — DOM stub
  test: orchestrator-track renders 7 lanes; selectedRun phase
  updates the active lane class; approval-pending makes the
  horse "rear" at the Approval lane; reduced-motion mode
  freezes the animation.

**DoD**:
- Operator on advanced mode sees the running-horse animation
  reflecting the actual run's pipeline phase.
- Approval-pending state visually distinguishes (horse rears).
- Reduced-motion (public-sector or `prefers-reduced-motion`)
  freezes the animation but still shows the lane progress
  via static markers.
- 0 fake progress: store has no run → "대기 중" placeholder.

**Score impact**: 0 (within UI cap that UI-H1 opened; UI-H6
captures the cap movement).

---

### 2.4. UI-H3 — Dual Agent Console

**Goal**: a left-side Claude stream + right-side Codex stream
console panel. **Read-only first**. Operator input flows through
UI-H4's review relay (NOT raw stdin).

**Work**:

- New `public/js/monitor/panels/dual-agent-console.js` — UMD
  panel split into Left (Claude) + Right (Codex) terminal-
  styled views. Each reads:
  - Left: `snapshot.events` filtered to `scope === "claude"`
    or `payload.runner === "claude"`
  - Right: `snapshot.events` filtered to `scope === "codex"`
    or `payload.runner === "codex"`
  - Tabs (per UI Plan §UX-H3): Claude / Codex / Verifier / Audit.
    Verifier = filter `scope === "verify"`. Audit = filter
    `scope === "audit"` (audit chain entries from D1-f sanitizer).
- The console looks like a terminal but is NOT a PTY. There's
  no input row — UI-H4 adds the structured action input below.
- Auto-scroll behavior matches the bottom-dock raw-log pattern
  (sticky-bottom unless operator scrolls up).
- Public-sector visual mode: hide tab labels for runners that
  shouldn't be visible (e.g., if the public-sector profile
  forbids certain runners — TBD; first cut shows all tabs).

**Files**:
- New: `public/js/monitor/panels/dual-agent-console.js` (~400 lines)
- New: `public/js/monitor/event-filters.js` (~150 lines) — pure
  helper functions: `filterEventsByScope(events, scope)` and
  `filterEventsByRunner(events, runner)`. Lets UI-H3 + the
  bottom-dock raw-log share the filter logic.
- Modify: `public/style.monitor.css` — `.dual-console`,
  `.dual-console__panel`, `.dual-console__tabs`,
  `.dual-console__line`, `.dual-console__caret` styles.
- Modify: `public/js/monitor/layout.js` — mount dual-agent-console
  in advanced mode (below the orchestrator-track + center workspace,
  or in the bottom-dock as a new tab).

**Tests**:
- New: `tests/unit/monitor.event-filters.test.js` — every filter
  helper with 10+ cases each.
- New: `tests/unit/monitor.dual-agent-console.test.js` — tab
  switching, line rendering, auto-scroll, empty state.

**DoD**:
- Advanced mode shows the dual console below orchestrator-track.
- Claude / Codex streams render lines correctly when events
  arrive.
- Tab switching preserves auto-scroll state per tab.
- 0 PTY connections, 0 stdin, 0 raw shell access.
- Operator can read both streams but cannot inject input
  (UI-H4 adds the structured input row).

**Score impact**: 0 (UI cap movement on UI-H6).

---

### 2.5. UI-H4 — Review relay backend

**Goal**: the defining feature. Per UI Plan §UX-H4:

> 흐름:
>   Claude가 계획/수정안을 생성
>   사용자가 Codex에 비평 요청
>   Codex 콘솔에 비평 결과 표시
>   사용자가 추가 질문 입력 가능
>   사용자가 Claude에 반영 요청
>   Claude 콘솔에 수정 요청이 전달됨
>   필요하면 approval gate를 거쳐 실행

**Server contract**:

```
POST   /api/review-sessions
Body:  { initialPlan?, source?: "selected_run" | "manual" }
Resp:  { sessionId, createdAt }

POST   /api/review-sessions/:id/send-codex
Body:  { instruction: string, contextEvents?: string[] }
Resp:  { ok: true, dispatchedAt }
       (Codex spawn happens here, with profileSpawn + envFilter +
        public-sector posture all wired the same as a normal Codex run)

POST   /api/review-sessions/:id/follow-up
Body:  { question: string, target: "codex" | "claude" }
Resp:  { ok: true, dispatchedAt }

POST   /api/review-sessions/:id/hand-back-claude
Body:  { instruction: string, includeCritique?: boolean }
Resp:  { ok: true, dispatchedAt }
       (Claude spawn happens here. Bash/Edit/Write tools in the
        Claude response trigger the existing approval-card flow.)

GET    /api/review-sessions/:id
Resp:  { session: {sessionId, history: [...], state, createdAt} }

GET    /api/review-sessions
Resp:  { sessions: [...] }   // for UI list, not yet exposed in shell
```

**WebSocket events** (broadcast via the manager's broadcastFn
pattern from R3-e-b):

```
review_session_created       — { sessionId, source, createdAt }
claude_stream_chunk          — { sessionId, runId, chunk }
codex_stream_chunk           — { sessionId, runId, chunk }
critique_received            — { sessionId, summary, severityCounts }
handoff_to_claude_requested  — { sessionId, instruction, includeCritique }
handoff_to_claude_completed  — { sessionId, claudeRunId }
review_session_archived      — { sessionId, archivedAt, reason }
```

**Work**:

- New `src/runtime/reviewSessionManager.js` — in-memory state
  machine (mirrors approvalManager pattern from R3-e-b). Methods:
  `create({initialPlan, source})`, `sendCodex(id, instruction)`,
  `followUp(id, question, target)`, `handBackClaude(id, instruction)`,
  `get(id)`, `list()`, `archive(id, reason)`. Each method emits
  the corresponding audit verb + WS broadcast.
- New `src/routes/reviewSessionRoutes.js` — 5 HTTP endpoints
  matching the contract above. Token-gated (state-changing
  endpoints), public-sector aware (forbids local Bash even
  for follow-up questions; operator must use sandbox runner).
- Modify `executor/codex-runner.js` — accept a `reviewSessionId`
  hint that, when present, routes spawn output via WS event
  `codex_stream_chunk` instead of the generic `tool_recorded`.
  Reuses the same profileSpawn + envFilter + assertLocalExecutorAllowed
  guards.
- Modify `executor/claude-runner.js` — same hint mechanism
  (`reviewSessionId`), but the Claude spawn that lands write
  tools (Bash/Edit/Write) routes them through the existing
  `approvalManager.request` path with `source: "review_session"`
  prefix on the audit row.

**UI**:
- New `public/js/monitor/panels/review-relay.js` — replaces the
  read-only dual-console with input action rows:
  - "Codex에 비평 요청" button → POST /api/review-sessions/.../send-codex
  - Free-text input + "추가 질문" button → POST .../follow-up
  - "Claude에 수정 요청" button → POST .../hand-back-claude
  - Each action creates an audit row + the response chunks land
    in the dual-console stream.
- Modify dual-agent-console.js to consume `claude_stream_chunk`
  / `codex_stream_chunk` instead of generic events.

**Tests**:
- New: `tests/unit/reviewSessionManager.test.js` — state machine
  pinning, audit verb emission, WS broadcast, error paths.
- New: `tests/integration/review-session-routes.test.js` — 5
  endpoint contract test, token gating, public-sector posture
  refusing local Bash, audit chain entries.
- New: `tests/unit/monitor.review-relay.test.js` — UI input
  action rows POST correctly + handle 401 / 409 / 500.

**DoD**:
- An operator can issue: send-to-codex → see critique in right
  pane → ask follow-up → see response → hand-back-to-claude.
- Claude's hand-back response, if it contains Bash/Edit/Write,
  triggers an approval-card entry (existing R3-e flow). Operator
  must approve before the tool dispatches.
- Public-sector posture refuses local Bash for follow-ups
  (consistent with GOV-SB-0 / GOV-PII-0 boundaries).
- WS events flow: `review_session_created` →
  `codex_stream_chunk*` → `critique_received` →
  `handoff_to_claude_requested` → `claude_stream_chunk*` →
  approval card → `runner_hook_approval_*` → executor dispatch.

**Score impact**: +1 (Pipeline orchestration cap movement —
operator-driven multi-agent workflow is qualitatively new).

---

### 2.6. UI-H5 — Public-sector integration

**Goal**: every existing GOV defense gets first-class shell
visibility + reduced motion + policy gate timeline.

**Work**:

- Per UI Plan §UX-H5:
  - Public-sector mode → reduced-motion orchestrator-track (locks
    horse to current lane; renders gate icons as static markers).
  - Local Bash forbidden for review-relay follow-ups (returns
    409 with `{ error: "public_sector_local_executor_disabled" }`).
  - Sandbox stream gets a dedicated tab in the dual console.
  - PII scan results from GOV-PII-1 surface in a new "보안 상태"
    card on the simple dashboard (count + top types).
  - Bash/Edit/Write hook dispatch routes through the existing
    approval-card panel (already in place, just verify).
- New `public/js/monitor/panels/security-status-card.js` —
  Simple-mode card that summarizes: posture badge / sandbox
  status / PII scan summary / approval pending count. Reads
  `snapshot.accountStatus.deployment` + `snapshot.pendingApprovals`.
- Modify orchestrator-track to consume `snapshot.accountStatus.deployment.publicSector`
  → visual mode swap.

**Files**:
- New: `public/js/monitor/panels/security-status-card.js` (~250 lines)
- Modify: `public/js/monitor/panels/orchestrator-track.js` — reduced-
  motion variant.
- Modify: `src/routes/reviewSessionRoutes.js` — public-sector
  refusal of local Bash for follow-ups.
- Modify: `public/style.monitor.css` — security-status-card +
  reduced-motion orchestrator-track styles.

**Tests**:
- New: `tests/unit/monitor.security-status-card.test.js` —
  card rendering across posture combinations.
- New: `tests/integration/review-session-public-sector.test.js`
  — public-sector posture rejects local Bash follow-ups with
  409 + structured error.
- Modify: orchestrator-track tests to cover reduced-motion mode.

**DoD**:
- Public-sector operator opening simple mode sees the security-
  status card on first paint.
- Reduced-motion orchestrator-track works with both
  `ORCHESTRATOR_DEPLOYMENT_PROFILE=public-sector` and OS-level
  `prefers-reduced-motion`.
- Local Bash in review-relay follow-ups: refused under public-
  sector; allowed (with approval) under standard.

**Score impact**: +0.5 (Public-sector readiness cap — extends
operator visibility into the existing 3-layer GOV defense
stack; doesn't add a 4th layer but improves the operator's
read on the existing layers).

---

### 2.7. UI-H6 — Simple dashboard polish

**Goal**: the operator-friendly first view per UI Plan §UX-H6.

**Cards** (4 only — token usage card explicitly excluded):

1. **지금 AI가 하는 일** — current run phase + pulse animation
   (mirrors the orchestrator-track current lane name in plain Korean).
2. **승인 필요** — pending approvals count + click-through to
   the approval-card panel (already mounted; just deep-link).
3. **보안 / 개인정보 상태** — reuses UI-H5's security-status-card.
4. **최근 결과** — last 3 completed runs with verify result +
   timestamp. Reads from `snapshot.runs` (sorted by
   `completedAt` desc; verify status from runDetails).
5. **Claude / Codex 연결 상태** — reuses D3-c global-bar's
   posture / profile cells but in card form (3 lines).

(That's 5 cards total, not 4 — UI Plan implicitly groups items
3+5 separately. We ship 5 cards as the MVP.)

**Work**:
- New `public/js/monitor/shells/simple-shell.js` — the simple
  shell mount function (called by layout.js when mode === "simple").
  Renders orchestrator-track + the 4-5 cards in a 2×3 grid.
- New `public/js/monitor/panels/now-doing-card.js`
- New `public/js/monitor/panels/pending-approvals-card.js`
  (deep-links to the approval-card panel)
- New `public/js/monitor/panels/recent-results-card.js`
- New `public/js/monitor/panels/connection-status-card.js`
- Modify `public/js/monitor/layout.js` — mode-aware mount entry.
- Modify `public/index.html` — script tags for the 4 new card
  panels + simple-shell.js.

**Tests**:
- New per-card unit tests (4 files, ~80 lines each).
- New: `tests/integration/simple-shell-html.test.js` — JSDOM-
  free check that simple mode renders the expected card structure.
- Modify: `tests/integration/monitor-shell-html.test.js` — keep
  advanced-mode test; ensure simple mode passes its own
  assertions.

**DoD**:
- An operator opening `?mode=simple` (or default after env flip)
  sees orchestrator-track + 5 cards + nothing else (no run-tree, no
  timeline, no inspector).
- Each card reads from store; unknown state → friendly placeholder.
- Click-through to approval card works without leaving the page.
- Onboarding copy: first-run banner ("프로필을 만들어 시작하세요")
  links to settings-accounts modal.

**Score impact**: +1 (UI feedback loop cap movement — the
operator's first-paint experience is now operator-friendly,
not power-user-only).

---

## 3. Acceptance gates

| Gate | Description | Evidence |
|---|---|---|
| **UI-H-G01** | All design tokens declared in orchestrator-shell.css; no hardcoded color hex in panel CSS | css-tokens-present.test.js |
| **UI-H-G02** | Mode resolution priority correct (URL > localStorage > envDefault > "simple") | monitor.mode.test.js |
| **UI-H-G03** | Simple mode renders 5 cards + orchestrator-track only | simple-shell-html.test.js |
| **UI-H-G04** | Advanced mode preserves existing 9-panel layout | monitor-shell-html.test.js (existing) |
| **UI-H-G05** | Legacy mode bypasses monitor shell entirely | monitor.layout.test.js (mode: "legacy") |
| **UI-H-G06** | Orchestrator-track lane reflects actual run phase; no fake progress | monitor.horse-state-machine.test.js + orchestrator-track.test.js |
| **UI-H-G07** | Reduced-motion (public-sector / prefers-reduced-motion) freezes animation | orchestrator-track.test.js |
| **UI-H-G08** | Dual console: read-only, no PTY, no stdin | dual-agent-console.test.js (negative pin) |
| **UI-H-G09** | Review relay 5-endpoint contract | review-session-routes.test.js |
| **UI-H-G10** | Review relay → approval card chain: Claude hand-back with Bash → approval card entry | integration test |
| **UI-H-G11** | Public-sector posture refuses local Bash in review-relay follow-ups | review-session-public-sector.test.js |
| **UI-H-G12** | Security-status-card surfaces every GOV layer state | security-status-card.test.js |
| **UI-H-G13** | No new external dependencies (no `npm i`, no CDN) | manual + diff inspection |
| **UI-H-G14** | No CSP relaxation (every panel external src) | csp-nonce.test.js (existing) |
| **UI-H-G15** | Existing R3-e + GOV-APPROVAL-0 + UX-2 tests stay green | npm run test:unit + test:integration |

UI-H COMPLETE = G01..G15 all GREEN.

---

## 4. Dependencies + execution order

```
UI-H0 (design tokens) ─────────────────────────────────
       │
       ↓
UI-H1 (shell mode foundation) ──────────────────────────
       │
       ├─→ UI-H2 (Orchestrator Track) ───────────────────────
       │         │
       │         └─→ UI-H6 (Simple dashboard polish) ──→ END
       │
       ├─→ UI-H3 (Dual Agent Console, read-only) ──────
       │         │
       │         └─→ UI-H4 (Review relay backend) ─────
       │                   │
       │                   └─→ UI-H5 (public-sector integration) ─→
       │
       └─→ UI-H6 (Simple polish) integrates UI-H2 + UI-H5
```

Recommended order: H0 → H1 → H2 → H3 → H4 → H5 → H6.

Parallelizable:
- H0 and H1 can land in same commit if scoped tight.
- H2 and H3 can land in same session (independent mounts).
- H6's individual cards can be built incrementally during H2-H5.

Sequentially required:
- H4 follows H3 (review relay needs the read-only console).
- H5 follows H4 (public-sector posture must apply uniformly
  across the relay flow).

---

## 5. Score-impact summary

| Sub-round | Cap movement | Score |
|---|---|:---:|
| Entry (post GOV-APPROVAL-0 closeout) | — | **111/119** |
| +UI-H0 design tokens | — | 111 (foundational) |
| +UI-H1 shell mode foundation | UI feedback loop +0.5 | 111.5 |
| +UI-H2 orchestrator-track | UI feedback loop +0.5 | 112 |
| +UI-H3 dual console (read-only) | — (UI cap stays) | 112 |
| +UI-H4 review relay backend | Pipeline orchestration +1 | 113 |
| +UI-H5 public-sector integration | Public-sector readiness +0.5 (within existing 3-cap) | 113.5 |
| +UI-H6 simple dashboard polish | UI feedback loop +1 (cap might extend 7 → 8) | 114.5 / 120 |

**Conservative end-of-round estimate: 114.5/120** (UI feedback
loop cap extended 7 → 8 if all 6 sub-rounds land).

**Aggressive estimate: 116/120** (Public-sector cap extends
3 → 4 if security-status-card surfaces enough operator value).

Final score determined at round closeout.

---

## 6. Risk register

| Risk | Mitigation |
|---|---|
| Mode toggle reload pattern is jarring — operator loses scroll position | Persist scroll + selectedRun via localStorage; re-hydrate on mount |
| Review relay's structured-action input becomes a back-door for shell access | Audit the entire input flow: every action is a typed enum + structured payload, NEVER raw stdin. Test pins this. |
| Dual console event filter regression (someone changes scope semantics in normalizer) | event-filters.js test pins normalizer integration |
| Self-hosted system fonts look different on Mac vs Windows | Document this in design-notes.md; first-cut accepts platform variance |
| Orchestrator-track animation eats CPU on long-running runs | RAF-based animation, freezes when tab hidden via Page Visibility API |
| Review relay leaks tokens (Claude/Codex API keys via WS chunks) | profileSpawn already filters via envFilter (P0); WS chunks are stdout-only |
| Public-sector posture not applied uniformly in review relay | review-session-public-sector.test.js + assertLocalExecutorAllowed at every spawn site |
| Operator confusion: "what's happening" when stream chunks arrive out of order | Each chunk has `sessionId` + `chunkIdx`; UI sorts |
| Mode resolution edge case: localStorage corruption | Mode validator rejects garbage; fall back to URL or env |
| H4 scope explosion (review relay is big) | Split H4 into H4-a (manager + routes) and H4-b (UI input row) if needed during execution |

---

## 7. Out of scope (deferred)

- **HTTP/2 streaming for stream chunks** — WS broadcast is fine
  for first-cut. HTTP/2 SSE is a follow-up if WS becomes the
  bottleneck.
- **Multi-session view** — H4 ships a single "active session"
  view. Listing past sessions is a follow-up.
- **Review session export to evidence packet** — covered by the
  future GOV-AUDIT-0 slice (per Phase E1.5 roadmap).
- **i18n full coverage** — first-cut Korean only. English follows.
- **Mobile responsive** — first-cut desktop ≥1280px. Responsive
  follows.
- **Themeable colors** — first-cut dark theme only. Light theme
  follows if requested.
- **Accessibility audit** (WCAG AA) — first-cut covers basic
  ARIA + keyboard nav. Full audit is a follow-up.

---

## 8. Sources

- `C:\Users\SJ\Downloads\web page\UI Plan.txt` — operator
  directive (the round's "what")
- `C:\Users\SJ\Downloads\web page\sj-orchestrator-dashboard\` —
  React/Babel mockup (reference only — design tokens + UX
  patterns extracted, NOT the stack)
- `docs/scorecard.md` — current 111/119 baseline
- `docs/r3-rollout-plan.md` — R3 plan structure precedent
- `docs/operator-guide.md` — operator-facing UX precedent
- `docs/public-sector-hardening-plan.md` — GOV layer cross-refs
- Existing monitor shell architecture: `public/js/monitor/`
  (store, layout, panels, legacy-bridge, normalizer)

---

## 9. Status

| Slice | Status |
|---|:---:|
| UI-H0 | ⬜ planned |
| UI-H1 | ⬜ planned |
| UI-H2 | ⬜ planned |
| UI-H3 | ⬜ planned |
| UI-H4 | ⬜ planned |
| UI-H5 | ⬜ planned |
| UI-H6 | ⬜ planned |

Round entry condition: GOV-APPROVAL-0 + UX-2-a/b/c shipped (✅
commit `a6e1d84`, 2026-04-29).
Round-end condition: G01..G15 all GREEN + closeout commit +
scorecard refresh.
