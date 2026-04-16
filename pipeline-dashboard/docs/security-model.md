# Security Model

## Trust Boundary

This project is a single-user local harness by default. The trusted boundary is the local machine and loopback network interface. Remote access is disabled unless `HARNESS_ALLOW_REMOTE=1` is set.

## API Protection

State-changing API methods (`POST`, `PUT`, `PATCH`, `DELETE`) require `x-harness-token`. The token comes from `HARNESS_TOKEN` or `.harness/local-token`.

The browser gets the token from `/api/auth/token`, which is intended for loopback use only. This preserves local usability while preventing drive-by write requests from untrusted origins.

## Request Validation

Requests are validated at the route boundary:

- event ingestion accepts only allowlisted event types
- hook ingestion accepts only known hook events
- context file loading requires a non-empty string path
- general runs require a non-trivial task and bounded iteration count

## Path Sandbox

File reads and run targets must resolve inside the repository root. Attempts to read outside the root return `403`.

## Dangerous Operations

The danger gate blocks destructive shell patterns and dangerous agent permission flags. It also blocks repo-root escapes and non-read-only Bash in Phase A.

## Remaining Future Hardening

- Replace CDN assets with vendored static files or strict SRI management.
- Add signed append-only manifests for audit integrity.
- Add container sandboxing before enabling remote or team mode.
- Add rate limiting if remote mode is ever enabled.
