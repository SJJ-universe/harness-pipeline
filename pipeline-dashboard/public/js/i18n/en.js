// Slice I (v5) — English locale table.
//
// Must mirror ko.js key-for-key (verified in tests/unit/i18n.coverage.test.js).
// Missing keys fall back to ko, then to the raw key — the app won't show
// an English key name to the user, but the coverage test still fails.

(function (root) {
  const table = {
    // ── Header / chrome ─────────────────────────────────────────────
    "header.title": "SJ Harness Engine",
    "status.idle": "Idle",
    "server.status.title": "Server status",
    "server.label.checking": "Server: checking",
    "codex.status.title": "Codex CLI status",

    // ── Toolbar buttons ─────────────────────────────────────────────
    "btn.codexVerify": "Verify Codex",
    "btn.codexVerify.title": "Test Codex CLI invocation",
    "btn.openAnalytics": "📈 Metrics",
    "btn.openAnalytics.title": "Open per-phase duration / gate metrics",
    "btn.openAnalytics.aria": "Open Phase metrics drawer (g m)",
    "btn.openRunHistory": "📜 History",
    "btn.openRunHistory.title": "Open past run history drawer",
    "btn.openRunHistory.aria": "Open past run history drawer (g h)",
    "btn.serverRestart": "Restart",
    "btn.serverRestart.title": "Restart server",
    "btn.serverStop": "Stop",
    "btn.serverStop.title": "Stop server",

    // ── Pipeline selector ───────────────────────────────────────────
    "pipeline.selector.title": "Switch template (click)",
    "btn.startGeneral": "▶ Start task",
    "btn.startGeneral.title": "Run general task pipeline (Claude plan ↔ Codex critique cycle)",
    "btn.abortGeneral": "■ Abort",
    "btn.abortGeneral.title": "Abort running pipeline",
    "btn.toggleCompact.title": "Toggle compact / detail view",
    "btn.openTemplateEditor": "Templates",
    "btn.openTemplateEditor.title": "Add / edit / delete custom templates",

    // ── Stats cards ─────────────────────────────────────────────────
    "stat.findings": "Findings",
    "stat.context": "Context",
    "stat.verify": "Verification",
    "stat.codexLive": "🤖 Codex live output",
    "stat.subagents": "🤝 Subagents",
    "stat.toolCalls": "🔧 Tool calls",
    "stat.critiqueTimeline": "💬 Critique timeline",
    "btn.clear": "Clear",

    // ── Tabs ────────────────────────────────────────────────────────
    "tab.eventLog": "Event log",
    "tab.terminal": "Terminal",

    // ── General Run modal ───────────────────────────────────────────
    "modal.general.title": "Start general pipeline — Claude plan ↔ Codex critique",
    "modal.general.description":
      "Enter a task — Claude plans, Codex critiques, and the plan is rewritten as long as critical/high issues remain.",
    "field.taskDescription": "Task description",
    "field.taskPlaceholder": "e.g. Add JWT auth middleware to an Express server and protect the existing /admin route",
    "field.maxIterations": "Max iterations",
    "btn.cancel": "Cancel",
    "btn.start": "Start",

    // ── Other modals ────────────────────────────────────────────────
    "modal.finalPlan": "Final plan",
    "modal.stepDetail": "Step detail",
    "modal.analytics.title": "📈 Phase metrics",
    "modal.runHistory.title": "📜 Run history",
    "modal.templateEditor.title": "Pipeline template editor",

    // ── Run history drawer ──────────────────────────────────────────
    "btn.saveCurrentRun": "Save current run",
    "btn.clearAll": "Clear all",
    "run.historyEmpty": "(No saved runs — click 'Save current run' to start a history)",

    // ── Template editor ─────────────────────────────────────────────
    "btn.newTemplate": "+ New template",
    "btn.delete": "Delete",
    "btn.save": "Save",
    "field.templateJsonLabel": "JSON (schema: src/templates/pipelineTemplate.schema.json)",

    // ── A11y labels ─────────────────────────────────────────────────
    "a11y.skipLink": "Skip to main content",
    "a11y.close.analytics": "Close metrics drawer",
    "a11y.close.history": "Close history drawer",
    "a11y.close.templateEditor": "Close template editor",

    // ── Language toggle ─────────────────────────────────────────────
    "lang.toggle.title": "Language toggle",
    "lang.ko": "Korean",
    "lang.en": "English",

    // ── Runtime toasts / runtime strings (opt-in by caller) ─────────
    "toast.keybindings": "Shortcuts: g t=templates, g h=history, g m=metrics, Esc=close",

    // ── Product shell (UI-P7): mode toggle, status pill, indicators ─
    // Mode toggle is bilingual by design — Korean primary stays Korean
    // in EN locale too; English subscript stays English in KO locale.
    // The two-language ribbon is a fixed reference design element.
    "prod.mode.simple":      "일반사용자",
    "prod.mode.simple.eng":  "Simple",
    "prod.mode.pro":         "전문사용자",
    "prod.mode.pro.eng":     "Pro",
    "prod.status.idle":      "Idle",
    "prod.status.running":   "Running",
    "prod.status.error":     "Stopped",
    "prod.indicator.server.online":   "Server ONLINE",
    "prod.indicator.server.offline":  "Server OFFLINE",
    "prod.indicator.server.checking": "Server checking",
    "prod.indicator.codex.ready":         "Codex READY",
    "prod.indicator.codex.authNeeded":    "Codex auth needed",
    "prod.indicator.codex.notInstalled":  "Codex not installed",
    "prod.aria.header":             "SJ Harness header (status · mode · actions)",
    "prod.aria.statusPill":         "Run status",
    "prod.aria.modeToggle":         "User mode toggle",
    "prod.aria.localeToggle":       "Language toggle",
    "prod.aria.serverIndicator":    "Server status",
    "prod.aria.codexIndicator":     "Codex status",
    "prod.aria.dualTerminals":      "Dual terminals (Claude / Codex stream)",
    "prod.aria.actionRow":          "Review relay actions",

    // ── Product shell (UI-P7): dual-terminals action row ────────────
    "prod.terminals.session.none":         "🔗 No session",
    "prod.terminals.posture.publicSector": "🛡 Public-sector mode — local Claude execution blocked",
    "prod.terminals.action.start":         "+ Start session",
    "prod.terminals.action.start.title":   "Start a new review session",
    "prod.terminals.action.sendCodex":          "→ Send to Codex",
    "prod.terminals.action.sendCodex.title":    "Send Claude's work to Codex for critique",
    "prod.terminals.action.followUpCodex":      "? Follow-up Codex",
    "prod.terminals.action.followUpCodex.title": "Ask Codex a follow-up question",
    "prod.terminals.action.handBack":           "→ Hand back to Claude",
    "prod.terminals.action.handBack.title":     "Hand the critique back to Claude",
    "prod.terminals.action.archive":            "⏏ Archive session",
    "prod.terminals.action.archive.title":      "Move the current session to archive",
    "prod.terminals.state.created":           "Ready",
    "prod.terminals.state.awaiting_critique": "Awaiting Codex critique",
    "prod.terminals.state.critique_received": "Critique received",
    "prod.terminals.state.awaiting_claude":   "Awaiting Claude",
    "prod.terminals.state.claude_received":   "Claude responded",
    "prod.terminals.state.archived":          "Archived",

    // ── UI-P8: legacy view deprecation banner ───────────────────────
    // Banner appears at the top of /?mode=legacy. Dismissible with
    // localStorage persistence. Per UI-P0 §285+286 the legacy view
    // stays available indefinitely as an operator escape hatch — the
    // banner advertises the new shell without forcing migration.
    "legacy.banner.aria":     "New dashboard notice",
    "legacy.banner.message":  "🚀 The new dashboard is ready — same data, refreshed visuals",
    "legacy.banner.cta":      "Try it →",
    "legacy.banner.cta.title":"Open the new product shell",
    "legacy.banner.dismiss":  "Dismiss this notice",
    "legacy.banner.footnote": "This view (legacy) stays available indefinitely",

    // ── UI-FirstRun: 6 first-run state messages + 9 CTA labels ─────
    "firstRun.cardLabel":                                "Next action",
    "firstRun.aria.region":                              "Next action card",
    "firstRun.noProfile.headline":                       "No profile yet",
    "firstRun.noProfile.body":                           "Create your first profile to connect Claude / Codex before any work can start.",
    "firstRun.noActiveProfile.headline":                 "Pick an active profile",
    "firstRun.noActiveProfile.body":                     "Profiles are registered but none is marked active.",
    "firstRun.publicSectorIncomplete.headline":          "🛡 Public-sector setup is incomplete",
    "firstRun.publicSectorIncomplete.body":              "Public-sector / intranet policy is enabled. Additional acknowledgments + sandbox setup are required.",
    "firstRun.providerMissing.headline":                 "Claude or Codex CLI is not installed",
    "firstRun.providerMissing.body":                     "An active profile exists but the CLI tool is missing. Verify the install or fix the path.",
    "firstRun.providerNotAuthenticated.headline":        "Claude / Codex login required",
    "firstRun.providerNotAuthenticated.body":            "CLIs are installed but auth state cannot be confirmed. Sign in to each tool.",
    "firstRun.ready.headline":                           "Ready to use",
    "firstRun.ready.body":                               "An active profile is configured. Verify connection state if you want.",

    "firstRun.cta.createProfile":                        "Quick personal profile",
    "firstRun.cta.openSetupWizard":                      "Start with setup wizard",
    "firstRun.cta.openSettingsProfiles":                 "Open account settings",
    "firstRun.cta.openPublicSectorSetup":                "Public-sector setup wizard",
    "firstRun.cta.testClaude":                           "Test Claude connection",
    "firstRun.cta.testCodex":                            "Test Codex connection",
    "firstRun.cta.reopenSetupForProviders":              "Reopen setup wizard",
    "firstRun.cta.authClaude":                           "Sign in to Claude",
    "firstRun.cta.authCodex":                            "Sign in to Codex",

    // ── Slice RR0-d: friendlier missing/unauth flows + safe-guidance ──
    "firstRun.cta.copyLoginCommandClaude":               "Copy Claude login command (claude auth login)",
    "firstRun.cta.copyLoginCommandCodex":                "Copy Codex login command (codex auth login)",
    "firstRun.cta.recheckProviders":                     "Re-check",
    "firstRun.safeGuidance.short":                       "Harness never asks for your password or OAuth token.",
    "firstRun.safeGuidance.long":                        "Sign-in happens entirely inside the official Claude/Codex CLI. Harness only (1) copies the login command to your clipboard, or (2) opens the official docs in a new tab. After signing in, click \"Re-check\" above to refresh the status.",
    "firstRun.docsUrl.claude":                           "https://docs.anthropic.com/en/docs/claude-code/cli-usage",
    "firstRun.docsUrl.codex":                            "https://github.com/openai/codex#authentication",

    "firstRun.meta.profileCount":                        "Registered profiles: {count}",
    "firstRun.meta.missing":                             "CLI(s) not detected: {runners}",
    "firstRun.meta.unauth":                              "Login required: {runners}",
    "firstRun.meta.untestedHint":                        "Connection state is unverified. Use the buttons above to test.",

    // ── SMART-1: Recommendations card (7 frozen rules) ──────────────
    "smart.rec.cardLabel":                                "Recommendations",
    "smart.rec.aria.region":                              "Recommendations card",
    "smart.rec.empty":                                    "No recommended actions right now.",
    "smart.rec.dismiss":                                  "Dismiss",
    "smart.rec.dismiss.aria":                             "Dismiss recommendation: {title}",

    "smart.rec.completeProfileSetup.title":               "Profile setup required",
    "smart.rec.completeProfileSetup.body":                "No active profile — work cannot start until one is configured.",
    "smart.rec.completeProfileSetup.cta":                 "Open setup wizard",

    "smart.rec.resolveApprovals.title":                   "{count} approval(s) pending",
    "smart.rec.resolveApprovals.body":                    "AI-tool execution is waiting on operator decisions.",
    "smart.rec.resolveApprovals.cta":                     "View approval cards",

    "smart.rec.requestCodexReview.title":                 "Sessions are awaiting Codex critique",
    "smart.rec.requestCodexReview.body":                  "Have Codex review Claude's output to double-check accuracy.",
    "smart.rec.requestCodexReview.cta":                   "View review sessions",

    "smart.rec.monitorActiveRuns.title":                  "{count} run(s) in progress",
    "smart.rec.monitorActiveRuns.body":                   "Check the status of currently running work.",
    "smart.rec.monitorActiveRuns.cta":                    "View recent results",

    "smart.rec.exportAuditEvidence.title":                "Audit envelope ready to export",
    "smart.rec.exportAuditEvidence.body":                 "You can build a sealed JSON envelope to hand to an auditor.",
    "smart.rec.exportAuditEvidence.cta":                  "Build audit envelope",

    "smart.rec.publicSectorPiiBlock.title":               "🛡 Public-sector mode: blocked by PII detection",
    "smart.rec.publicSectorPiiBlock.body":                "Public-sector / intranet policy blocks external model calls when input contains PII. Remove the PII or move to a sandbox.",
    "smart.rec.publicSectorPiiBlock.cta":                 "Review security policy",

    "smart.rec.publicSectorEvidenceTrail.title":          "🛡 Public-sector audit evidence recommended",
    "smart.rec.publicSectorEvidenceTrail.body":           "Public-sector procedure benefits from regularly exporting audit envelopes for retention.",
    "smart.rec.publicSectorEvidenceTrail.cta":            "Build audit envelope",

    // ── SMART-3: Expert review presets (6 frozen) ───────────────────
    // Operator picks one of six expert lenses instead of free-form
    // input. The preset's system prompt + severity-tag instruction is
    // sent alongside the operator's instruction. Audit chain entries
    // record the chosen presetId.
    "smart.preset.label":                                 "Review focus",
    "smart.preset.aria":                                  "Select expert review focus",
    "smart.preset.loading":                               "(loading…)",
    "smart.preset.unavailable":                           "(preset list unavailable — free-form only)",
    "smart.preset.none":                                  "Free-form (no preset)",

    "smart.preset.accuracy.label":                        "Accuracy",
    "smart.preset.accuracy.description":                  "Logical correctness, off-by-one, edge cases, type confusion.",
    "smart.preset.security.label":                        "Security",
    "smart.preset.security.description":                  "Auth, injection, secret leakage, supply-chain risk.",
    "smart.preset.privacy.label":                         "Privacy",
    "smart.preset.privacy.description":                   "PII (KRN/SSN/email) exposure, retention, data-minimization.",
    "smart.preset.performance.label":                     "Performance",
    "smart.preset.performance.description":               "Hot paths, N+1 queries, memory leaks, sync work in event loops.",
    "smart.preset.release.label":                         "Release Readiness",
    "smart.preset.release.description":                   "Rollout safety, signed manifests, backward compat, audit-chain coverage.",
    "smart.preset.public-sector-audit.label":             "🛡 Public-Sector Audit",
    "smart.preset.public-sector-audit.description":       "Public-sector / regulated — fail-closed posture, audit-chain depth, signing integrity.",

    // ── Slice POL-c: policy pack catalog labels ──────────────────────
    "policyPack.cardLabel":                              "Current policy pack",
    "policyPack.aria.region":                            "Policy pack information",
    "policyPack.currentLabel":                           "Currently active",
    "policyPack.changeHint":                             "Pack changes require a server restart (set HARNESS_DEPLOYMENT_PROFILE env, then reboot).",
    "policyPack.publicSectorRequirements.title":         "🛡 Public-sector / regulated deployment requirements",
    "policyPack.publicSectorRequirements.intro":         "Before selecting this pack, ensure the following are in place:",
    "policyPack.runtimeEffective.label":                 "Effective runtime state",
    "policyPack.runtimeEffective.hardGates":             "Hard gates: {mode}",
    "policyPack.runtimeEffective.runMemory":             "Run memory: {state}",
    "policyPack.runtimeEffective.envOverride":           "(env override)",

    "policyPack.modeId.standard":                        "Standard",
    "policyPack.modeId.public-sector":                   "Public Sector",
    "policyPack.modeId.finance-high-privacy":            "🛡 Finance High-Privacy",
    "policyPack.modeId.offline-internal-network":        "Offline Internal Network",
    "policyPack.modeId.developer-lab":                   "Developer Lab",

    "policyPack.field.publicSector":                     "Public-sector posture",
    "policyPack.field.allowLocalExecutor":               "Local executor allowed",
    "policyPack.field.allowPlaintextSecrets":            "Plaintext secrets allowed",
    "policyPack.field.requireSandboxWorkspace":          "Sandbox workspace required",
    "policyPack.field.requireSignedManifest":            "Signed manifest required",
    "policyPack.field.requirePiiScanBeforeProviderDispatch": "PII scan required before provider dispatch",
    "policyPack.field.scannerFailurePolicy":             "Scanner failure policy",
    "policyPack.field.hardGatesDefault":                 "Hard gates default",
    "policyPack.field.runMemoryEnabled":                 "Run memory enabled",
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = table;
  }
  if (typeof root !== "undefined") {
    root.HARNESS_I18N = root.HARNESS_I18N || {};
    root.HARNESS_I18N.en = table;
  }
})(typeof window !== "undefined" ? window : globalThis);
