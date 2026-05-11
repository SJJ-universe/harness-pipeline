# Scripts Index

**Slice SCRIPTS-INDEX-1 (Phase 2 v2 follow-up, 2026-05-05)**

This directory holds every operator-invocable and CI-invocable
script. The orchestrator uses scripts as the primary public surface for
operations work — `npm run readiness:check`, `npm run scorecard:sync`,
`scripts/r2-up.sh`, etc.

Cross-platform tools ship as a triplet: a `.js` file with the logic,
plus `.sh` and `.ps1` thin wrappers for shell-friendly invocation.
Where only one platform is needed (e.g. Windows-only diagnostics),
the missing wrappers are intentional, not oversights.

---

## §1 Quality, readiness, and CI gates

Used by `npm test`, `npm run readiness:check`, and the GitHub Actions
gate. Every PR touches at least one of these indirectly.

| Script | Purpose | Run via |
| --- | --- | --- |
| [`readiness-report.js`](readiness-report.js) | The 18-star readiness rubric runner. Spawns a throwaway server in live mode. | `npm run readiness:check` |
| [`sync-scorecard.js`](sync-scorecard.js) | Auto-derive test counts + readiness totals into the scorecard markers. | `npm run scorecard:sync` / `:check` |
| [`validate-hook-deployment.js`](validate-hook-deployment.js) | Verify the orchestrator hook contracts ship correctly. | `npm run verify:hooks` |
| [`compute-sri.js`](compute-sri.js) | Compute Subresource Integrity hashes for static asset references. | `npm run sri:print` |
| [`visual-baseline-update.js`](visual-baseline-update.js) | Refresh / check the visual regression baselines. | `npm run visual:update` / `:check` |
| [`preflight.js`](preflight.js) | Pre-deployment health check — runs every required gate (visual / readiness / scorecard / hooks) plus optional smoke. See [`docs/runbooks/deployment-readiness.md`](../docs/runbooks/deployment-readiness.md). | `npm run preflight` |

## §2 External review & audit

For external reviewers receiving a sealed evidence bundle, and for
internal verification of bundle integrity.

| Script | Purpose |
| --- | --- |
| [`external-review-bundle.js`](external-review-bundle.js) | Build a sealed external-review evidence bundle (with `.sh` + `.ps1` wrappers). |
| [`verify-auditor-bundle.js`](verify-auditor-bundle.js) | Verify a received auditor bundle's integrity — HMAC chain check, SHA256 verification. |
| [`sign-manifest.js`](sign-manifest.js) | Sign a release manifest with Ed25519 (E3-F1 launcher trust gate). |

## §3 Setup & first-run launcher

For new operators booting the orchestrator for the first time + for
ongoing version management.

| Script | Purpose |
| --- | --- |
| [`setup-wizard.js`](setup-wizard.js) | First-run interactive wizard (with `.sh` + `.ps1` wrappers). |
| [`launcher/launcher-cli.js`](launcher/launcher-cli.js) | Launcher CLI: install / verify / update orchestration. |
| [`launcher/install-version.sh`](launcher/install-version.sh) / [`.ps1`](launcher/install-version.ps1) | Per-platform install script invoked by `orchestrator-start`. |
| [`launcher/check-update.sh`](launcher/check-update.sh) / [`.ps1`](launcher/check-update.ps1) | Manifest update polling (read-only — never auto-installs). |
| [`launcher/trust-store-path.js`](launcher/trust-store-path.js) | Path resolver shared with the server-side trust-store runtime. |
| [`launcher/manifest.json.example`](launcher/manifest.json.example) | Reference shape for a release manifest. |

## §4 R2 single-runner evaluation orchestrator

Live-verification probes for the R2 single-runner deployment. These
are NOT part of `npm test` — they are operator-runnable on demand.

| Script | Purpose |
| --- | --- |
| [`r2-up.sh`](r2-up.sh) / [`r2-up.ps1`](r2-up.ps1) | Bring up the R2 docker-compose stack. |
| [`r2-down.sh`](r2-down.sh) / [`r2-down.ps1`](r2-down.ps1) | Tear down the R2 stack (with optional `--clean`). |
| [`r2-eval.sh`](r2-eval.sh) / [`r2-eval.ps1`](r2-eval.ps1) | Full chain probe: handshake → ws → audit. |
| [`r2-monitor-probe.sh`](r2-monitor-probe.sh) / [`r2-monitor-probe.ps1`](r2-monitor-probe.ps1) | Verify monitor metadata round-trip (G5). |
| [`r2-lifecycle-probe.sh`](r2-lifecycle-probe.sh) / [`r2-lifecycle-probe.ps1`](r2-lifecycle-probe.ps1) | Workspace lifecycle: tmpfs / no leak / reconnect. |
| [`r2-probe-egress.sh`](r2-probe-egress.sh) / [`r2-probe-egress.ps1`](r2-probe-egress.ps1) | Strict-mode egress isolation probe. |
| [`r2-5-bridge-probe.sh`](r2-5-bridge-probe.sh) / [`r2-5-bridge-probe.ps1`](r2-5-bridge-probe.ps1) | Execution bridge live verification (R2.5). |

## §5 Live verification (operator-runnable)

For operator-driven live verification with real Claude/Codex
binaries. Each lives independently — pick the one matching the
property you want to verify.

| Script | Purpose |
| --- | --- |
| [`live-verify-review-relay.js`](live-verify-review-relay.js) | Dual-agent review-relay live probe (with `.sh` + `.ps1` wrappers). |
| [`live-verify-smart-arc.js`](live-verify-smart-arc.js) | SMART arc live probe (with `.sh` + `.ps1` wrappers). |
| [`collect-live-evidence.js`](collect-live-evidence.js) | Aggregate the two probe outputs into a single sealed bundle (schema `orchestrator-live-evidence-bundle/v1`). See [`docs/live-evidence-schema.md`](../docs/live-evidence-schema.md) §4. |

## §6 Field pilot

Operator probes run during a field-pilot deployment.

| Script | Purpose |
| --- | --- |
| [`field-pilot-status.js`](field-pilot-status.js) | Field-pilot status snapshot (with `.sh` + `.ps1` wrappers). |

## §7 Visual probes (live)

Live capture / assertion / accessibility / button / fused screenshots
of the dashboard against a running server. Run on demand to debug
visual issues; not part of CI.

| Script | Purpose |
| --- | --- |
| [`visual-capture-live.js`](visual-capture-live.js) | Capture the running dashboard. |
| [`visual-assert-live.js`](visual-assert-live.js) | Assert against captured baseline. |
| [`visual-a11y-live.js`](visual-a11y-live.js) | Accessibility audit of the running dashboard. |
| [`visual-button-live.js`](visual-button-live.js) | Specific button-level visual checks. |
| [`visual-fused-live.js`](visual-fused-live.js) | Fused capture (combines multiple variants). |

## §8 Build & diagnostics

| Script | Purpose |
| --- | --- |
| [`build-runner.sh`](build-runner.sh) / [`build-runner.ps1`](build-runner.ps1) | Build the orchestrator-runner Docker image. |
| [`env-check.ps1`](env-check.ps1) | Windows environment diagnostic (Node version, PATH, prerequisites). |

---

## §9 Cross-platform script convention

Each cross-platform script ships as up to three files with the
same base name:

| Suffix | Role | Notes |
| --- | --- | --- |
| `.js` | The logic | Required when the implementation is non-trivial. |
| `.sh` | POSIX wrapper | Bash thin wrapper for Linux/Mac/Git Bash. Sets up env, then `node <base>.js "$@"`. |
| `.ps1` | Windows wrapper | PowerShell thin wrapper. Same env-setup → node passthrough. |

The wrappers are deliberately minimal — they only handle path
resolution + env setup. All meaningful behavior lives in the `.js`.
This keeps the surface area small and avoids drift between platforms.

When a script exists only as `.ps1` (e.g. [`env-check.ps1`](env-check.ps1)),
it is intentionally Windows-only and not a portability gap.

## §10 References

- Project-root [`README.md`](../README.md) — quick-start, environment, npm scripts.
- [`docs/README.md`](../docs/README.md) — documentation index.
- [`tests/README.md`](../tests/README.md) — test-suite layout (the visual-baseline + readiness scripts feed into the test surfaces described there).
- [`docs/readiness-rubric.md`](../docs/readiness-rubric.md) — what `readiness-report.js` is measuring.
- [`docs/scorecard.md`](../docs/scorecard.md) — what `sync-scorecard.js` writes into.
