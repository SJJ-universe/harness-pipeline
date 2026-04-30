// Slice TRUST-STORE-0-a (Phase E Round 2, 2026-04-30) — server-side
// trust-store path resolver.
//
// THIS FILE IS A THIN RE-EXPORT of `scripts/launcher/trust-store-path.js`
// (Slice E3-F1-a). The reason there's a server-side module at all is
// that TRUST-STORE-0 needs to import the resolver from inside `src/`
// without reaching into `scripts/launcher/` from every consumer — a
// future audit of "which files do server-side modules depend on?"
// stays clean if the launcher path is reached only via this one shim.
//
// Single source of truth invariant (per Phase E v2 plan §S-TRUST-STORE-0):
//
//   The launcher install path (E3-F1) and the server-side trust-store
//   management UI (TRUST-STORE-0) MUST resolve the same trust file
//   for the same env. If they drift, the operator adds a key in the
//   UI, the file lands at path X, the launcher reads from path Y,
//   and the next install silently fails signature verification.
//   Pinning by re-export means the resolution rules can only diverge
//   if SOMEONE explicitly forks the file — and the integration test
//   in tests/integration/trust-store-launcher.test.js will catch that.
//
// Why re-export and not copy:
//   - Copying invites drift; every change has to be applied twice.
//   - Re-export survives release-zip layout (both files travel
//     together in pipeline-dashboard/scripts/launcher/ and
//     pipeline-dashboard/src/runtime/), and the relative path is
//     resolved at require-time from the consumer's location.
//   - Tests for the resolver behavior live in
//     tests/unit/trustStorePath.test.js and exercise the launcher
//     module directly; those tests already pin the priority chain.

"use strict";

module.exports = require("../../scripts/launcher/trust-store-path");
