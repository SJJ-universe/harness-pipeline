# Runbook — Pre-Deployment Readiness Check

**Slice PREFLIGHT-CHECKLIST (Phase 2 v2 follow-up, 2026-05-05)**

Run this before tagging a release or shipping a build to end users.
The single command `npm run preflight` orchestrates every gate the
project enforces in CI plus a few informational checks.

The preflight runner is not a substitute for the standard `npm test`
flow during development. It is a release-time aggregator that
combines the **gates** (must-pass) with **informational** checks
(warn-only) into one PASS/FAIL verdict.

---

> **작업 디렉토리 / Working directory**: every command below runs
> from inside the npm package directory `pipeline-dashboard/`.
> Running `npm` from the parent fails with `ENOENT`. **`cd` first**:
>
> ```powershell
> cd C:\path\to\orchestrator-pipeline-analysis\pipeline-dashboard
> ```

## §1 Prerequisites

| Item | Required |
| --- | --- |
| Node.js 24+ on PATH | yes |
| Repository worktree clean (`git status -s` empty) | recommended |
| Loopback ports 4201 (server) and 5099 (readiness throwaway) free | yes |
| Network access for `npm audit --package-lock-only` | recommended |
| Run from a normal terminal (PowerShell / bash / CI runner) | **yes** — sandboxed shells trigger CONFIG-tier exit |

If you are inside a sandboxed shell that cannot spawn child Node
processes (e.g. some CI containers, locked-down dev VMs, or the
Claude Code editor sandbox), the readiness gate will exit 4 (CONFIG)
and preflight will report FAIL. This is **not a regression** — the
score did not drop. Re-run from a normal terminal. See
[`../readiness-rubric.md`](../readiness-rubric.md) §4 + §7.1 for
the exit-code semantics.

## §2 Standard usage

```powershell
cd C:\path\to\orchestrator-pipeline-analysis\pipeline-dashboard
npm run preflight
```

Expected human-readable output:

```text
=== Orchestrator Preflight ===
배포 전 점검 — pre-deployment verification

  [1/5] visual:check                ✓ PASS  (0.1s)
  [2/5] readiness:check             ✓ PASS  (0.4s)   18/18
  [3/5] scorecard:check             ✓ PASS  (34.0s)
  [4/5] verify:hooks                ✓ PASS  (0.0s)
  [5/5] sign-manifest:present(info) ✓ PASS  (0.0s)   tool responds to --help

  Required: 4/4 PASS

  ✅ Ready to deploy.
     모든 필수 점검 통과. 배포 가능합니다.
```

Exit codes:

| Exit | Meaning |
| --- | --- |
| `0` | All required gates PASS — proceed with the release. |
| `1` | At least one required gate FAILED — fix before deployment. |
| `2` | Preflight runner itself errored (not a gate result). |

## §3 Required gates (must PASS)

| Gate | What it verifies | Typical time |
| --- | --- | --- |
| `visual:check` | Visual baselines in `tests/visual/baseline-product-shell.json` are in sync with the current shell. | < 1 s |
| `readiness:check` | The 6-category × 3-star readiness rubric scores ≥ 17/18 in **live mode** (server-spawned). | 1–10 s |
| `scorecard:check` | Auto-derived markers in `docs/scorecard.md` and `docs/readiness-rubric.md` match current test counts and readiness totals. Catches CONFIG-tier readiness exit too. | 30–60 s |
| `verify:hooks` | Orchestrator hook contracts (`.claude/settings.json`, `hooks/orchestrator-hook.js`) deploy correctly to the project. | < 1 s |

If a required gate FAILs, the preflight summary names the gate +
its detail. The most common failures are:

- **readiness:check FAIL with detail "CONFIG: orchestrator server boot failed"** — environment cannot spawn a child Node process. Re-run from a normal terminal.
- **scorecard:check FAIL** — `npm run scorecard:sync` was skipped after the last commit. Run it, commit the markers, and re-run preflight.
- **visual:check FAIL** — UI diverged from baseline. Run `npm run visual:update` after confirming the change is intentional.
- **verify:hooks FAIL** — `.claude/settings.json` is missing or the hook scripts moved. Restore the file or re-deploy hooks.

## §4 Optional and informational gates

### §4.1 `--with-smoke` adds smoke tests

```powershell
cd C:\path\to\orchestrator-pipeline-analysis\pipeline-dashboard
npm run preflight -- --with-smoke
```

Adds the `tests/smoke/` suite (server-boot + cross-process tests).
This adds 60–90 s of execution time but exercises real child
processes, catching regressions that unit tests cannot. Recommended
before a major release; optional for incremental builds.

### §4.2 sign-manifest tooling presence (informational)

The preflight invokes `node scripts/sign-manifest.js --help` to
confirm the manifest-signing tool is reachable. Failure here does
not block deployment but signals that signed releases are not
possible from this checkout.

### §4.3 `npm run audit:moderate` (run separately)

The npm audit gate is **not** part of preflight by default because
its output depends on advisory data freshness. Run it separately
before tagging:

```powershell
cd C:\path\to\orchestrator-pipeline-analysis\pipeline-dashboard
npm run audit:moderate
```

Investigate any moderate or higher advisory before shipping.

## §5 JSON mode for CI integration

```powershell
cd C:\path\to\orchestrator-pipeline-analysis\pipeline-dashboard
node scripts/preflight.js --json
```

Produces a parseable structure:

```json
{
  "preflight": "orchestrator",
  "version": 1,
  "allRequiredPassed": true,
  "passedRequired": 4,
  "totalRequired": 4,
  "failedRequired": 0,
  "withSmoke": false,
  "results": [ /* per-step */ ]
}
```

Each `results[]` entry has `{ name, required, verdict, detail,
elapsedMs, exitCode }`. `verdict` is one of `PASS`, `FAIL`, `WARN`,
`INFO`, or `SKIP`.

## §6 Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `readiness:check` FAIL with `CONFIG` detail | Sandboxed shell, EPERM/EACCES | Re-run from a normal terminal. Score did not drop. |
| `scorecard:check` FAIL after recent commits | Forgot `npm run scorecard:sync` | Run `npm run scorecard:sync`, commit the marker delta, re-run preflight. |
| `visual:check` FAIL after intentional UI change | Baseline not refreshed | `npm run visual:update`, review the JSON delta, commit. |
| `verify:hooks` FAIL after toolchain reinstall | `.claude/settings.json` regenerated | Inspect `verify:hooks` output, restore expected hook paths. |
| `sign-manifest:present` SKIP | Script not found | Confirm `scripts/sign-manifest.js` is committed. |
| Step times out | Network or system-level pressure | Re-run; if persistent, run individual gates manually to isolate. |

## §7 Pre-release sequence

For a tagged release the recommended sequence is:

1. `git status -s` — worktree must be empty (or have only intentional release commits).
2. `npm test` — full suite (unit + integration + legacy + smoke + audit).
3. `npm run preflight -- --with-smoke` — required + smoke gates.
4. `npm run audit:moderate` — review advisories.
5. Inspect `docs/scorecard.md` — confirm the score and trajectory entry are current.
6. Tag the release, push, and verify CI green.

The preflight (step 3) is what tells you "the tree is shippable
right now". Steps 1, 2, 4, 5 are about being deliberate about
*what* you ship.

## §8 References

- [`scripts/preflight.js`](../../scripts/preflight.js) — the orchestrator.
- [`../readiness-rubric.md`](../readiness-rubric.md) — what each readiness category measures + exit-code semantics.
- [`../scorecard.md`](../scorecard.md) — current score and round trajectory.
- [`../../scripts/README.md`](../../scripts/README.md) §1 — the individual gate scripts.
- [`../../tests/README.md`](../../tests/README.md) — what the smoke suite covers.
