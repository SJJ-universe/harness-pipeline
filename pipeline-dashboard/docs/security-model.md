# Security Model

## Trust Boundary

This project is a single-user local harness by default. The trusted boundary is the local machine and the loopback network interface (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`, the entire `127.0.0.0/8` block). Remote access is disabled unless `HARNESS_ALLOW_REMOTE=1` is set explicitly; the auth middleware rejects every non-loopback request even when `HARNESS_HOST=0.0.0.0`.

## Token Auth

State-changing HTTP methods (`POST`, `PUT`, `PATCH`, `DELETE`) require the `x-harness-token` header. The token comes from `HARNESS_TOKEN` (env) or `.harness/local-token` (auto-generated 32-byte hex on first boot, mode `0o600`, ignored by `.gitignore`). `safeEqual` uses `crypto.timingSafeEqual` so token comparison cannot be timed.

The browser fetches the token from `/api/auth/token`, which is loopback-only. Non-loopback callers cannot reach this endpoint, preventing drive-by token disclosure from untrusted origins.

## WebSocket Upgrade Auth (Slice S1, Phase 3-S)

`server.js` runs `verifyWsConnection(req)` at the start of `wss.on("connection")` so BOTH the `/terminal` subpath and the pipeline event WebSocket follow the same policy:

- loopback remote address → always pass (frictionless local dev)
- non-loopback + `HARNESS_ALLOW_REMOTE=0` → close with code 1008 ("non-loopback ws disabled")
- non-loopback + `HARNESS_ALLOW_REMOTE=1` → require valid `?token=…` query param AND (when present) a trusted `Origin` header (loopback or the configured host)

Before this slice the pipeline WS accepted any connection without an auth check, so a remote attacker on an opened-up dashboard could subscribe to broadcasts (tool calls, findings, checkpoints). That gap is closed.

## Request Validation

Every route validates input at the boundary before any work happens:

- event ingestion accepts only allowlisted event types
- hook ingestion accepts only known hook events
- context file loading requires a non-empty string `filePath` and runs through `pathSandbox.resolveInsideRoot(...)` with `mustExist: true`
- general runs require a non-trivial task and bounded iteration count
- **`/api/codex/trigger`** — `triggerId` must match `^[a-zA-Z0-9._-]+$` (Slice S2). The value is interpolated into a filename inside `CODEX_TRIGGER_DIR`, so a slug shape is a hard prerequisite to keep `path.join` from being abused as a traversal vehicle.

## Path Sandbox (Slice S2)

`src/security/pathSandbox.js`:

- `resolveInsideRoot(input, root, { mustExist? })` — runs `realpathIfExists` (uses `fs.realpathSync.native`) so symlinks are resolved before containment is checked. Throws `PathSandboxError` with `code: "PATH_OUTSIDE_ROOT"` when the resolved path escapes.
- Containment is checked with `path.relative` and a Windows-only **case-insensitive double-check** (drive-letter casing edge cases like `C:\X` vs `c:\x` are accepted as the same path).
- Used by `/api/context/discover`, `/api/context/load`, `/api/pipeline/general-run`, `executor/checkpoint.js` (per-run checkpoint paths), and `skill-registry.getSkillContent`.
- `getSkillContent` keeps the slug regex (`^[a-zA-Z0-9._-]+$`) as the first defense layer, then runs `resolveInsideRoot` so a future bypass of the regex would still hit the sandbox + symlink check.

## Child-process Lifecycle (Slice S3-a)

`src/runtime/childRegistry.js` tracks every Codex / Claude spawn so `gracefulShutdown` can:

1. send `SIGTERM` to every active child (immediate)
2. wait `1000ms` grace period
3. send `SIGKILL` to anyone still alive
4. `process.exit(0)`

Before this slice `gracefulShutdown` waited 400ms and exited without sending any signal — long-running 120s+ Codex critiques would either keep running with their parent gone (Linux: zombie) or block the next dashboard start. Per-child `kill` errors (ESRCH on already-dead processes, EPERM on Windows access denied) are swallowed so one zombie cannot block the rest.

## Dangerous Operations

The danger gate (`src/policy/dangerGate.js`) blocks before tool execution:

- destructive shell patterns (`rm -rf /`, `git reset --hard` without args, `git checkout .`, etc.)
- dangerous agent permission flags (`--dangerously-skip-permissions`, etc.)
- repo-root escapes (any `Bash` whose `cwd` or first-argument path resolves outside the repo)
- non-read-only `Bash` in Phase A (Phase A's `bash.mode = "blocked"` plus a tiny read-only allowlist)

## Hardening Backlog

| Item | Status |
|---|---|
| WS upgrade auth gate | **DONE** (Slice S1) |
| Path sandbox on every external file_path entry | **DONE** (Slice S2) |
| Child-process registry + graceful shutdown | **DONE** (Slice S3-a) |
| Codex Windows `shell:true` → `cmd.exe /c` wrapper (Node 24 prep) | **DEFERRED** (S3-b — spawn-behaviour change with too wide a regression surface) |
| Remote sandbox design RFC | **DONE** (Phase D Round MF — see [`remote-sandbox-rfc.md`](./remote-sandbox-rfc.md)) |
| Vendor CDN assets or strict SRI maintenance | TODO |
| Signed append-only audit ledger manifests | TODO (RFC §4 G8) |
| Container sandbox for remote / team mode | TODO — implementation RFC pending (RFC §4 G10) |
| Rate limiting (only relevant if remote mode is ever enabled) | TODO (RFC §2.5) |
