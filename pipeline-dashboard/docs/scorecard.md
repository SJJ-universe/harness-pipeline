# Harness Scorecard

## Current Target

The hardening plan targets an internal local harness score of **84/100**.

## Rubric

| Area | Points |
| --- | ---: |
| Pipeline orchestration and phase model | 15 |
| State, artifacts, and quality gates | 15 |
| Dual-agent integration | 10 |
| Directive control and tool gating | 10 |
| Safety and security boundary | 15 |
| Observability and runtime proof | 10 |
| Testability and regression suite | 10 |
| Config, portability, onboarding | 5 |
| UI feedback loop | 5 |
| Maintainability and modularity | 5 |

## Implemented Uplift

- Runtime proof via `/api/version`
- Local token auth for write APIs
- Loopback/default-local host posture
- Path sandbox for context loading and run targets
- Event and hook schema validation
- Phase A Bash removal and policy module
- Danger gate for destructive commands and dangerous agent flags
- Runner manifests through `RunRegistry`
- Hook context usage alarm extraction
- `npm test` wired to unit, integration, legacy, smoke, and audit checks

## Remaining 90+ Work

- Full policy-as-code schema consumed by UI and executor
- Replay mode from hook fixtures and run manifests
- Agent contract declarations for capabilities and forbidden actions
- Self-verification loop that compares completion claims against evidence
- Signed append-only evidence ledger
- Container sandbox for remote/team execution
