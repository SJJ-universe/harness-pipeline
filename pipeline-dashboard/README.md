# Orchestrator Pipeline Dashboard

Local-first dashboard for orchestrating Claude/Codex phase pipelines with policy gates, runtime proof, and regression tests.

## Quick Start

```powershell
npm install
npm start
```

Default URL:

```text
http://127.0.0.1:4201
```

The server binds to `127.0.0.1` by default. Remote binding requires:

```powershell
$env:ORCHESTRATOR_ALLOW_REMOTE="1"
```

## Environment

- `PORT` or `ORCHESTRATOR_PORT`: server port, default `4201`
- `ORCHESTRATOR_HOST`: host override, default `127.0.0.1`
- `ORCHESTRATOR_TOKEN`: optional fixed token for state-changing API requests
- `ORCHESTRATOR_ALLOW_REMOTE=1`: allow non-loopback clients
- `ORCHESTRATOR_ALLOW_DANGEROUS_AGENT=1`: allow dangerous agent flags only with explicit confirmation
- `ORCHESTRATOR_SAMPLE_HOOKS=1`: write hook samples to `fixtures/hooks`

When `ORCHESTRATOR_TOKEN` is not set, the server creates `.harness/local-token`. The directory is ignored by git.

## Verification

```powershell
npm test
```

This runs unit, integration, legacy phase regression, smoke, and moderate audit checks.

## Documentation

This README covers quick-start. For everything else, three sub-directory indexes are the entry points:

- [`docs/README.md`](docs/README.md) — long-form documentation: architecture, security, operator guides, RFCs, status reports.
- [`tests/README.md`](tests/README.md) — test-suite layout: where each suite lives, where new tests go, speed budgets, stability rules.
- [`scripts/README.md`](scripts/README.md) — operator/CI scripts: readiness, scorecard sync, external review, R2 evaluation, live verification, visual probes.

A new contributor reading these three in order — docs → tests → scripts — has the full operator surface area in mind. Each is independently navigable; you do not need to read them in sequence.

## Runtime Proof

`GET /api/version` returns:

- current git sha
- boot time
- Node version
- template hash
- policy hash
- repo root
- local/remote mode

Use it to confirm the browser is connected to the expected runtime, not a stale server.

## Troubleshooting

- If API writes return `401`, refresh the dashboard so `public/js/api-client.js` can fetch the local orchestrator token.
- If terminal WebSocket closes immediately, confirm the browser loaded `/api/auth/token` and that the server is loopback-bound.
- If hooks do not reach the dashboard, confirm `.claude/settings.json` points at `pipeline-dashboard/hooks/orchestrator-hook.js` and that `ORCHESTRATOR_PORT` matches the server port.
