# UI Reference Port Plan

**Round: UI-P0 (Phase E Round 3, 2026-04-30)**
**Status: Reference Locked — awaiting operator sign-off before UI-P1 starts**

This document is the contract between the reference HTML at
`C:\Users\SJ\Downloads\web page\sj-harness-dashboard\` and the production
harness UI. Every later round (UI-P1 → UI-P9) consumes this plan; if a
later round needs to deviate, the deviation lands here first.

The new direction reverses the previous UI-H approach. Earlier rounds
patched the legacy dashboard with reference design tokens; from now on,
the **reference HTML is the visual source of truth** and existing harness
functionality is ported into that shell.

---

## 1. Reference assets

| Path | Size | Role | Verified |
|---|---:|---|:---:|
| `SJ Harness Dashboard.html` | 1.7 KB | Entry point — loads React 18 + Babel + 5 JSX + 1 panel | ✅ |
| `tweaks-panel.jsx` | 18.4 KB | Prototype-only Tweaks UI (color picker, mode toggle, density). NOT ported — production has no live-edit panel. | ✅ |
| `dashboard/app.jsx` | 13.2 KB | Top-level shell — Header + HarnessTrack + 2-column workspace | ✅ |
| `dashboard/pipeline.jsx` | 9.9 KB | Left rail — 7 PIPELINE_STAGES rendered as PipelineNode cards + PipelineMetricsBlock (pro mode) | ✅ |
| `dashboard/monitors.jsx` | 11.2 KB | Center grid — Findings/Context/Verify/CodexLive/SubagentTray/ToolFeed/CritiqueTimeline cards | ✅ |
| `dashboard/terminals.jsx` | 9.2 KB | Bottom dual terminals — Claude/Bash + Codex/Verifier with tab bar + autoscroll/clear | ✅ |
| `dashboard/horse.jsx` | 2.5 KB | 12-frame sprite player — gallop loop + rear freeze | ✅ |
| `dashboard/horse-frames.png` | 140 KB | **2016×96** (12 frames × 168×96 each, verified — README claim "1836×84" is stale) | ✅ |

### 1.1 README discrepancy noted

`README.md` claims `horse-frames.png` is "1836×96". The actual file is
**2016×96**. The JSX code (`HORSE_FRAME_W = 168, HORSE_FRAMES = 12` →
2016) matches reality. We track the correct dimensions in this plan;
the README is reference-only and will not be ported.

---

## 2. Visual + structural inventory

The reference is a **5-region full-screen shell**:

```
┌────────────────────────────────────────────────────────────────┐
│ HEADER  (h: 52px)   ◇ SJ Harness · v2.4.0 · 실행중 ·           │
│                     [Simple|Pro] · 서버 ONLINE · Codex READY · │
│                     KO|EN · 메트릭 히스토리 검증 · 서버종료    │
├────────────────────────────────────────────────────────────────┤
│ HARNESS TRACK  (h: 92px)   PLAN ─ CRITIQUE◈ ─ REVISE ─ ...     │
│                            [horse sprite running L→R]          │
│                            STAGE 4/7 · RE-CRITIQUE             │
├──────────────┬─────────────────────────────────────────────────┤
│              │  MONITOR GRID   (flex 1)                         │
│ PIPELINE     │  ┌─────────┬───────────┬──────────┐             │
│ RAIL         │  │Findings │  Context  │  Verify  │ ← stat row  │
│              │  ├─────────┴───────────┴──────────┤             │
│ (w: 320px    │  │   Codex 라이브 출력 (pro only)  │             │
│  simple,     │  ├──────────────────────────────────┤             │
│  380px pro)  │  │  서브에이전트 (pills)            │             │
│              │  ├─────────────┬────────────────────┤             │
│ Plan ✓       │  │ Tool Calls  │  Critique Timeline │             │
│ Critique ✓   │  └─────────────┴────────────────────┘             │
│ Revise ✓     ├─────────────────────────────────────────────────┤
│ Re-check ●   │  DUAL TERMINALS  (h: 280px)                      │
│ Execute ─    │  ┌──────────────────────┬───────────────────────┐│
│ Verify ─     │  │ Claude · Bash tabs   │ Codex · Verifier tabs ││
│ Done ─       │  │ ◇ 16:42:14  prompt   │ ◈ 16:42:08 ✗ JWT...  ││
│              │  │ ...                  │ ...                  ││
│ [METRICS pro]│  │ [auto] [clear]       │ [auto] [clear]       ││
└──────────────┴─────────────────────────────────────────────────┘
```

### 2.1 Color palette (pinned from JSX)

| Token | Value | Use |
|---|---|---|
| `--hsh-bg` | `#08090B` (app bg), `#0B0C0E` (body), `#0C0D10` (header), `#0F1013` (pipeline rail), `#101115` (monitor card bg) | Layered surfaces |
| `--hsh-text` | `#E8E6E1` | Primary text |
| `--hsh-text-dim-60` | `rgba(232,230,225,0.60)` | Secondary text |
| `--hsh-text-dim-40` | `rgba(232,230,225,0.40)` | Tertiary text |
| `--hsh-border` | `rgba(255,255,255,0.06)` | Card borders |
| `--hsh-bronze` | `#C9A66B` | Primary accent (Claude) |
| `--hsh-blue` | `#7FA9CB` | Codex accent |
| `--hsh-green-pass` | `#9BD8A6` | PASS/done |
| `--hsh-red` | `#E55B5B` | critical |
| `--hsh-orange` | `#E89B4B` | high |
| `--hsh-yellow` | `#D9C24A` | medium |
| `--hsh-purple` | `#B58FCB` | Write/violet |

### 2.2 Typography stack

| Token | Reference value | Production replacement (no Google Fonts) |
|---|---|---|
| Display headings (Fraunces serif) | `"Fraunces", serif` | `"Fraunces", "Charter", "Iowan Old Style", "Apple Garamond", "Cambria", "Georgia", serif` |
| Body (Pretendard Variable) | `"Pretendard Variable", -apple-system, system-ui, sans-serif` | `-apple-system, "Apple SD Gothic Neo", "Pretendard Variable", "Malgun Gothic", "Segoe UI", system-ui, sans-serif` |
| Mono (JetBrains Mono) | `"JetBrains Mono", monospace` | `ui-monospace, "JetBrains Mono", "Cascadia Code", Consolas, "SF Mono", Menlo, monospace` |

System fallback chain captures the visual character without a Google
Fonts dependency. Operators who already have Pretendard / JetBrains
Mono / Fraunces installed see them; those without see the closest
system fallback. Confirmed acceptable for public-sector posture
(no external font loading on first paint).

### 2.3 Animations

| Reference | Behavior | Production reuse |
|---|---|---|
| `@keyframes hpulse` | scale(1)→scale(.55), opacity 1→.5, 1.4s | port verbatim |
| `@keyframes hslide` | left -40%→100%, 1.6s | port verbatim |
| `@keyframes caretBlink` | 1s steps(1) | port verbatim |
| `@keyframes rearCallout` | opacity+translateY .25s | port verbatim |
| `@keyframes bridleGlint` | opacity 0.4→0.9, 0.8s alternate | port verbatim |
| Horse gallop loop | requestAnimationFrame, ~8.5fps | port to vanilla JS RAF |
| Stage advance | setTimeout chain (1100ms run / 700ms hold / 2200ms rear) | port verbatim, but driven by store events instead of mock timer |

---

## 3. Component port table

Three port classes:
- **PORT** — copy structure + visuals 1:1 to vanilla JS UMD; replace JSX
  with DOM creation; hook to store data.
- **REPLACE** — discard reference logic; use existing harness module
  underneath (e.g. ws-client, run-history, audit chain).
- **DROP** — reference-only (Tweaks panel, mock data sources, etc.).

| Reference | Class | Production target | Data source | Notes |
|---|:---:|---|---|---|
| `App` (app.jsx) | PORT | `public/js/monitor/shells/product-shell.js` (NEW) | n/a | Top-level shell. Reads `?mode=` URL param + localStorage `harness:ui-mode`. Default `pro` per reference; existing UI-H `simple` mode stays alias for reference's `simple`. |
| `Header` | PORT | `public/js/monitor/panels/product-header.js` (NEW) | `accountStatus`, server `info` | Already wired in part by `global-bar.js` — but the reference shape is different (single 52px row vs. legacy multi-cell). Replace global-bar layout while reusing the data subscription pattern. |
| Mode toggle (Simple/Pro pill) | PORT | inside `product-header.js` | `ui-mode.js` (existing) | i18n: `일반사용자 / 전문사용자` Korean + `Simple / Pro` italic English subscript. |
| KO/EN button | PORT | inside `product-header.js` | `i18n.js` (existing) | Functional — switches HarnessI18n locale. Reference is decorative; we wire the real toggle. |
| 메트릭 / 히스토리 / Codex 검증 (pro) | REPLACE | inside `product-header.js` → opens existing modals | `analytics-panel`, `run-history`, audit modals | Buttons render from reference; click handlers open the existing UI-H modals in-place. |
| 서버 종료 | REPLACE | inside `product-header.js` | `POST /api/server/control/shutdown` (existing) | Functional — confirms then calls existing endpoint. |
| `HarnessTrack` (in app.jsx) | PORT | `public/js/monitor/panels/harness-track.js` (REWRITE) | store.runs[selectedRunId].phase | Existing harness-track is overlay; new one is the 92px band per reference. Drives stage from `phase` field instead of a mock timer. |
| `HorseRider` (horse.jsx) | PORT | `public/js/monitor/panels/horse-rider.js` (REWRITE) | n/a (animation only) | Sprite path: `public/images/horse-frames.png`. RAF loop + `state` prop (`gallop`/`rear`). Emoji 🐎 stays as fallback when the PNG fails to load. |
| Trigger callout (`◈ HARNESS · CRITIQUE GATE`) | PORT | inside `harness-track.js` | store events `phase_change`, `gate_triggered` | Renders the bronze-bordered tooltip when the active stage has a gate. |
| Status pill right side | PORT | inside `harness-track.js` | active run state | `STAGE 4/7 · RE-CRITIQUE` style. |
| `PipelineRail` (pipeline.jsx) | PORT | `public/js/monitor/panels/pipeline-rail.js` (NEW; replaces `run-tree.js` mounting position) | store.runs + selectedRunId | The reference shows 7 hard-coded stages (PIPELINE_STAGES). Production drives this from the run's actual phase list (template). When no active run, falls back to a "no run" empty state — not the mock 7 stages. |
| `PipelineHeader` (코드 리뷰 pill + 작업시작 button + compact/템플릿) | PORT | inside `pipeline-rail.js` | template selection + start CTA | Pill is the active template id. 작업시작 = existing pipeline `/api/pipeline/start`. compact + 템플릿 = existing UI-H modals. |
| `PipelineNode` (per-stage card) | PORT | inside `pipeline-rail.js` | per-phase metadata from run | Status colors `done`/`active`/`pending` map directly from phase status. |
| `PipelineMetricsBlock` (RUN METRICS) | PORT | inside `pipeline-rail.js` (pro mode only) | run summary (elapsed, iteration, gates passed, ETA) | Reference has hard-coded values; production reads from `runDetails[runId]`. |
| `MonitorGrid` (monitors.jsx top stat row + cards) | PORT | `public/js/monitor/panels/monitor-grid.js` (NEW) | store data per card (see below) | The grid layout is the "monitors center" region. Reuses existing card data sources but lays them out exactly per reference. |
| `FindingsCard` | REPLACE | reference visual, existing `findings` slice | `pipeline_state.findings` (5-tier severity counts) | The 5-card horizontal layout is new; the underlying severity data already exists. |
| `ContextCard` | REPLACE | reference visual + gradient bar | `runDetails[runId].context` or new `/api/runs/:runId/context` | No live context data on server today — needs a small read API or compute from latest event. Drop to mock until UI-P5 wires real source. |
| `VerifyCard` (pro) | REPLACE | reference visual, PASS/FAIL dot + gate count | `runDetails[runId].verifyStatus` | Already exists in run-viewer audit section; surfaced here as a glance card. |
| `CodexLiveCard` (pro) | PORT | reference visual, terminated by stream | `reviewSessions[selectedReviewSessionId].codexStream` (UI-H7-a state) | Replaces mock 2-line preview with the actual codex chunk feed. |
| `SubagentTray` | REPLACE | reference visual (pill row) | `runDetails[runId].subagents` (existing MB2 server snapshot) | Already wired in `agent-tree.js` — pull the same snapshot, render as pills per reference. |
| `ToolFeed` | REPLACE | reference visual (5-col grid row) | events filtered by `tool_call` type | We already have tool feed somewhere in legacy; reference styling is denser. |
| `CritiqueTimeline` | REPLACE | reference visual (left/right bubbles) | `reviewSessions[selectedReviewSessionId].history` | Existing dual-agent-console state; new render shape per reference. |
| `DualTerminals` (terminals.jsx) | PORT | `public/js/monitor/panels/dual-terminals.js` (NEW; replaces `dual-agent-console.js` mounting position) | reviewSession streams + bash session | Bottom 280px strip. Tabs: Claude/Bash + Codex/Verifier. The action row from existing dual-agent-console (start/send/follow-up/hand-back/archive) plugs INTO this terminal area in UI-P6. |
| `Terminal` per-rail (autoscroll, clear, tab bar) | PORT | inside `dual-terminals.js` | line buffer per session | Direct port of reference structure. Lines come from store streams. |
| `TweaksPanel` | DROP | n/a | n/a | Prototype-only. Production never bundles a live theme editor. The accent color is fixed at `#C9A66B`. |
| Mock CLAUDE_LINES / CODEX_LINES / BASH_LINES / VERIFY_LINES | DROP | n/a | n/a | Replaced by real streams in UI-P5/P6. |

---

## 4. Production architecture

```
public/
  index.html                    [REWRITE]  → mounts product-shell by default
  index.legacy.html              [NEW]     → unchanged legacy markup, served on ?mode=legacy
  app.js                         [LEGACY]  → kept as-is for ?mode=legacy
  style.product.css              [NEW]     → reference-derived tokens + layout (no Google Fonts)
  images/
    horse-frames.png             [NEW]     → copied from reference, 2016×96, 12 frames
  js/monitor/
    shells/
      product-shell.js           [NEW]     → top-level mount
      simple-shell.js            [DEPRECATED-ALIAS] → re-exports product-shell with ?mode=simple
    panels/
      product-header.js          [NEW]     → 52px header with mode toggle + posture + actions
      harness-track.js           [REWRITE] → 92px band, real phase data
      horse-rider.js             [REWRITE] → sprite player (PNG load + RAF loop)
      pipeline-rail.js           [NEW]     → 320/380px left rail
      monitor-grid.js            [NEW]     → center cards
      dual-terminals.js          [NEW]     → bottom 280px terminals
      […existing UI-H10 / UI-H7 panels remain for modal/inspector usage…]
    legacy-bridge.js             [EXTEND]  → forward live events into product shell store
    store.js                     [EXTEND]  → add `productShell.layoutMode` slice (pro/simple)
```

### 4.1 Routing matrix

| URL | Mounted shell | Default mode | Notes |
|---|---|---|---|
| `/` | product-shell | `pro` | New first-paint experience. |
| `/?mode=simple` | product-shell | `simple` | Reference Simple variant — fewer cards, no pro-only buttons. |
| `/?mode=pro` | product-shell | `pro` | Same as default; explicit pin. |
| `/?mode=legacy` | legacy `app.js` | n/a | Operator escape hatch; serves `index.legacy.html`. |
| `/?mode=advanced` | product-shell | `pro` | Internal alias for backward compatibility with existing UI-H tests/code paths. Deprecated; removed in UI-P9 visual gate. |

### 4.2 Why no React/Babel CDN

The reference uses React 18 + Babel Standalone via `unpkg.com` CDN. We
cannot ship that to public-sector operators because:

1. **External network on first paint** — public-sector posture forbids
   non-allowlisted egress; the CDN load would block boot.
2. **No SRI for arbitrary CDN versions** — would need pinned SRI hashes
   for production.
3. **Babel transpile latency** — Babel-in-browser adds 100-400ms of
   parse time per JSX file.
4. **CSP `script-src 'self'` is the hardening target** — current CSP
   already blocks `unpkg.com`.

The port writes vanilla JS in the existing UMD pattern (`(function(root,
factory){...})`) used by every panel from MA1 onward. Each component
factory takes `{root, store, doc}` and renders to DOM. No JSX, no
build step, no Babel.

### 4.3 i18n

All Korean labels in the reference (`일반사용자`, `발견 사항`, `컨텍스트`,
`검증`, `툴 호출`, `Critique 타임라인`, `계획 수립`, etc.) move into
`public/js/i18n/ko.js`. English equivalents (italic Fraunces subscript)
land in `en.js`. The KO/EN toggle in the header drives the switch
through the existing `HarnessI18n.t()` API.

---

## 5. Round breakdown

This section pins what each later round (UI-P1 → UI-P9) ships. No code
changes happen until operator signs off on this section.

| Round | Scope | Commits (estimate) | Risk |
|---|---|:---:|:---:|
| **UI-P1** | Product shell port (mock data) — `index.html` mounts new shell with reference-shape header + harness-track + 2-col + dual-terminals; legacy lives at `index.legacy.html` | 5-7 | medium (CSP nonce, mount sequencing) |
| **UI-P2** | Visual parity pass — `style.product.css` finalized; pixel-level comparison vs reference; spacing/border/density tokens | 2-3 | low (CSS-only) |
| **UI-P3** | Horse sprite port — copy `horse-frames.png` to `public/images/`, write vanilla `horse-rider.js`, integrate RAF loop, keep emoji fallback | 2 | low |
| **UI-P4** | Static mock content layout — pipeline-rail + monitor-grid render with deterministic mock data, shape matches reference | 3-4 | low (mock data only) |
| **UI-P5** | Store wiring — wire each card to its store slice; legacy-bridge feeds events into product shell | 4-6 | medium (data transformation) |
| **UI-P6** | Review-relay terminals — Claude/Codex streams attach to the bottom dual-terminals; UI-H7 action row inserts into the terminal frames | 3-4 | medium (existing UI-H7 state must stay green) |
| **UI-P7** | Simple/Pro productization — i18n strings finalized, mode switch persisted to localStorage, pro-only features gated | 2 | low |
| **UI-P8** | Legacy retreat — `?mode=legacy` opt-in, default routes to product shell, deprecation banner on legacy | 2 | low |
| **UI-P9** ✅ | Visual contract gate — structural snapshot harness (no Playwright; CI-friendly): tests/visual/extract.js + capture.js + baseline-product-shell.json + tests/unit/visual.contract.test.js + scripts/visual-baseline-update.js + npm visual:check + visual:update + ci.yml visual-contract-freshness step. UI feedback loop cap 8 → 9. | 1 | low (no browser) |

**Total: 25-33 commits across 9 rounds.** Each round commits + push +
CI green before next starts (existing rhythm).

### 5.1 What does NOT change

- Server side (`server.js`, all routes) — UNCHANGED. Product shell
  consumes the same APIs as legacy app.
- Existing UI-H modals (run-viewer, settings-accounts, approval-card,
  audit-chain) — REUSED. Mounted via existing modal mount points;
  product-shell triggers the same modals.
- Audit chain, evidence ledger, manifest signing, trust store — ALL
  UNCHANGED.
- Test infrastructure (`tests/unit/`, `tests/integration/`,
  `tests/smoke/`) — existing tests stay green; new component tests
  are additive.

---

## 6. Risk register

| Risk | Mitigation |
|---|---|
| Visual drift between reference + production after pixel-perfect P2 | UI-P9 visual regression gate locks each `/?mode=*` route's screenshot vs reference baseline. |
| Legacy users lose features when redirected to product shell | UI-P5 wires every existing data source. UI-P8 retains `?mode=legacy` as full escape. |
| New shell breaks existing UI-H modals (run-viewer, settings, approval) | Modals are mounted at the same DOM positions; product-shell is just a different parent. Each round ends with full unit + integration test pass. |
| Horse sprite PNG load failure | Emoji 🐎 fallback already in place (UI-H pre-port); horse-rider.js detects load failure and renders fallback. |
| Reference uses Tweaks panel / mock timers; we replace with store events | Mocks isolated to UI-P4; UI-P5 swaps to real data per card. The shell architecture allows partial wiring (some cards real, some mock). |
| User reads English labels on Simple mode (where reference shows Korean) | Korean stays primary; English subscript stays italic Fraunces. KO/EN toggle changes only the visible labels — IDs + audit chain text stay English. |
| Visual parity work blocks functional rounds | UI-P1 ships visually 70% complete with mock data. UI-P5 ships functionally 90% complete with rough visuals. P2 finishes pixel polish in parallel — order can flex. |
| Rendering perf with many DOM nodes (each card recomputes on every store event) | Existing store.subscribe has `_publish` guard. New panels follow `_renderInPlace(prev, next)` pattern from MB1+ to avoid full innerHTML resets. |
| Public-sector mode breaks CSP | `style.product.css` is `<link>` — no inline. All scripts external + nonce. Existing CSP enforcement remains untouched. |

---

## 7. Operator decisions (signed off 2026-04-30)

All six decisions resolved by operator. UI-P1 cleared to start.

| # | Question | Decision |
|---|---|---|
| 1 | Default mode (reference: `pro`) | **`simple`** — new operators see lower density first. |
| 2 | Drop `tweaks-panel.jsx` (live theme editor) | **DROP** — production never ships a live editor; accent fixed at `#C9A66B`. |
| 3 | Reference's 7 hard-coded stages vs. real template phases | **Real template phases** — empty state when no active run; reference 7 stages drop. |
| 4 | Header "실행 중" mock pill — sync to run state | **Sync** — `대기 중` (no run) / `실행 중` (active) / `중단됨` (shutdown). |
| 5 | Legacy retreat at UI-P8 | **Confirmed** — 3-round notice (P5 → P6 → P7 banners on legacy mount, P8 flips default). |
| 6 | `?mode=legacy` longevity | **Indefinite preservation** — operator escape hatch with no EOL. |

---

## 8. Sign-off block

✅ **Plan locked at 2026-04-30** by operator.

- UI-P1 starts when operator returns.
- Code changes are non-trivial (~25-33 commits over 9 rounds).
- Each round = its own commit + push + CI green, same rhythm as Phase
  1/2.
- Score impact: cumulative. UI-P1 alone = no rubric move; UI-P9
  closeout (visual regression gate green) = +1 to "UI feedback loop"
  cap (currently 8/9 → 9/9), with score conservation per v2 plan §S
  policy.

**Status**: SIGNED OFF — UI-P1 ready to begin.

---

## Appendix A — Direct file mapping

For agents working any later round, the canonical reference path for
each component:

```
PRODUCTION TARGET                         ←  REFERENCE FILE
public/index.html                         ←  SJ Harness Dashboard.html
public/js/monitor/shells/product-shell.js ←  dashboard/app.jsx (App, Header)
public/js/monitor/panels/harness-track.js ←  dashboard/app.jsx (HarnessTrack)
public/js/monitor/panels/horse-rider.js   ←  dashboard/horse.jsx
public/images/horse-frames.png            ←  dashboard/horse-frames.png (binary copy)
public/js/monitor/panels/pipeline-rail.js ←  dashboard/pipeline.jsx (entire file)
public/js/monitor/panels/monitor-grid.js  ←  dashboard/monitors.jsx (entire file)
public/js/monitor/panels/dual-terminals.js ←  dashboard/terminals.jsx (entire file)
public/style.product.css                  ←  inline styles in all reference JSX
```

## Appendix B — Why this is the right time

- **Phase 1 closeout was 2026-04-30** (Round Sync commit `007c0cd`).
  Phase 2 productization is in flight. UI is the next operator-facing
  surface that materially affects perception of the product.
- E3-F1 + UI-H10 + TRUST-STORE-0 closed the **trust + auditor + key
  management surface**. The visual layer is the natural next round.
- LV-6 is operator-runnable and parked; cap movement waits on future
  evidence. UI work is independent.
- A pixel-correct shell that operators trust is a prerequisite for
  SMART-* rounds (recommendations, presets, gates) — those features
  need a place to live that feels production-grade.
