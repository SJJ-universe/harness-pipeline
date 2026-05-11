# Project Handoff - 2026-04-28

## Purpose

This file is the restart point for a new AI session.

It records:

- the canonical local and remote roots
- the files and commands that prove current state
- the major work completed so far
- the archived side branches / old workspaces
- the recommended next round

If a new conversation starts, this file should be opened first, then the scorecard, the R2 evaluation report, and the active master plan.

---

## 1. Canonical roots

| Item | Value |
| --- | --- |
| Canonical git repo root | `C:\Users\SJ\harness-pipeline-analysis` |
| Canonical app / working directory | `C:\Users\SJ\harness-pipeline-analysis\pipeline-dashboard` |
| Current branch | `master` |
| Current base HEAD at handoff | `75410a0d512831cbec3ca6afa8009ae849e1af89` |
| Git working tree status before writing this handoff | `clean` (`## master...origin/master`) |
| GitHub remote | `https://github.com/SJJ-universe/harness-pipeline.git` |
| GitHub repo root | `https://github.com/SJJ-universe/harness-pipeline` |
| GitHub app tree | `https://github.com/SJJ-universe/harness-pipeline/tree/master/pipeline-dashboard` |
| GitHub current commit | `https://github.com/SJJ-universe/harness-pipeline/commit/75410a0d512831cbec3ca6afa8009ae849e1af89` |

Recommended shell working directory for all future work:

```powershell
Set-Location C:\Users\SJ\harness-pipeline-analysis\pipeline-dashboard
```

---

## 2. Current status snapshot

At handoff time, the authoritative status is:

- `Phase 2.5` multi-run correction: done
- `Phase 3-S` security reimplementation: done
- `Phase D` monitor shell and rewrite-readiness: done
- `P5` readiness automation / CI gate: done
- `P4` remote sandbox RFC + implementation RFC: done
- `R1` remote runner subsystem: done
- `R2` single remote runner deployment evaluation: done
- Current score: `102 / 111`
- Current readiness: `18 / 18`
- R2 verdict: `GO for R2.5 remote execution bridge`

Local note at packaging time:

- this handoff file itself is new and uncommitted
- `src/runtime/remoteHookBridgeContract.js` exists as an untracked `R2.5-a` draft and was left untouched
- `docs/remote-hook-bridge-contract.md` exists as an untracked `R2.5-a` contract draft and was left untouched

Primary evidence files:

- [scorecard.md](/C:/Users/SJ/harness-pipeline-analysis/pipeline-dashboard/docs/scorecard.md)
- [readiness-rubric.md](/C:/Users/SJ/harness-pipeline-analysis/pipeline-dashboard/docs/readiness-rubric.md)
- [2026-04-28-r2-single-runner-eval.md](/C:/Users/SJ/harness-pipeline-analysis/pipeline-dashboard/docs/reports/2026-04-28-r2-single-runner-eval.md)

---

## 3. High-level history

### 3.1 Environment cleanup and repository consolidation

- The canonical repo was fixed as `C:\Users\SJ\harness-pipeline-analysis`.
- The old parallel workspace clone was archived instead of merged.
- Archived references:
  - `C:\Users\SJ\archive\workspace-2026-04-27`
  - `C:\Users\SJ\archive\workspace-pipeline-dashboard-2026-04-27.bundle`
  - GitHub backup branch: `backup/workspace-pre-cleanup-2026-04-27`
- Remote verification:
  - `master` -> `75410a0d512831cbec3ca6afa8009ae849e1af89`
  - `backup/workspace-pre-cleanup-2026-04-27` -> `cbeb94432e99e5bc42a71c43447984f353b37a0e`

### 3.2 Security hardening

The backlog from the archived workspace was reimplemented safely on top of the canonical Phase 2.5 structure rather than merged.

Main outcomes:

- loopback / token / origin protection
- path sandbox strengthening
- child process registry + graceful shutdown

Primary reference:

- `C:\Users\SJ\.claude\plans\security-reimpl-backlog-2026-04-27.md`

### 3.3 Monitor-shell and UI foundation

The UI was reworked toward a hybrid monitor shell rather than a full rewrite.

Main outcomes:

- monitor bootstrap and per-run detail contracts
- monitor store / normalizer / layout / panels
- run tree, agent tree, timeline, inspector, bottom dock
- live bridge from legacy WS into monitor store
- gradual `app.js` decomposition

Primary references:

- [2026-04-27-run-monitor-ui-hybrid-design.md](/C:/Users/SJ/harness-pipeline-analysis/pipeline-dashboard/docs/superpowers/specs/2026-04-27-run-monitor-ui-hybrid-design.md)
- [2026-04-27-five-priority-roadmap.md](/C:/Users/SJ/harness-pipeline-analysis/pipeline-dashboard/docs/superpowers/specs/2026-04-27-five-priority-roadmap.md)

### 3.4 Readiness and CI gating

Readiness moved from an informal script to an actual branch gate.

Main outcomes:

- GitHub Actions CI at repo root
- readiness gate
- scorecard freshness gate
- Node 24-forward CI hygiene

Primary reference:

- [ci.yml](/C:/Users/SJ/harness-pipeline-analysis/.github/workflows/ci.yml)

### 3.5 Remote sandbox design to live deployment proof

This progressed in three steps:

1. Design RFC
2. Implementation RFC
3. R1 + R2 implementation and live deployment evaluation

Main outcomes:

- remote runner auth model
- HKDF-separated JWT / audit keys
- signed audit ledger
- runner registry
- runner HTTP + WS routes
- runner agent
- Docker runner image and SBOM
- live single-runner deployment evaluation

Primary references:

- [remote-sandbox-rfc.md](/C:/Users/SJ/harness-pipeline-analysis/pipeline-dashboard/docs/remote-sandbox-rfc.md)
- [remote-sandbox-impl.md](/C:/Users/SJ/harness-pipeline-analysis/pipeline-dashboard/docs/remote-sandbox-impl.md)
- [2026-04-28-r2-single-runner-eval.md](/C:/Users/SJ/harness-pipeline-analysis/pipeline-dashboard/docs/reports/2026-04-28-r2-single-runner-eval.md)

---

## 4. Key files to open in a new session

Open these in roughly this order:

1. [2026-04-28-project-handoff.md](/C:/Users/SJ/harness-pipeline-analysis/pipeline-dashboard/docs/reports/2026-04-28-project-handoff.md)
2. [scorecard.md](/C:/Users/SJ/harness-pipeline-analysis/pipeline-dashboard/docs/scorecard.md)
3. [2026-04-28-r2-single-runner-eval.md](/C:/Users/SJ/harness-pipeline-analysis/pipeline-dashboard/docs/reports/2026-04-28-r2-single-runner-eval.md)
4. [readiness-rubric.md](/C:/Users/SJ/harness-pipeline-analysis/pipeline-dashboard/docs/readiness-rubric.md)
5. [2026-04-27-five-priority-roadmap.md](/C:/Users/SJ/harness-pipeline-analysis/pipeline-dashboard/docs/superpowers/specs/2026-04-27-five-priority-roadmap.md)
6. `C:\Users\SJ\.claude\plans\swift-waddling-hanrahan.md`
7. `C:\Users\SJ\.claude\plans\security-reimpl-backlog-2026-04-27.md`

If remote-runner work is the immediate focus, also open:

- [remote-hook-bridge-contract.md](/C:/Users/SJ/harness-pipeline-analysis/pipeline-dashboard/docs/remote-hook-bridge-contract.md)
- [src/routes/runnerRoutes.js](/C:/Users/SJ/harness-pipeline-analysis/pipeline-dashboard/src/routes/runnerRoutes.js)
- [src/runtime/runnerRegistry.js](/C:/Users/SJ/harness-pipeline-analysis/pipeline-dashboard/src/runtime/runnerRegistry.js)
- [src/runtime/remoteHookBridgeContract.js](/C:/Users/SJ/harness-pipeline-analysis/pipeline-dashboard/src/runtime/remoteHookBridgeContract.js)
- [src/server/runnerWsAuth.js](/C:/Users/SJ/harness-pipeline-analysis/pipeline-dashboard/src/server/runnerWsAuth.js)
- [src/server/runnerWsHandler.js](/C:/Users/SJ/harness-pipeline-analysis/pipeline-dashboard/src/server/runnerWsHandler.js)
- [src/runner/runnerAgent.js](/C:/Users/SJ/harness-pipeline-analysis/pipeline-dashboard/src/runner/runnerAgent.js)
- [executor/hook-router.js](/C:/Users/SJ/harness-pipeline-analysis/pipeline-dashboard/executor/hook-router.js)

---

## 5. Real-time verification routes

These are the fastest ways for a future AI session to confirm live state.

### 5.1 Git and repository identity

```powershell
Set-Location C:\Users\SJ\harness-pipeline-analysis
git status --short --branch
git rev-parse HEAD
git remote get-url origin
git ls-remote --heads origin master backup/workspace-pre-cleanup-2026-04-27
```

### 5.2 Local quality gates

```powershell
Set-Location C:\Users\SJ\harness-pipeline-analysis\pipeline-dashboard
npm run scorecard:check
npm run readiness:check
npm run test
```

Main script entry points:

- [package.json](/C:/Users/SJ/harness-pipeline-analysis/pipeline-dashboard/package.json)
- [scripts/readiness-report.js](/C:/Users/SJ/harness-pipeline-analysis/pipeline-dashboard/scripts/readiness-report.js)
- [scripts/sync-scorecard.js](/C:/Users/SJ/harness-pipeline-analysis/pipeline-dashboard/scripts/sync-scorecard.js)

### 5.3 CI gate

GitHub Actions workflow:

- [ci.yml](/C:/Users/SJ/harness-pipeline-analysis/.github/workflows/ci.yml)

What it gates:

- unit tests
- integration tests
- legacy tests
- smoke tests
- hook deployment validator
- readiness threshold
- scorecard / rubric freshness

### 5.4 Live R2 deployment evaluation

Files:

- [docker-compose.r2-single-runner.yml](/C:/Users/SJ/harness-pipeline-analysis/pipeline-dashboard/docker-compose.r2-single-runner.yml)
- [docker-compose.r2-strict.override.yml](/C:/Users/SJ/harness-pipeline-analysis/pipeline-dashboard/docker-compose.r2-strict.override.yml)
- `.env.r2.example`
- `.env.r2` (local secret, gitignored)

PowerShell evaluation flow:

```powershell
Set-Location C:\Users\SJ\harness-pipeline-analysis\pipeline-dashboard
Copy-Item .env.r2.example .env.r2
# fill ORCHESTRATOR_TOKEN and RUNNER_BOOTSTRAP_TOKEN

.\scripts\r2-up.ps1
.\scripts\r2-eval.ps1
.\scripts\r2-monitor-probe.ps1
.\scripts\r2-lifecycle-probe.ps1

.\scripts\r2-down.ps1 -Clean

docker compose `
  -f docker-compose.r2-single-runner.yml `
  -f docker-compose.r2-strict.override.yml `
  up -d orchestrator runner probe

.\scripts\r2-probe-egress.ps1
.\scripts\r2-down.ps1 -Clean
```

Shell equivalents also exist:

- `scripts/r2-up.sh`
- `scripts/r2-eval.sh`
- `scripts/r2-monitor-probe.sh`
- `scripts/r2-lifecycle-probe.sh`
- `scripts/r2-probe-egress.sh`
- `scripts/r2-down.sh`

### 5.5 GitHub URLs for quick manual inspection

- Repo root: <https://github.com/SJJ-universe/harness-pipeline>
- App tree: <https://github.com/SJJ-universe/harness-pipeline/tree/master/pipeline-dashboard>
- Commits: <https://github.com/SJJ-universe/harness-pipeline/commits/master>
- Current handoff commit: <https://github.com/SJJ-universe/harness-pipeline/commit/75410a0d512831cbec3ca6afa8009ae849e1af89>
- R2 report URL: <https://github.com/SJJ-universe/harness-pipeline/blob/master/pipeline-dashboard/docs/reports/2026-04-28-r2-single-runner-eval.md>
- Archived workspace backup branch: <https://github.com/SJJ-universe/harness-pipeline/tree/backup/workspace-pre-cleanup-2026-04-27>

---

## 6. Local-only environment notes

### 6.1 PowerShell UTF-8 profile

PowerShell was permanently configured for UTF-8 output to avoid Korean text corruption.

Path:

- `C:\Users\SJ\Documents\WindowsPowerShell\profile.ps1`

### 6.2 Local git excludes

Local-only ignored files are currently:

- `plan-harness-assessment.md`
- `pipeline-dashboard/open-when-ready.bat`

Source:

- `C:\Users\SJ\harness-pipeline-analysis\.git\info\exclude`

### 6.3 Old workspace shell

`C:\Users\SJ\workspace` still exists as an empty directory shell.

- archived contents live under `C:\Users\SJ\archive\workspace-2026-04-27`
- bundle backup lives at `C:\Users\SJ\archive\workspace-pipeline-dashboard-2026-04-27.bundle`

If desired later, the empty shell can be removed safely once no session depends on it.

### 6.4 Current uncommitted draft files

At the moment this handoff file was written, the repo had these uncommitted local files:

- `docs/remote-hook-bridge-contract.md`
- `docs/reports/2026-04-28-project-handoff.md`
- `src/runtime/remoteHookBridgeContract.js`

The two `remoteHookBridgeContract` files appear to be early `R2.5-a` drafts for the remote execution bridge and should be reviewed before any cleanup or commit.

---

## 7. Current product / architecture state

The harness is now in this practical state:

- canonical single local repo
- strong monitor shell with operator-facing run visibility
- readiness and scorecard automation
- CI branch gates
- remote runner subsystem implemented
- single-runner Docker deployment evaluated live

What is intentionally still not complete:

- remote hook -> controlled local executor dispatch
- multi-runner pool
- VM-grade strict isolation
- multi-tenant RBAC

That is why `R2.5` is the correct next round, not `R3`.

---

## 8. Recommended next round

## R2.5 - Remote execution bridge

Recommended order:

1. freeze the remote hook allowlist and payload contract
2. add sanitization + validation in `routeRemote`
3. bridge only approved hooks into constrained local executor paths
4. make runner-claimed runs visible in monitor/run detail flows
5. add live end-to-end Docker proof for dispatch, not just auth
6. refresh readiness / scorecard / report

Why this is next:

- R2 already proved the deployment path
- G4 is still only partial because dispatch is not active
- R3 would multiply complexity before the single-runner execution meaning is complete

After `R2.5`, the next likely round is:

- `R3 - multi-runner pool + stricter host/network validation`

---

## 9. Suggested prompt for a new AI session

Use something close to this:

> Start from `C:\Users\SJ\harness-pipeline-analysis\pipeline-dashboard\docs\reports\2026-04-28-project-handoff.md`.  
> Then verify current state with `git status`, `npm run scorecard:check`, and the linked R2 report.  
> Assume the canonical repo is `C:\Users\SJ\harness-pipeline-analysis` and the next target is `R2.5 remote execution bridge` unless a new instruction overrides it.

---

## 10. Minimal restart checklist

- open this handoff file
- confirm `git status` is clean
- confirm `git rev-parse HEAD`
- open the scorecard
- open the R2 report
- decide whether to start `R2.5` immediately or inspect CI / live eval evidence first
