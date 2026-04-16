# Harness Scorecard

## Current Score

**87/100** (v3.1 hardening complete, UI integration in progress)

Target after UI integration: **91~92/100**

## Rubric

| Area | Points | Current |
| --- | ---: | ---: |
| Pipeline orchestration and phase model | 15 | 13 |
| State, artifacts, and quality gates | 15 | 13 |
| Dual-agent integration | 10 | 9 |
| Directive control and tool gating | 10 | 9 |
| Safety and security boundary | 15 | 13 |
| Observability and runtime proof | 10 | 8 |
| Testability and regression suite | 10 | 9 |
| Config, portability, onboarding | 5 | 4 |
| UI feedback loop | 5 | 4 |
| Maintainability and modularity | 5 | 5 |

## Implemented (v3.1 Hardening)

- Runtime proof via `/api/version` with policy hash
- Local token auth for write APIs
- Loopback/default-local host posture
- Path sandbox for context loading and run targets
- Event and hook schema validation
- Phase A Bash removal and policy module
- Danger gate for destructive commands and dangerous agent flags
- Runner manifests through `RunRegistry`
- Hook context usage alarm extraction
- `npm test` wired to unit, integration, legacy, smoke, and audit checks
- **Policy-as-Code** (`policies/default-policy.json`, JSON Schema, structural lint)
- **Replay mode** (`src/runtime/replay.js`, `fixtures/hooks/`)
- **Agent contracts** (`contracts/default-agent-contracts.json`, runtime enforcement in PipelineExecutor)
- **Self-verification loop** (`src/verification/claimVerifier.js`, integrated into pipeline completion)
- **Evidence ledger with hash chain** (`src/runtime/evidenceLedger.js`, tamper-evident JSONL)
- **Route extraction** (9 route modules, server.js thin bootstrap)
- **Hook fast path** (fire-and-forget for safe tools, pipeline timeout, broadcast throttle)

## Implemented (UI Integration)

- Fake demo pipeline (`runPipeline()`) removed, `/api/run` returns 410 Gone
- `code-review` template enhanced with operational metadata (agent, allowedTools, exitCriteria, cycle)
- 6 missing event handlers added (context_alarm, claim_verification_failed, etc.)
- Dead code cleanup (safeRender.js, unused CSS, hardcoded badge map)
- Node rendering converted to DOM API with agent/tool metadata tags
- `tool_blocked` events now display gating layer source (DangerGate/PhasePolicy/AgentContract/AllowedTools)
- Phase modals show operational metadata (agent, tools, criteria, cycle info)
- Compact horizontal pipeline mode (toggle)
- Context window pressure bar and verification status card
- Quality gate failures shown as individual tool-feed entries

## Remaining Work

- Container sandbox for remote/team execution (design docs in `docs/`)
- Convert `runGeneralPipeline()` to hook-driven execution
- `api-client.js` expansion to domain API client
- `testing` template operational metadata
