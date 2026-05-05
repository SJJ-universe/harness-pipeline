# Harness Pipeline Reference Guide Authoring Plan

**Slice AUTHORING-BLUEPRINT-COMMIT (Phase 2 v2 follow-up, 2026-05-05)** —
this document was previously untracked author-local material and was
reviewed (secret/factual scan) and committed in this slice. It is a
forward-looking blueprint for a future GUIDE-* round series, not a
finished reference book.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `content-production` for prose drafting and `writing-plans` for task-by-task execution. This document is the source blueprint for turning the current Harness Pipeline documentation into a beginner-friendly, developer-useful, public-sector-ready reference book. Follow the checklist structure exactly and keep claim labels current.

**Goal:** Produce a textbook-grade Markdown/PDF guide that explains what Harness Pipeline is, why it exists, how ordinary users use it, how developers operate it, how public-sector security is enforced, and how deployment evidence is collected.

**Architecture:** The guide must be layered. Each major topic starts with a plain-language beginner explanation, then adds operator workflow, developer internals, security/audit notes, and verification commands. The guide must distinguish implemented behavior from live-evidence requirements and future roadmap items.

**Tech Stack:** Markdown source, Mermaid diagrams, local project docs, Node.js command examples, npm scripts, runbook templates, signed manifest tooling, audit/evidence tooling, visual contract tooling.

---

## 1. Current Workspace Baseline

The guide must reflect the project state at the time this plan was written.

### 1.1 Repository State

- Workspace root: the `pipeline-dashboard/` directory at the top of the harness-pipeline checkout (machine-specific path elided).
- Current branch (at time of writing): `master`
- Remote status during inspection: `master...origin/master`
- Worktree during inspection: clean
- Scorecard: `120 / 126`
- Product maturity judgment: field-pilot ready, not yet unrestricted public release ready

### 1.2 Latest Implemented Rounds

The guide must treat the following as implemented unless later repository evidence contradicts them.

| Round | Status | Guide Treatment |
|---|---:|---|
| UI Reference Port Arc | Implemented | Explain Product Shell, Simple/Pro/Legacy modes, visual contract family |
| UI-FirstRun | Implemented | Explain first-run/no-profile/no-auth user guidance |
| SMART-0 | Implemented | Decision context foundation |
| SMART-1 | Implemented | Recommendation cards |
| SMART-2 | Implemented | Policy-backed hard gates, with warn/hard distinction |
| SMART-3 | Implemented | Expert review presets |
| SMART-4 | Implemented | Redacted run memory |
| SMART-5 | Implemented | Institutional policy packs |
| RELEASE-READY-0 | Implemented | Timeout policy, activity watchdog, login guidance |
| SMART-LV-0 | Implemented as probe/tooling | Live verification tool exists; cap movement still requires operator evidence |
| POLICY-UX-0 | Implemented | Policy pack runtime wiring and operator-facing pack catalog API |
| FIELD-PILOT-0 | Implemented as apparatus | 1-week production pilot apparatus exists; actual 1-week evidence remains operator-time |

### 1.3 Important Local Source Documents

Use these as source material before writing or revising prose.

| File | Role |
|---|---|
| `docs/scorecard.md` | Canonical maturity trajectory and implemented round summaries |
| `docs/harness-pipeline-distribution-guide.md` | Existing deployment-oriented guide |
| `docs/harness-pipeline-reference-guide-draft.md` | Existing reference-guide skeleton |
| `docs/visual-contract-governance.md` | UI regression and visual governance policy |
| `docs/runbooks/field-pilot-deployment-log.md` | Field pilot daily log template |
| `docs/runbooks/field-pilot-incident-ledger.md` | Incident ledger template |
| `docs/runbooks/field-pilot-troubleshooting.md` | Field pilot troubleshooting catalog |
| `docs/runbooks/field-pilot-feedback-survey.md` | End-of-week feedback survey |
| `docs/reports/2026-05-05-release-ready-0-eval.md` | Release-ready closeout |
| `docs/reports/2026-05-05-smart-lv-0-eval.md` | SMART live verification closeout |
| `docs/reports/2026-05-05-policy-ux-0-eval.md` | Policy UX closeout |
| `docs/reports/2026-05-05-field-pilot-0-eval.md` | Field pilot apparatus closeout |
| `<author-local>/GUIDE-PART0.md` | Existing theoretical Part 0 (author-local draft, not committed). |
| `<author-local>/GUIDE-PART1.md` | Existing product-definition Part 1 (author-local draft, not committed). |
| `<author-local>/GUIDE-PART2.md` | Existing operator/security Part 2 fragment (author-local draft, not committed). |

### 1.4 Verification Commands

Before claiming guide content is synchronized, run at least these commands from the repository root.

```powershell
git status --short --branch
npm.cmd run visual:check
node scripts/readiness-report.js --json
```

Known caveat: during the 2026-05-05 inspection, `visual:check` passed, but `scorecard:check`/readiness local output did not show full `18/18`. The guide must not claim the local machine currently proves `18/18` unless a fresh run confirms it.

---

## 2. Core Thesis of the Guide

Every version of the guide must converge on this explanation:

> Harness Pipeline does not replace Claude Code or Codex. It adds an operation, control, collaboration, safety, and evidence layer around them. It turns AI CLI work from an invisible terminal session into a visible, reviewable, approvable, auditable workflow.

Use this thesis repeatedly, in different levels of difficulty.

### 2.1 One-Sentence Explanation for Ordinary Users

Harness Pipeline is a dashboard that lets you connect Claude and Codex, watch what they are doing, ask one AI to review the other AI's work, approve risky actions before they happen, and keep a trustworthy record of the whole process.

### 2.2 One-Sentence Explanation for Developers

Harness Pipeline is an orchestration and governance layer for AI coding CLIs, with profile-based spawning, dual-agent review relay, policy gates, PII scanning, run memory, audit ledgers, signed distribution, and visual/readiness verification.

### 2.3 One-Sentence Explanation for Public-Sector Buyers

Harness Pipeline makes AI-assisted work deployable in constrained environments by enforcing sandbox-first execution, PII-aware gates, institution-specific policy packs, signed/offline distribution, and evidence bundles suitable for audit review.

### 2.4 What the Tool Is Not

The guide must clearly state:

- It is not a new foundation model.
- It is not a replacement for Claude, Codex, or their official accounts.
- It is not an automatic guarantee that AI output is correct.
- It is not a real-time token accounting system.
- It is not a substitute for institutional security review.
- It does not ask users to paste Claude/Codex passwords into Harness.

---

## 3. Claim Labels

Every important claim in the guide must be tagged mentally, and high-risk claims should be tagged visibly.

| Label | Meaning | Example |
|---|---|---|
| Implemented | Code and tests exist in the repository | Approval cards use exact tool/args binding |
| Implemented, Evidence Pending | Tooling exists but needs operator-run proof | 1-week production no-regression claim |
| Design Principle | Direction that guides implementation | Default-off and fail-closed posture |
| Future Work | Planned but not shipped | Fully automated account login UI if not implemented |
| Out of Scope | Intentionally excluded | Real-time token usage tracking |

Do not mix these categories. A public-sector reader will treat overstatement as a trust failure.

---

## 4. Target Reader Tracks

The guide must serve five reader types without forcing all of them to read everything.

### 4.1 Absolute Beginner Track

This reader does not know CLI tools, API keys, audit logs, or policy gates.

Required writing style:

- Define every technical term before using it heavily.
- Prefer analogies based on familiar work: dashboard, checklist, approval, receipt, logbook.
- Use short paragraphs.
- Put commands after the explanation, not before.
- Avoid saying "just run" for anything involving terminal commands.

Required beginner sections:

- What is Claude Code?
- What is Codex?
- Why would I use two AI tools together?
- What does Harness add?
- What happens when I press approve?
- Why did the tool block something?
- Where do I see the result?
- What should I do when login is missing?

### 4.2 General Operator Track

This reader runs the tool for daily work.

Required sections:

- First run
- Profile/account setup
- Simple mode dashboard
- Starting a run
- Watching progress
- Reading recommendation cards
- Handling approval cards
- Asking Codex to review Claude's work
- Sending results back to Claude
- Opening recent results
- Exporting evidence

### 4.3 Developer Track

This reader wants internal structure and debugging workflows.

Required sections:

- Server process and routes
- Runner spawn model
- `node-pty` role
- WebSocket event flow
- Store slices
- ReviewSessionManager
- ApprovalManager
- EvidenceLedger
- Policy gates
- Run memory
- Test suites and visual contracts

### 4.4 Public-Sector / Security Track

This reader evaluates risk.

Required sections:

- Sandbox-only model
- Local executor restrictions
- PII inline scan and deep file scan
- Fail-closed behavior
- Human approval for risky tools
- Audit verb vocabulary
- Signed manifest
- Trust store
- Evidence bundle
- Field pilot procedure
- Known limitations and operator responsibilities

### 4.5 Distributor / Maintainer Track

This reader packages and ships the tool.

Required sections:

- Single batch/shell launcher model
- Manifest signing
- Offline install
- OSS notices
- Versioning
- Update checks
- Trust-store handling
- PDF/Markdown guide packaging
- Smoke tests before release

---

## 5. Standard Chapter Template

Every major chapter should follow this structure unless there is a strong reason not to.

```markdown
## N장. Chapter Title

### N.1 한 문장 요약
One short sentence for beginners.

### N.2 왜 필요한가
Explain the problem this feature solves.

### N.3 쉬운 설명
Explain with non-technical language.

### N.4 실제 사용 흐름
Describe what the user sees and clicks.

### N.5 내부 동작
Explain relevant modules, APIs, state flow, and data flow.

### N.6 보안과 감사 관점
Explain what is allowed, blocked, logged, redacted, or signed.

### N.7 확인 방법
List commands, screens, logs, or files that prove the feature works.

### N.8 현재 한계
State limitations without hiding them.

### N.9 관련 파일
List exact repository files.
```

This pattern is important. It lets the same book serve beginners, operators, developers, and auditors.

---

## 6. Recommended Master Table of Contents

The final guide should be larger than the current three guide files. The following structure is recommended.

### Part 0. Foundations

Purpose: explain the engineering ideas behind Harness Pipeline before diving into the product.

Chapters:

1. What is a harness?
2. Control loops and gates
3. Isolation and trust boundaries
4. Observability and audit logs
5. Determinism and reproducibility
6. Cryptographic integrity
7. Operational safety patterns

Source:

- `<author-local>/GUIDE-PART0.md` (author-local draft)

Revision requirement:

- Keep the theoretical depth.
- Add more beginner summaries at the start of every chapter.
- Make every theory chapter point to a concrete Harness feature.

### Part 1. Product Definition

Purpose: explain what the tool is and why it deserves to exist.

Chapters:

1. Harness Pipeline in one page
2. Why plain CLI usage is not enough
3. What Harness adds over Claude Code alone
4. What Harness adds over Codex alone
5. Why two-agent review matters
6. Who should use it
7. Who should not use it yet
8. Current maturity: field-pilot ready

Required conclusion:

> The practical value of Harness Pipeline is not that it makes AI magical. Its value is that it makes AI work visible, controlled, reviewable, repeatable, and auditable.

Source:

- `<author-local>/GUIDE-PART1.md` (author-local draft)
- `docs/scorecard.md`

### Part 2. Getting Started for Ordinary Users

Purpose: make the first 30 minutes understandable for non-developers.

Chapters:

1. What you need before starting
2. Running the batch file
3. Opening the dashboard
4. Connecting Claude and Codex accounts
5. What Harness will never ask you for
6. Simple mode overview
7. First task walkthrough
8. What to do when setup is incomplete
9. Common beginner mistakes

Must include:

- Claude/Codex login is done through their own CLI/auth flows, not by giving Harness a password.
- Harness can guide and detect status, but should not collect provider credentials directly.
- First-run CTA behavior from UI-FirstRun and RELEASE-READY-0.

Source:

- `docs/reports/2026-05-05-release-ready-0-eval.md`
- `public/js/runtime/firstRunClassifier.js`

### Part 3. User Interface and Daily Operation

Purpose: explain the dashboard like a product manual.

Chapters:

1. Simple, Pro, and Legacy modes
2. Product Shell layout
3. Header and status indicators
4. Harness Track animation and progress meaning
5. Pipeline rail
6. Monitor cards
7. Dual agent console
8. Approval card
9. Recommendation cards
10. Run viewer
11. Recent results
12. Accessibility and visual contract guarantees

Must include:

- The UI follows the reference HTML design direction.
- Product Shell is not decorative only; it is a monitoring surface.
- Visual tests are part of product trust.

Source:

- `docs/visual-contract-governance.md`
- `tests/visual/baseline-product-shell.json`
- `public/index.html`
- `public/style.product.css`

### Part 4. Claude and Codex Collaboration

Purpose: explain the dual-agent workflow.

Chapters:

1. Why use two AI agents?
2. Claude-to-Codex critique flow
3. Codex follow-up questions
4. Hand-back to Claude
5. Review sessions
6. Review presets
7. What the operator can see in the dual terminal
8. Limits of automated critique

Must include:

- Review relay is useful because it creates a second perspective.
- It does not guarantee correctness.
- It works best when critique, follow-up, and hand-back are explicit.

Source:

- `src/runtime/reviewSessionManager.js`
- `src/runtime/reviewSpawnDispatcher.js`
- `src/runtime/presetLibrary.js`
- `public/js/monitor/panels/dual-agent-console.js`

### Part 5. Approval, Policy Gates, and Human Control

Purpose: explain how the system controls risky actions.

Chapters:

1. Why approval is necessary
2. Read-only vs write-side tools
3. Exact tuple binding
4. Timeout and fail-closed approval
5. Policy gate modes: warn vs hard
6. `HARNESS_HARD_GATES`
7. State immutability on block
8. Audit events for approvals and gates

Must include:

- Approval is not a broad permission.
- A changed argument requires a new approval.
- Hard gate block must happen before side effects.
- Audit should record one clear event, not duplicate cascades.

Source:

- `<author-local>/GUIDE-PART2.md` (author-local draft)
- `src/approval/approvalManager.js`
- `src/policy/policyGates.js`
- `src/routes/reviewSessionRoutes.js`

### Part 6. Privacy, PII, and Redaction

Purpose: explain personal information protection.

Chapters:

1. What counts as PII?
2. Inline prompt scan
3. Deep file import scan
4. Korean-specific patterns
5. Public-sector block behavior
6. Standard-mode warning behavior
7. Redacted run memory
8. Limits of pattern-based scanning

Must include:

- PII scanning is a defense layer, not a perfect classifier.
- Scanner performance and false positives must be discussed honestly.
- Public-sector mode should prefer fail-closed.

Source:

- `src/security/piiScanner.js`
- `src/routes/securityRoutes.js`
- `src/runtime/runMemory.js`

### Part 7. Public-Sector and Institutional Deployment

Purpose: explain why the tool can make sense in agency or internal-network contexts.

Chapters:

1. Why public-sector AI use is different
2. Sandbox-only execution
3. Local executor blocking
4. Institution-specific policy packs
5. Finance high privacy pack
6. Offline internal network pack
7. Signed manifest requirement
8. Evidence export
9. Operator duties
10. What remains the institution's responsibility

Must include:

- Public-sector mode should not silently downgrade.
- Unknown policy pack must fail closed in production.
- Personal accounts and agency-managed accounts must be discussed separately.

Source:

- `src/policy/policyPackRegistry.js`
- `src/policy/deploymentProfile.js`
- `docs/reports/2026-05-05-policy-ux-0-eval.md`

### Part 8. Release, Installation, and Distribution

Purpose: explain how the tool is packaged and trusted.

Chapters:

1. Why single batch/shell distribution matters
2. Launcher modes
3. Manifest fetch and verification
4. SHA256 verification
5. Ed25519 manifest signing
6. Trust store
7. Offline install
8. Update check policy
9. What a release package should contain
10. Pre-release checklist

Must include:

- Unsigned production install should be treated as unsafe unless explicit dev override is present.
- Trust-store path resolution must be platform-aware.
- Windows AppData, config dir, portable dir, and env override precedence should be clear.

Source:

- `harness-start.bat`
- `harness-start.sh`
- `scripts/launcher/launcher-cli.js`
- `scripts/sign-manifest.js`
- `docs/harness-pipeline-distribution-guide.md`

### Part 9. Long-Running Tasks and Reliability

Purpose: explain why AI work should not be killed just because it takes time.

Chapters:

1. Why AI tasks can take more than 10 minutes
2. Total timeout vs idle timeout
3. Activity watchdog
4. Interactive preset
5. Long-run preset
6. Public-sector preset
7. Idle warning
8. Forced kill conditions
9. Operator troubleshooting

Must include:

- The system distinguishes "slow but active" from "stuck".
- Total cap still exists.
- Idle timer resets on stdout/stderr activity.

Source:

- `src/runtime/timeoutPolicy.js`
- `src/runtime/activityWatchdog.js`
- `executor/codex-runner.js`
- `executor/claude-runner.js`
- `docs/reports/2026-05-05-release-ready-0-eval.md`

### Part 10. Audit, Evidence, and Field Pilot

Purpose: show how trust is proven over time.

Chapters:

1. What is an audit ledger?
2. Audit verb families
3. Evidence bundle
4. HMAC-sealed auditor bundle
5. SMART live verification
6. Field-pilot daily probe
7. Incident ledger
8. Troubleshooting log
9. End-of-week survey
10. External review package

Must include:

- FIELD-PILOT-0 is evidence apparatus, not evidence completion.
- Actual cap movement requires real operator deployment evidence.
- External reviewers should receive claim/evidence matrix, daily probes, incident ledger, and release metadata.

Source:

- `src/runtime/evidenceLedger.js`
- `src/runtime/auditorBundle.js`
- `scripts/live-verify-smart-arc.js`
- `scripts/field-pilot-status.js`
- `docs/runbooks/*.md`

### Part 11. Developer Internals

Purpose: provide a technical reference.

Chapters:

1. Server architecture
2. Route map
3. Runner model
4. WebSocket stream model
5. Store slices
6. Policy modules
7. Security modules
8. Runtime modules
9. Test architecture
10. How to add a new feature safely

Must include:

- File-level references.
- Module responsibility boundaries.
- Common extension mistakes.

Source:

- `server.js`
- `src/routes`
- `src/runtime`
- `src/security`
- `src/policy`
- `public/js/monitor`
- `tests/unit`
- `tests/integration`
- `tests/smoke`

### Part 12. Open Source, Licenses, and Supply Chain

Purpose: make OSS usage understandable to non-lawyers and useful to reviewers.

Chapters:

1. Why OSS disclosure matters
2. Direct dependencies
3. Transitive dependency inventory
4. Express
5. ws
6. node-pty
7. axe-core
8. Playwright Core
9. Node.js built-in modules
10. License summary
11. Security update policy
12. Third-party notices

Must include:

- This section is not legal advice.
- State exact versions from `package-lock.json`.
- Explain what each dependency does in this product.

Source:

- `package.json`
- `package-lock.json`
- `docs/harness-pipeline-distribution-guide.md`

### Part 13. Troubleshooting and FAQ

Purpose: help users recover without needing a developer.

Chapters:

1. Server does not start
2. Dashboard does not open
3. Claude/Codex not detected
4. Login guidance
5. Approval card does not resolve
6. PII blocked my action
7. Policy pack blocks an action
8. Long task appears stuck
9. Evidence export fails
10. Manifest signature fails
11. Readiness check is not 18/18
12. Visual check fails

Must include:

- Symptoms
- Likely causes
- Safe workaround
- What not to do
- Which log or command to collect

Source:

- `docs/runbooks/field-pilot-troubleshooting.md`
- `scripts/readiness-report.js`
- `scripts/visual-baseline-update.js`

---

## 7. Content Style Rules

### 7.1 General Rules

- Write in Korean by default.
- Keep technical identifiers in English when they are code names.
- Define terms once, then reuse consistently.
- Prefer concrete examples over abstract assurances.
- Do not hide limitations.
- Do not claim live deployment success until evidence exists.
- Do not claim official endorsement by Claude, Anthropic, OpenAI, or Codex.
- Do not claim real-time token tracking.

### 7.2 Beginner Prose Rules

Beginner sections must sound like patient instruction, not developer shorthand.

Avoid:

- "그냥 CLI에서 실행하면 됩니다."
- "토큰을 넣으면 됩니다."
- "로그를 확인하세요."
- "권한 문제입니다."

Prefer:

- "이 화면은 현재 연결 상태를 보여줍니다."
- "Harness는 비밀번호를 직접 받지 않습니다."
- "이 버튼은 Claude 또는 Codex의 공식 로그인 흐름으로 이동하도록 돕습니다."
- "차단은 오류가 아니라 안전장치일 수 있습니다."

### 7.3 Developer Prose Rules

Developer sections may use code names, but must include responsibility boundaries.

Example:

```markdown
`ApprovalManager`는 승인 상태와 TTL을 관리한다. 실제 도구 실행 허용 여부는 `HookRouter` 또는 route-level policy gate가 이 결과를 소비해 결정한다. 따라서 승인 저장소를 바꿀 때 도구 실행 경로까지 함께 느슨하게 만들면 안 된다.
```

### 7.4 Public-Sector Prose Rules

Public-sector sections must be conservative.

Required wording pattern:

- "이 기능은 위험을 줄인다" rather than "이 기능은 위험을 없앤다"
- "운영 증거가 필요하다" rather than "검증 완료"
- "기관 정책에 맞춰 확인해야 한다" rather than "모든 기관에서 사용 가능"

---

## 8. Diagrams Required

Use Mermaid diagrams. Keep diagrams simple enough to render in Markdown/PDF.

### 8.1 Overall Architecture

Must show:

- Browser dashboard
- Server
- Claude runner
- Codex runner
- Approval manager
- Policy gates
- PII scanner
- Evidence ledger
- Signed manifest

### 8.2 First-Run Flow

Must show:

- Start launcher
- Server boot
- Provider probe
- Profile state
- Login guidance
- Ready state

### 8.3 Review Relay Flow

Must show:

- Claude work
- Send to Codex
- Codex critique
- Follow-up
- Hand-back to Claude
- Audit events

### 8.4 Approval and Gate Order

Must show:

- Request
- PII scan
- Policy gate
- Approval request
- Dispatch
- Audit
- Block path with state unchanged

### 8.5 Evidence Lifecycle

Must show:

- Run event
- EvidenceLedger append
- Run viewer
- Export bundle
- Offline verify
- Field pilot daily snapshot
- External review

---

## 9. Documentation Work Rounds

The next writer should not attempt the entire book in one commit. Use these rounds.

### GUIDE-SYNC-0: Fact Register and Claim Matrix

**Goal:** Create a synchronized fact table so the guide stops drifting from the code.

**Files:**

- Create: `docs/guide-claim-register.md`
- Modify: `docs/harness-pipeline-reference-guide-draft.md`

**Required content:**

- Feature name
- Status label
- Source file
- Test/report evidence
- User-facing explanation
- Security/audit note

**Acceptance:**

- Every major feature from `docs/scorecard.md` current top section appears in the claim register.
- Every feature marked future work in existing docs is reviewed and reclassified.

### GUIDE-BEGINNER-1: Absolute Beginner Opening

**Goal:** Write the first-reader path.

**Files:**

- Modify or create final guide Part 1/2 files.

**Required content:**

- What this tool is
- Why it exists
- What users need before starting
- How account connection works
- What Harness will never ask for
- First successful run story

**Acceptance:**

- A non-developer can understand the first-run path without knowing what `node`, `npm`, or `CLI` means.

### GUIDE-OPERATOR-2: UI and Daily Workflow

**Goal:** Explain the dashboard as a product.

**Required content:**

- Simple/Pro/Legacy mode
- Product Shell regions
- Recommendation cards
- Approval cards
- Dual agent console
- Run viewer
- Export flow

**Acceptance:**

- Each visible major UI region has a purpose, user action, and troubleshooting note.

### GUIDE-SECURITY-3: Public-Sector and Privacy Volume

**Goal:** Produce the security-facing chapters.

**Required content:**

- Sandbox-only enforcement
- PII scanner depth
- Public-sector mode
- Policy packs
- Hard gates
- Signed manifests
- Evidence bundles
- Known limitations

**Acceptance:**

- The chapter does not overpromise.
- It states which claims require field evidence.

### GUIDE-DEV-4: Internal Architecture Volume

**Goal:** Produce the developer reference.

**Required content:**

- Server route map
- Runtime modules
- Runner model
- Store slices
- WebSocket events
- Audit verb families
- Testing strategy

**Acceptance:**

- A developer can locate the relevant file for each major feature.

### GUIDE-RELEASE-5: Distribution and OSS Volume

**Goal:** Produce the package/release-facing chapters.

**Required content:**

- Batch/shell launcher
- Manifest signing
- Trust store
- Offline install
- OSS dependency explanation
- Third-party notices process
- Release checklist

**Acceptance:**

- A distributor can assemble a release packet and know what to verify before sharing it.

### GUIDE-PILOT-6: Field Pilot and External Review Volume

**Goal:** Turn field-pilot apparatus into a readable operator/auditor procedure.

**Required content:**

- Daily status probe
- Deployment log
- Incident ledger
- Troubleshooting updates
- Feedback survey
- External review packet
- Cap movement evidence

**Acceptance:**

- A third-party reviewer can understand what evidence to request and how to read it.

### GUIDE-PDF-7: Publication Pass

**Goal:** Make Markdown and PDF distribution-ready.

**Required content:**

- Front matter
- Version page
- Reader path page
- Table of contents
- Glossary
- Appendix
- OSS notices
- Verification checklist

**Acceptance:**

- Markdown links are valid.
- Diagrams render.
- Commands are current.
- Claims are labeled.
- PDF export has no broken section order.

---

## 10. Required Quality Gates for Guide Changes

Run these checks after substantial guide updates from the repository root.

```powershell
git diff -- docs
npm.cmd run visual:check
node scripts/readiness-report.js --json
```

If guide changes touch code examples or command names, also run targeted `rg` checks.

```powershell
rg -n "HARNESS_HARD_GATES|HARNESS_DEPLOYMENT_PROFILE|HARNESS_TIMEOUT_PRESET|live-verify-smart-arc|field-pilot-status" docs
rg -n "real-time token|token usage|officially endorsed|guarantee" docs
```

The second command is a risk scan. It should catch overclaims and excluded-scope language.

---

## 11. Specific Gaps in Existing Guide Files

### 11.1 `GUIDE-PART0.md`

Strengths:

- Strong theoretical foundation.
- Good fit for textbook-style introduction.

Gaps:

- Needs more beginner summaries inside each theory chapter.
- Needs more explicit mapping from theory to current implemented features.
- Should mention signed manifest, evidence bundle, visual contract, and field pilot as examples of theory in practice.

### 11.2 `GUIDE-PART1.md`

Strengths:

- Good product-definition structure.
- Already explains why the tool exists.

Gaps:

- Must update maturity language to include SMART arc, release-ready, policy UX, and field-pilot apparatus.
- Must add the core product thesis in plain language.
- Must clearly state "field-pilot ready" rather than unrestricted "production ready".

### 11.3 `GUIDE-PART2.md`

Strengths:

- Good detailed treatment of approval and PII.
- Already uses implementation-aware language.

Gaps:

- Needs UI chapters before deep approval/PII chapters.
- Needs recommendation cards, presets, policy packs, run memory, timeout/watchdog, and field pilot chapters.
- Must align approval timeout discussion with central timeout policy so readers do not confuse approval TTL with runner task timeout.

### 11.4 `docs/harness-pipeline-distribution-guide.md`

Strengths:

- Broad deployment-facing outline.
- Includes OSS dependency inventory.

Gaps:

- SMART arc items are still partly described as future work.
- Needs update after RELEASE-READY-0, SMART-LV-0, POLICY-UX-0, FIELD-PILOT-0.
- Needs stronger fail-closed language for unsigned production manifest.
- Needs a field-pilot/external-review chapter.

### 11.5 `docs/harness-pipeline-reference-guide-draft.md`

Strengths:

- Good skeleton for the eventual book.
- Already includes "additional writing needed" markers.

Gaps:

- It is an outline, not a finished reference.
- Needs claim register integration.
- Needs concrete beginner prose and full developer references.

---

## 12. Distribution Packet Recommendation

The final documentation package should include:

- `HARNESS-PIPELINE-GUIDE.md`
- `HARNESS-PIPELINE-GUIDE.pdf`
- `QUICKSTART.md`
- `PUBLIC-SECTOR-SECURITY.md`
- `OPERATOR-RUNBOOK.md`
- `DEVELOPER-REFERENCE.md`
- `THIRD-PARTY-NOTICES.md`
- `FIELD-PILOT-RUNBOOK.md`
- `RELEASE-CHECKLIST.md`

The long guide can remain a single book, but the release packet should also include shorter role-specific entry documents.

---

## 13. Final Editorial Checklist

Before calling the guide complete, verify:

- [ ] The first 10 pages make sense to an absolute beginner.
- [ ] The first-run account flow is clear and does not ask for provider passwords.
- [ ] Claude and Codex are described as external tools/accounts, not bundled AI models.
- [ ] The dual-agent review value is clear.
- [ ] Public-sector mode is explained conservatively.
- [ ] PII scanner limitations are stated.
- [ ] Hard gates and approval cards are not conflated.
- [ ] Runner timeout and approval timeout are not conflated.
- [ ] Field-pilot apparatus and actual field-pilot evidence are separated.
- [ ] Token usage tracking is listed as out of scope.
- [ ] OSS dependency table is updated from `package-lock.json`.
- [ ] Manifest signing instructions are current.
- [ ] Trust-store path rules are platform-aware.
- [ ] Every command shown in the guide was recently checked or marked illustrative.
- [ ] Every future item is clearly labeled as future work.
- [ ] The guide includes an external-review evidence checklist.

---

## 14. Recommended Next Work

Start with `GUIDE-SYNC-0`. The current guide drafts are useful, but they are behind the codebase. A fact register prevents the next prose pass from becoming a beautiful but stale book.

After `GUIDE-SYNC-0`, write the beginner path before the developer internals. This keeps the guide anchored in the product's public distribution goal: ordinary users and public-sector operators must understand why the tool exists before they are asked to trust the architecture.

