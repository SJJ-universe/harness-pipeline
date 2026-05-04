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
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = table;
  }
  if (typeof root !== "undefined") {
    root.HARNESS_I18N = root.HARNESS_I18N || {};
    root.HARNESS_I18N.en = table;
  }
})(typeof window !== "undefined" ? window : globalThis);
