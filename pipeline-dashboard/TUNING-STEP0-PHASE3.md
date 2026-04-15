# Harness Tuning — Step 0 + Phase 3 P0 Completion Report

**Branch**: `tuning/step0-phase3`
**Base**: `master`
**Date**: 2026-04-15
**Plan**: [`plan.md`](./plan.md) (rev2)

This report summarizes all work landed on `tuning/step0-phase3` while
executing the rev2 Step 0 verification plus Phase 3 P0 tasks (T0, T2.0,
T1, T3, T2, T9) and one pre-existing test drift fix discovered during
the regression run.

---

## 1. Objective

Harden the dashboard harness so that:

- Every runtime change has a deterministic runtime-proof path (rev2 H3/M5/M6).
- Hook payloads are inspected empirically before we build features on them
  (rev2 H4: no guessing field names).
- Sub-agents are routed to the right model tier so the harness does not
  overspend Opus on mechanical work (rev2 M2/M3).
- Skill routing uses unambiguous Korean + English trigger phrases and
  avoids cross-skill duplication (rev2 M4).
- Context pressure is surfaced to the user as a passive banner — never as
  a Stop-hook block (rev2 H5).
- Destructive operations are blocked from two entry points by a single
  shared module, with no `.claude` self-block (rev2 C1/H6/M1).

Every task uses failing-first tests where applicable (rev2 M8) and every
commit carries a `Rollback: <SHA>` footer so we can revert cleanly.

---

## 2. Commits on this branch

```
57f183f  test: update phase2 test for Phase A Bash allow (bec58ce drift)
b869b6c  feat(T9): tool-scoped danger gate (no .claude self-block)
214b863  feat(T2): context usage banner at 40%/55% (no stop block)
1deebe8  feat(T3): skill descriptions with differentiated triggers
0270a1b  feat(T1): model routing for 8 agents (haiku/sonnet/opus)
720e5c9  chore(T2.0): hook payload dumper for context_usage discovery
fbfd7df  feat(T0): /api/version endpoint for runtime proof
```

All seven commits are on `origin/tuning/step0-phase3` and fast-forward
mergeable into `master`.

---

## 3. Tasks

### T0 — `/api/version` runtime-proof endpoint

**Commit**: `fbfd7df`

Adds a runtime identity capture at server boot (commit SHA via
`git rev-parse HEAD`, start timestamp, PID, Node version) and exposes it
as `GET /api/version`. Any step that claims "the new code is running"
can be verified deterministically by hitting this endpoint and checking
the SHA against `git rev-parse HEAD`. Used as the B0 baseline gate in
every restart.

**Files**: `pipeline-dashboard/server.js`

**Verification**: B0 baseline — `curl /api/version` returns `commitSha`
equal to `git rev-parse HEAD` after each restart.

---

### T2.0 — Hook payload dumper (discovery only)

**Commit**: `720e5c9`

Adds an opt-in payload dumper to `hooks/harness-hook.js` controlled by
`HARNESS_DUMP_PAYLOADS=1`. When active, every hook event's full JSON
payload is written to `_workspace/hook-payload-samples/` (gitignored)
for offline analysis.

**Why this was needed**: rev1 of T2 assumed Claude Code would deliver a
`context_usage` field in hook payloads. rev2 H4 flagged this as a
guess. T2.0 exists to replace the guess with empirical evidence before
building anything on top.

**Finding**: 30+ captured samples across `UserPromptSubmit`, `PreToolUse`,
`PostToolUse`, and `Stop` confirmed there is **no** `context_usage`
field, and no token-count/context-window field under any name. Every
event does carry a `transcript_path`, so T2 uses the session jsonl file
size as the fallback signal.

**Files**: `pipeline-dashboard/hooks/harness-hook.js`

---

### T1 — Agent model routing

**Commit**: `0270a1b`

Adds a `model:` field to the frontmatter of eight `.claude/agents/*.md`
files so each sub-agent routes to a deliberately chosen tier:

| Agent | Model | Rationale |
|---|---|---|
| `context-analyzer.md` | haiku | Deterministic discovery |
| `task-validator.md` | haiku | Parsing test results |
| `readability-reviewer.md` | haiku | Pattern checks |
| `review-synthesizer.md` | sonnet | Mechanical findings merge |
| `security-auditor.md` | sonnet | OWASP pattern scan |
| `task-planner.md` | opus | Complex task decomposition |
| `saboteur-reviewer.md` | opus | Creative attack imagination |
| `review-orchestrator.md` | opus | Final arbitration |

`plan-critic.md` is unchanged — it is a Codex CLI shim, not a
Claude sub-agent.

**Verification**:
- V-T1-1: Node script walks all eight files, parses frontmatter, asserts
  the `model:` value matches the expected tier. 8/8.
- V-T1-3: Runtime check via `Agent(subagent_type: "context-analyzer")`
  in a fresh session — the agent self-reported as "Claude Haiku 4.5"
  with a ~3.3s duration typical of Haiku, confirming routing is live.

---

### T3 — Skill description rewrite

**Commit**: `1deebe8`

Rewrites the `description:` frontmatter of two competing skills so the
router has unambiguous triggers:

- `.claude/skills/universal-task-pipeline/SKILL.md` — coding/refactor/bug
  fix triggers plus explicit "재실행 / 보완 / 이전 결과 개선 / 업데이트"
  follow-up keywords, redirects review-only work to `code-review-pipeline`.
- `.claude/skills/code-review-pipeline/SKILL.md` — review triggers plus
  "다시 리뷰 / 재리뷰 / 이전 리뷰 보완", redirects implementation work to
  `universal-task-pipeline`.

Each description is 100–500 chars with no 30-char overlap between the
two files (anti-duplication).

**Verification — V-T3-4 smoke test (3/3 PASS)**:

| Prompt | Expected skill | Observed |
|---|---|---|
| "이 코드 리뷰해줘" | code-review-pipeline | code-review-pipeline |
| "이 작업 다시 실행해줘" | universal-task-pipeline | universal-task-pipeline |
| "로그인 기능 만들어줘" | universal-task-pipeline | universal-task-pipeline |

The middle case is the discriminator — "다시 실행" is the new keyword
added by T3, and it correctly routes to the universal pipeline
despite the prior review-biased description.

---

### T2 — Context usage banner (no Stop block)

**Commit**: `214b863`

Adds a `ContextAlarm` module that watches every hook payload for
context pressure and broadcasts a `context_alarm` WebSocket event at
40% (notice, yellow) and 55% (warn, red). The dashboard renders a
dismissable top banner recommending `/compact`. The alarm never
returns a `block` decision — rev2 H5 explicitly forbids blocking the
Stop hook on context pressure.

**How usage is measured**: `context_usage` is absent from real hook
payloads (confirmed by T2.0), so the module falls back to estimating
from the `transcript_path` file size (~4 bytes per token against a
200k token limit). Tests inject an explicit `context_usage` field for
determinism; production uses the fallback.

**State tracking**: duplicate suppression is per `session_id` via a
`{at40, at55}` flag pair so a long session does not spam the UI.

**Files**:
- New: `pipeline-dashboard/executor/context-alarm.js`
- New: `pipeline-dashboard/executor/__t2-context-test.js`
- New: `pipeline-dashboard/executor/__t2-live-verify.js`
- Modified: `pipeline-dashboard/server.js` — ContextAlarm wired into
  `/api/hook` (broadcast-only, no block).
- Modified: `pipeline-dashboard/public/index.html` — banner DOM.
- Modified: `pipeline-dashboard/public/app.js` — `context_alarm` handler,
  banner show/hide, reset on `pipeline_reset`.
- Modified: `pipeline-dashboard/public/style.css` — yellow/red banner
  styling + fade-in animation.

**Verification**:
- Unit (failing-first): 9/9 in `__t2-context-test.js` — notice, dup
  suppress, warn, no-block return, transcript_path fallback, explicit
  override, direct 0.58 jump, per-session isolation, missing path.
- Live: 4/4 in `__t2-live-verify.js` — WS subscriber plus live POST
  to `/api/hook` confirms exactly one notice at 0.42, no re-fire at
  0.43, one warn at 0.58, Stop event at 0.90 returns `{}` (no block).
- Visual (V-T2-5): manually confirmed the yellow and red banner
  variants after two synthetic POSTs.

---

### T9 — Tool-scoped danger gate (shared module)

**Commit**: `b869b6c`

Adds `pipeline-dashboard/executor/danger-gate.js` exporting
`isDangerous(tool, input)`, shared between two entry points:

1. `pipeline-executor.onPreTool` — runs **even when the executor is
   disabled**, so dangerous ops are blocked regardless of harness
   mode.
2. `server.js /api/hook` `pre-tool` path — runs before the hookRouter
   dispatch, so the gate fires even if the executor is never attached.

Both entry points broadcast `dangers_blocked` events with an `entry`
field (`"executor"` or `"hook"`) so the dashboard can tell which path
caught a given block.

**Detection rules (structural, tool-scoped)**:
- `Bash`: `rm` with flags containing both `r` and `f` (any order, any
  case), `git push` force variants (`--force`, `--force-with-lease`,
  `-f`), `git reset --hard`, `Remove-Item -Recurse`.
- `Write`/`Edit`: `.env` / `.env.*` files, `credentials.json`.
- `Read`, `Glob`, `Bash` against `.env` — explicitly allowed.
- `.claude/**` edits — explicitly allowed (rev2 C1: no self-block on
  harness tuning).

**Files**:
- New: `pipeline-dashboard/executor/danger-gate.js`
- New: `pipeline-dashboard/executor/__danger-gate-test.js`
- New: `pipeline-dashboard/executor/__t9-live-verify.js`
- Modified: `pipeline-dashboard/executor/pipeline-executor.js` — danger
  gate check runs first in `onPreTool`, bypassing the
  `enabled/active` short-circuit.
- Modified: `pipeline-dashboard/server.js` — danger gate check before
  `hookRouter.route` for `pre-tool` / `PreToolUse` events.

**Verification**:
- Unit (failing-first): 25/25 in `__danger-gate-test.js` — 11 positive
  (all danger patterns), 10 negative (benign ops including `.claude`
  edits and `Read .env`), 4 defensive (unknown tool, empty input, etc.).
- Live: `__t9-live-verify.js` — POSTs three scenarios to `/api/hook`
  (`git reset --hard`, `git status`, `Write .env.local`) and captures
  WebSocket broadcasts, plus a direct `PipelineExecutor.onPreTool`
  in-process simulation. All six assertions green.

**Dogfooding moment**: the first attempt at the T9 commit message
failed because the body described the danger patterns using their
literal command strings, and `git commit -m "..."` shells the entire
message through Bash. The danger gate matched the embedded
`git reset --hard` substring in the message and blocked its own
commit. This is the best possible evidence the gate is actually
wired into the live pipeline. The commit message was rewritten to
describe the patterns abstractly ("hard-reset of tracked state",
"recursive+force removal", etc.) and succeeded on the second try.

---

### Drift fix — `__phase2-test.js`

**Commit**: `57f183f`

Discovered during the final regression run. An earlier tuning commit
(`bec58ce`, "tune(phase-a): allow Bash and lower min-tools to 2")
added `Bash` to `pipeline-templates.json` Phase A `allowedTools` but
did not update `__phase2-test.js`, whose `test2_allowed_tools_block`
still expected Bash to be blocked. The test silently regressed at
`bec58ce` time and has been red since.

This is **not** a T1~T9 regression; the drift predates this branch's
feature work. The regression run surfaced it, and the fix landed
as a trailing commit on this branch to ship a fully green test
suite.

**Fix**: `test2_allowed_tools_block` now asserts:
- `Edit` is blocked in Phase A (new representative blocked tool).
- `Bash` (`git status`) is allowed in Phase A (post-tuning behavior).
- `Read` and `Glob` remain allowed (unchanged).

No production behavior change — test-only update.

---

## 4. Final regression status

After all seven commits, run on commit `57f183f` against the live
dashboard at `http://127.0.0.1:4200`:

| Category | Test | Result |
|---|---|---|
| Executor unit | `__phase2-test.js` | ALL PASS (6 suites) |
| Executor unit | `__phase3-test.js` | ALL PASS (8 suites) |
| Executor unit | `__phase4-test.js` | ALL PASS (10 suites) |
| T2 unit | `__t2-context-test.js` | 9/9 |
| T9 unit | `__danger-gate-test.js` | 25/25 |
| T2 live | `__t2-live-verify.js` (WS + `/api/hook`) | 4/4 |
| T9 live | `__t9-live-verify.js` (hook + executor dual entry) | 6/6 |
| T1 regression | 8 agents still carry correct `model:` | 8/8 |
| T3 regression | 2 SKILL.md descriptions still in 100–500 char bound | 2/2 |
| B0 baseline | `/api/version` commitSha matches `git rev-parse HEAD` | PASS |
| B1 baseline | `/api/codex/triggers` returns 4 triggers | PASS |

---

## 5. Files touched on this branch

```
.claude/agents/context-analyzer.md        (T1)
.claude/agents/readability-reviewer.md    (T1)
.claude/agents/review-orchestrator.md     (T1)
.claude/agents/review-synthesizer.md      (T1)
.claude/agents/saboteur-reviewer.md       (T1)
.claude/agents/security-auditor.md        (T1)
.claude/agents/task-planner.md            (T1)
.claude/agents/task-validator.md          (T1)
.claude/skills/code-review-pipeline/SKILL.md      (T3)
.claude/skills/universal-task-pipeline/SKILL.md   (T3)
pipeline-dashboard/server.js                                   (T0, T2, T9)
pipeline-dashboard/hooks/harness-hook.js                       (T2.0)
pipeline-dashboard/executor/pipeline-executor.js               (T9)
pipeline-dashboard/executor/context-alarm.js                   (T2, new)
pipeline-dashboard/executor/danger-gate.js                     (T9, new)
pipeline-dashboard/executor/__t2-context-test.js               (T2, new)
pipeline-dashboard/executor/__t2-live-verify.js                (T2, new)
pipeline-dashboard/executor/__danger-gate-test.js              (T9, new)
pipeline-dashboard/executor/__t9-live-verify.js                (T9, new)
pipeline-dashboard/executor/__phase2-test.js                   (drift fix)
pipeline-dashboard/public/index.html                           (T2)
pipeline-dashboard/public/app.js                               (T2)
pipeline-dashboard/public/style.css                            (T2)
```

`_workspace/hook-payload-samples/*.json` from T2.0 are gitignored
by design — they contain session-local paths and are discovery
artifacts, not source.

---

## 6. Known follow-ups

- **Danger gate and commit messages**: the gate matches on raw Bash
  `command` strings, so describing a danger pattern literally in a
  commit message body will trip the gate (proven by the T9 commit
  attempt). Acceptable tradeoff — the alternative would be shell-lex
  parsing, which is beyond rev2 scope. Convention going forward:
  describe dangerous patterns in commit messages by name, not by
  example.
- **True end-to-end Step 0 session**: this branch verified T1~T9 via
  unit tests, live WebSocket integration tests, and synthetic hook
  injection. A full end-to-end Step 0 run (S1–S7 with real Codex
  Phase C) was deferred from the final regression because it requires
  a fresh Claude Code session with harness mode toggled on; the
  current session's executor was kept disabled to avoid conflict
  with its own tool calls. Unit + live coverage is sufficient to
  declare T1~T9 regression-free, but a fresh end-to-end run is
  recommended before merging to `master`.
- **FF merge**: `tuning/step0-phase3` is fast-forward mergeable into
  `master`. Merge itself was deferred pending explicit user approval
  (rev2 safety discipline for push-to-master).
