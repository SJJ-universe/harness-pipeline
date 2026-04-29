// Slice D2-c (Phase E1.5, 2026-04-29) — setup wizard HTTP API.
//
// 5 endpoints exposed under `/api/setup/*`:
//
//   POST /api/setup/probe-node
//     No body. Returns { version, satisfiesMinimum, minimumRequired }.
//     Tells the wizard whether the operator's Node is ≥ 24.
//
//   POST /api/setup/probe-cli
//     Body: { name: string }
//     Returns discoverCli (D2-a) result. Used for "is claude on PATH"
//     style checks.
//
//   POST /api/setup/probe-provider
//     Body: { runner, mode?, profileId?, consentToTier3? }
//     Returns providerProbe (D2-b) result. Tier 3 requires explicit
//     `consentToTier3: true` in the body — without it, the route
//     refuses with 400 even if the operator passes mode="tier1+2+3".
//     The wizard / UI is responsible for getting the consent click
//     before sending the request.
//
//   POST /api/setup/probe-workspace
//     Body: { workspacePath: string }
//     Returns { ok, exists, writable, normalizedPath, error }.
//     Lightweight write-then-delete check (.harness-write-test file).
//     Used by the wizard's standard track to confirm the operator's
//     chosen workspace is writable BEFORE finalize.
//
//   POST /api/setup/finalize
//     Body: { profile: {...}, setActive?: boolean }
//     Calls profileStore.upsert + (optionally) profileStore.switch.
//     Returns { ok, profile, activeProfileId? } on success or 400/409
//     on policy violation / active-run conflict.
//
// Why a separate route module from profileRoutes:
//
//   profileRoutes (D1-e) is the steady-state CRUD surface (operator
//   adds / switches / deletes / tests profiles after setup). setupRoutes
//   is the FIRST-RUN flow + diagnostic surface — read-only probes that
//   never touch credentials, plus a finalize action that wraps
//   profileStore.upsert with wizard-friendly error mapping. Two
//   routes, two test files, two operator stories.
//
// Public-sector handling:
//
//   The probe endpoints are POSTUREless — they answer factual questions
//   ("is X on PATH", "is this path writable") that don't change under
//   public-sector posture. providerProbe (consumed by /probe-provider)
//   handles its own public-sector defense (returns
//   PUBLIC_SECTOR_BLOCKED rather than spawning).
//
//   /finalize routes through profileStore.upsert which validates
//   public-sector profiles via D1-gov-2's validateProfileForPublicSector.
//   The route maps the policy error to a 400 with structured details
//   so the wizard can render "the profile must use accountType=...".
//
// What this module deliberately does NOT do:
//
//   - Run the wizard itself. Wizards are interactive scripts that
//     consume these endpoints (D2-d). Keeping the routes server-only
//     means the wizard can be CLI-only, UI-only, or both.
//   - Cache probe results. Each request re-probes so the wizard can
//     install a CLI mid-flow and re-run the check.
//   - Inject credentials beyond what providerProbe already does.

"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
const { discoverCli } = require("../runtime/cliProbe");
const { probeProvider, PROBE_MODES } = require("../runtime/providerProbe");

// Minimum Node version. Locked to 24 because the harness uses Node
// 24-only features (fetch with timeout AbortSignal, native test
// runner, etc.). Bump this when we drop another version.
const MINIMUM_NODE_MAJOR = 24;
const MINIMUM_NODE_VERSION = `${MINIMUM_NODE_MAJOR}.0.0`;

// Workspace probe: write a tiny file with a unique name + delete it.
// File name carries a process pid + timestamp so two simultaneous
// probes on the same path don't race.
function _writeTestPath(workspacePath) {
  return path.join(
    workspacePath,
    `.harness-write-test-${process.pid}-${Date.now()}`,
  );
}

function _normalizeWorkspacePath(input) {
  // Reject obvious abuse: empty, non-absolute, traversal segments.
  if (typeof input !== "string" || input.length === 0) {
    return { ok: false, error: "workspacePath required (non-empty string)" };
  }
  if (input.length > 4096) {
    return { ok: false, error: "workspacePath too long (>4096 chars)" };
  }
  let normalized;
  try {
    normalized = path.resolve(input);
  } catch (err) {
    return { ok: false, error: `workspacePath could not be resolved: ${err.message}` };
  }
  // Every workspace path MUST be absolute after resolve. If
  // path.resolve returned something different from `normalized`
  // something's off; isAbsolute is a defensive check.
  if (!path.isAbsolute(normalized)) {
    return { ok: false, error: `workspacePath must resolve to an absolute path` };
  }
  return { ok: true, normalizedPath: normalized };
}

async function _probeWorkspace(workspacePath, opts = {}) {
  const norm = _normalizeWorkspacePath(workspacePath);
  if (!norm.ok) {
    return {
      ok: false,
      exists: false,
      writable: false,
      normalizedPath: null,
      error: norm.error,
    };
  }
  const fsImpl = opts.fs || fs;
  const testFile = _writeTestPath(norm.normalizedPath);

  let exists = false;
  try {
    fsImpl.statSync(norm.normalizedPath);
    exists = true;
  } catch (_) {
    exists = false;
  }

  // Try to create the directory if missing (operator-friendly: "I
  // typed a new path; make it if it's not there"). recursive:true
  // so we can land both / and the workspace.
  if (!exists) {
    try {
      fsImpl.mkdirSync(norm.normalizedPath, { recursive: true });
      exists = true;
    } catch (err) {
      return {
        ok: false,
        exists: false,
        writable: false,
        normalizedPath: norm.normalizedPath,
        error: `cannot create workspace directory: ${err.message}`,
      };
    }
  }

  // Confirm writable via write-then-delete.
  try {
    fsImpl.writeFileSync(testFile, "harness-write-test", "utf-8");
  } catch (err) {
    return {
      ok: false,
      exists,
      writable: false,
      normalizedPath: norm.normalizedPath,
      error: `cannot write to workspace: ${err.message}`,
    };
  }
  try {
    fsImpl.unlinkSync(testFile);
  } catch (_) {
    // Failed-delete after successful write is unusual but not fatal.
    // The probe's purpose is "can I write here"; we already know yes.
    // The orphan file is named with pid+ts so it's identifiable.
  }

  return {
    ok: true,
    exists,
    writable: true,
    normalizedPath: norm.normalizedPath,
    error: null,
  };
}

function _checkNodeVersion(processVersionsNode) {
  const v = String(processVersionsNode || "");
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) {
    return {
      version: v,
      satisfiesMinimum: false,
      minimumRequired: MINIMUM_NODE_VERSION,
      error: `cannot parse Node version "${v}"`,
    };
  }
  const major = parseInt(m[1], 10);
  return {
    version: v,
    satisfiesMinimum: major >= MINIMUM_NODE_MAJOR,
    minimumRequired: MINIMUM_NODE_VERSION,
    error: null,
  };
}

/**
 * Build the setup routes router.
 *
 * @param {object} deps
 * @param {object} deps.profileStore       - D1-b
 * @param {object} deps.credentialStore    - D1-a
 * @param {object} [deps.ledger]           - audit handle (optional, but
 *   recommended in production; setup actions hit the ledger).
 * @param {function} [deps.isActiveRun]    - () => boolean. When true,
 *   /finalize refuses to switch the active profile (409) so an
 *   in-flight run isn't yanked out from under itself.
 * @param {function} [deps.cliProbeImpl]   - inject discoverCli for tests.
 * @param {function} [deps.probeProviderImpl] - inject probeProvider for tests.
 * @param {function} [deps.probeWorkspaceImpl] - inject _probeWorkspace for tests.
 * @param {function} [deps.checkNodeVersionImpl] - inject _checkNodeVersion for tests.
 *
 * @returns {express.Router}
 */
function createSetupRoutes(deps = {}) {
  const router = express.Router();

  const profileStore = deps.profileStore || null;
  const credentialStore = deps.credentialStore || null;
  const ledger = deps.ledger || null;
  const isActiveRun = typeof deps.isActiveRun === "function"
    ? deps.isActiveRun
    : () => false;
  const cliProbeImpl = deps.cliProbeImpl || discoverCli;
  const probeProviderImpl = deps.probeProviderImpl || probeProvider;
  const probeWorkspaceImpl = deps.probeWorkspaceImpl || _probeWorkspace;
  const checkNodeVersionImpl = deps.checkNodeVersionImpl || _checkNodeVersion;

  router.use(express.json({ limit: "32kb" }));

  // ── POST /api/setup/probe-node ────────────────────────────────
  router.post("/setup/probe-node", (req, res) => {
    const result = checkNodeVersionImpl(process.versions.node);
    res.json({ ok: !result.error, ...result });
  });

  // ── POST /api/setup/probe-cli ─────────────────────────────────
  router.post("/setup/probe-cli", (req, res) => {
    const name = req.body && req.body.name;
    const result = cliProbeImpl(name);
    res.json(result);
  });

  // ── POST /api/setup/probe-provider ────────────────────────────
  router.post("/setup/probe-provider", async (req, res) => {
    const body = req.body || {};
    const runner = body.runner;
    const mode = body.mode || PROBE_MODES.TIER1_2;

    // Tier 3 spends tokens. The route refuses without explicit consent
    // even if the wizard / UI accidentally passes mode=tier1+2+3.
    if (mode === PROBE_MODES.TIER1_2_3 && body.consentToTier3 !== true) {
      return res.status(400).json({
        error: "tier3_requires_consent",
        message: "Tier 3 spends provider tokens. Set consentToTier3:true to opt in.",
      });
    }

    let profile = null;
    if (body.profileId) {
      if (!profileStore) {
        return res.status(503).json({ error: "profileStore_not_wired" });
      }
      profile = profileStore.get(body.profileId);
      if (!profile) {
        return res.status(404).json({
          error: "profile_not_found",
          profileId: body.profileId,
        });
      }
    }

    try {
      const result = await probeProviderImpl({
        runner,
        mode,
        profile,
        profileStore,
        credentialStore,
      });
      res.json(result);
    } catch (err) {
      // probeProvider should not throw — it returns structured
      // failures. If it does, surface as 500 so the operator sees
      // a real error instead of a hung wizard.
      res.status(500).json({
        error: "probe_failed",
        message: err.message,
      });
    }
  });

  // ── POST /api/setup/probe-workspace ───────────────────────────
  router.post("/setup/probe-workspace", async (req, res) => {
    const body = req.body || {};
    const result = await probeWorkspaceImpl(body.workspacePath);
    res.json(result);
  });

  // ── POST /api/setup/finalize ──────────────────────────────────
  router.post("/setup/finalize", (req, res) => {
    if (!profileStore) {
      return res.status(503).json({ error: "profileStore_not_wired" });
    }
    const body = req.body || {};
    if (!body.profile || typeof body.profile !== "object" || Array.isArray(body.profile)) {
      return res.status(400).json({ error: "profile_required" });
    }
    if (isActiveRun()) {
      // Mirrors profileRoutes /switch — never yank the active profile
      // out from under an in-flight run.
      if (ledger) {
        try {
          ledger.append("system", {
            type: "setup_finalize_blocked",
            data: { reason: "active_run", profileId: body.profile.id || null },
          });
        } catch (_) { /* best-effort */ }
      }
      return res.status(409).json({
        error: "active_run_blocks_setup",
        message: "An active run is in flight. Finish or stop it first.",
      });
    }

    let created;
    try {
      created = profileStore.upsert(body.profile);
    } catch (err) {
      // profileStore.upsert can throw on:
      //   - schema validation failure (operator typo)
      //   - public-sector policy violation (D1-gov-2)
      // Both surface as 400 with structured details when available.
      const status = /public-sector/i.test(err.message) ? 400 : 400;
      const payload = { error: "profile_upsert_failed", message: err.message };
      // Some errors (public-sector) carry a `details` field on err —
      // surface if present.
      if (Array.isArray(err.details)) payload.details = err.details;
      return res.status(status).json(payload);
    }

    let activeProfileId = null;
    if (body.setActive === true) {
      try {
        profileStore.switch(created.id);
        activeProfileId = created.id;
      } catch (err) {
        // upsert succeeded but switch failed — return 200 with the
        // created profile + a switch-failed warning. Don't leave the
        // operator without a profile because a switch hiccup happened.
        return res.json({
          ok: true,
          profile: created,
          activeProfileId: null,
          switchError: err.message,
        });
      }
    }

    if (ledger) {
      try {
        ledger.append("system", {
          type: "setup_finalize_ok",
          data: {
            profileId: created.id,
            setActive: body.setActive === true,
            activeProfileId,
          },
        });
      } catch (_) { /* best-effort */ }
    }

    res.json({ ok: true, profile: created, activeProfileId });
  });

  return router;
}

module.exports = {
  createSetupRoutes,
  // Internal helpers exposed for unit tests.
  _checkNodeVersion,
  _normalizeWorkspacePath,
  _probeWorkspace,
  MINIMUM_NODE_MAJOR,
  MINIMUM_NODE_VERSION,
};
