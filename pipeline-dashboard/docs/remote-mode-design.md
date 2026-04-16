# Remote/Team Mode Design

## Current Security Posture

- Default host: `127.0.0.1` (loopback only)
- `HARNESS_ALLOW_REMOTE=1` required for network exposure
- Token auth via `x-harness-token` header
- `/api/auth/token` endpoint returns token (loopback-gated)
- WebSocket terminal authenticates via `?token=` query parameter

## Threat Model

### Pre-conditions
- Remote mode enabled via environment variable
- Server exposed on `0.0.0.0`

### Threats
1. **Token bootstrap over HTTP**: `/api/auth/token` returns the write token to any caller when `ALLOW_REMOTE=1`. Remote attacker can fetch token and escalate to all state-changing APIs.
2. **Terminal full shell access**: Terminal WebSocket spawns a real shell with inherited env. Token in URL leaks via browser history, referrer headers, access logs.
3. **Event WebSocket unauthenticated**: Pipeline event WebSocket accepts all connections without token validation. Passive eavesdropping on phase/tool/finding data.
4. **No rate limiting**: Hook endpoint and API endpoints have no request rate enforcement.

## Required Upgrades (before enabling remote)

1. **Session auth**: Replace token bootstrap with pre-configured secret. Never mint/disclose tokens over HTTP.
2. **TLS termination**: Require HTTPS for remote connections (reverse proxy or built-in).
3. **WebSocket auth**: Require token on event WebSocket upgrade, not just terminal.
4. **Terminal isolation**: Disable terminal in remote mode, or containerize with restricted env.
5. **Rate limiting**: Add `src/security/rateLimit.js` with per-IP request limits.
6. **Audit logging**: Log all remote API access with IP, timestamp, endpoint.

## Migration Path

1. Phase 1: Keep remote disabled (current)
2. Phase 2: Implement session auth + WebSocket auth + rate limiting
3. Phase 3: Add container sandbox for runners
4. Phase 4: Enable remote mode behind feature flag with monitoring
