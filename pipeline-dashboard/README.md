# Harness Pipeline Dashboard

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
$env:HARNESS_ALLOW_REMOTE="1"
```

## Environment

- `PORT` or `HARNESS_PORT`: server port, default `4201`
- `HARNESS_HOST`: host override, default `127.0.0.1`
- `HARNESS_TOKEN`: optional fixed token for state-changing API requests
- `HARNESS_ALLOW_REMOTE=1`: allow non-loopback clients
- `HARNESS_ALLOW_DANGEROUS_AGENT=1`: allow dangerous agent flags only with explicit confirmation
- `HARNESS_SAMPLE_HOOKS=1`: write hook samples to `fixtures/hooks`

When `HARNESS_TOKEN` is not set, the server creates `.harness/local-token`. The directory is ignored by git.

## Verification

```powershell
npm test
```

This runs unit, integration, legacy phase regression, smoke, and moderate audit checks.

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

- If API writes return `401`, refresh the dashboard so `public/js/api-client.js` can fetch the local harness token.
- If terminal WebSocket closes immediately, confirm the browser loaded `/api/auth/token` and that the server is loopback-bound.
- If hooks do not reach the dashboard, confirm `.claude/settings.json` points at `pipeline-dashboard/hooks/harness-hook.js` and that `HARNESS_PORT` matches the server port.
