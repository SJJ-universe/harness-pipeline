# Test Suite Layout

**Slice TESTS-LAYOUT-1 (Phase 2 v2 follow-up, 2026-05-05)**

This document explains how the test suites are organised and where
new tests should go. Read it before adding a test, and after running
into a failure that surprises you — the audience tag at each level
explains *why* the layout looks the way it does.

The runner is the small [`run-tests.js`](run-tests.js) helper. It
walks a directory, collects every `*.test.js` file, and requires
them in order. There is no test-framework wrapper around `node:test`
— the suites speak `node:test` natively.

## §1 The four primary suites

The standard `npm test` runs four suites in sequence, in this exact
order:

| Suite | Directory | Speed | Stops on first fail? | Purpose |
| --- | --- | --- | --- | --- |
| **unit** | `tests/unit/` | fast (≤ 15s) | no — runs all | Pure-function and module-internal behavior. |
| **integration** | `tests/integration/` | medium (≤ 60s) | no — runs all | Multi-module flows: routes + state + manager. Boots Express handlers but no real network. |
| **legacy** | `executor/__phase{2,3,4}-test.js` | slow (≤ 30s) | yes — phase order matters | Phase pipeline regression — kept exactly as the original implementation tested itself. |
| **smoke** | `tests/smoke/` | medium (≤ 90s) | no — runs all | Server-boot + cross-process tests. Spawns child Node processes. |

Plus auxiliary suites that run on demand:

| Suite | Directory / runner | Purpose |
| --- | --- | --- |
| **visual** | `tests/visual/` + `scripts/visual-baseline-update.js` | Visual regression baselines for the dashboard shell. |
| **readiness** | `scripts/readiness-report.js` | Operational rubric — see [`docs/readiness-rubric.md`](../docs/readiness-rubric.md). |
| **hook deployment** | `scripts/validate-hook-deployment.js` | Verifies the harness hook contracts ship correctly. |

## §2 Where does my new test go?

A decision tree. Walk it from the top.

1. **Is the test about a single module's pure logic?** → `tests/unit/`.
   - Examples: `recommendationEngine.test.js`, `i18n.coverage.test.js`,
     `monitor.store.test.js`. The unit directory is the largest by file
     count and the easiest to add to — most rounds add 1+ unit test files.
2. **Does the test exercise an HTTP route or WebSocket flow that
   requires multiple modules cooperating?** → `tests/integration/`.
   - Examples: `monitor-routes.test.js`, `review-relay-spawn.test.js`,
     `runner-server-wiring.test.js`. Integration tests typically spin
     up an Express handler and drive it with real `http`/`fetch` calls
     against a `127.0.0.1:0` ephemeral port.
3. **Does the test require an actual `node server.js` process to
   boot?** → `tests/smoke/`.
   - Examples: server-info smoke probes, ProviderProbe live checks.
     Use sparingly — every smoke test adds boot latency to CI.
4. **Is the test about a phase-pipeline transition that the legacy
   harness used to verify?** → leave it in `executor/__phase{2,3,4}-test.js`.
   - These three files are intentionally kept in the format the
     original phase pipeline used. New phase tests should go in
     `tests/integration/` instead — the legacy files are a
     compatibility shim.
5. **Is the test a visual baseline (rendered DOM/CSS)?** → use
   `npm run visual:update` to refresh the JSON in `tests/visual/`.
   - Don't write `*.test.js` files in `tests/visual/`. The directory
     stores baselines, not test runners.

## §3 The doc-test pattern

Several documentation files have structural tests that fail loud
when sections are renamed or deleted. They follow a consistent
naming convention:

| Doc | Structural test |
| --- | --- |
| [`docs/i18n-conventions.md`](../docs/i18n-conventions.md) | [`tests/unit/docs.i18n-conventions.test.js`](unit/docs.i18n-conventions.test.js) |
| [`docs/readiness-rubric.md`](../docs/readiness-rubric.md) | [`tests/unit/docs.readiness-rubric.test.js`](unit/docs.readiness-rubric.test.js) |
| [`docs/README.md`](../docs/README.md) | [`tests/unit/docs.readme-index.test.js`](unit/docs.readme-index.test.js) |
| [`tests/README.md`](README.md) (this file) | [`tests/unit/docs.tests-readme.test.js`](unit/docs.tests-readme.test.js) |

The doc-test invariant: tests fail fast when sections are renamed
or deleted; they stay quiet on wording changes. When you change
section ordering or remove a heading, run the matching doc-test
first.

## §4 The runner contract

[`run-tests.js`](run-tests.js) is intentionally small (≤ 30 LOC).
What it does:

1. Accepts one or more directory or file arguments.
2. For a directory, collects every `*.test.js` (sorted), and `require`s each.
3. For a file, requires it directly.

What it does NOT do: provide assertion helpers, mocks, fixtures,
test isolation, parallelism, or a `describe`/`it` wrapper. All of
that is the test file's responsibility — node:test is the contract.

Consequences:

- Test files must be **side-effect-free at require time**, except
  for registering tests via `node:test`.
- A test file that throws at top-level kills the suite immediately.
- Test files cannot share global state across files; each is required
  independently and node:test isolates by default.

## §5 Speed budget per suite

The suites in the standard `npm test` flow have an informal budget
that CI tracks indirectly:

| Suite | Soft target | Hard ceiling |
| --- | --- | --- |
| unit | 15 s | 30 s |
| integration | 60 s | 120 s |
| legacy | 30 s | 60 s |
| smoke | 90 s | 180 s |
| **total** | **3 min** | **6 min** |

When a suite exceeds the soft target on the dev's local machine,
the next round should look for slow tests to refactor. The CI gate
fires at the hard ceiling.

## §6 Stability expectations

Every suite is expected to be **deterministic + parallel-safe**. The
primary causes of flakiness we have removed and intend to keep out:

- **Timing assumptions**: a test waiting for a socket close or a
  setTimeout completion must use `await` against an explicit signal,
  not a fixed delay.
- **Shared-port contention**: smoke tests use ephemeral ports
  (`server.listen(0)`) and read the actual port from the server
  object. No hard-coded `127.0.0.1:4201` in tests.
- **Filesystem residue**: tests that touch disk write to a `tmpdir()`
  derived path and clean up in their own `t.after`. Never write to
  the project tree.
- **Console noise**: a successful test prints only the green
  checkmark + name. If you need debug output, gate it behind an env
  var and document it in the test file's top comment.

Failures here matter — a flaky test that passes on retry trains the
team to ignore the suite. Investigate, don't retry.

## §7 References

- Project-root [`README.md`](../README.md) — quick-start, environment.
- [`docs/README.md`](../docs/README.md) — documentation index.
- [`docs/readiness-rubric.md`](../docs/readiness-rubric.md) — operational
  readiness model that consumes the test counts.
- [`docs/scorecard.md`](../docs/scorecard.md) — round-by-round score
  trajectory; references the test-count auto-markers that this suite
  populates.
