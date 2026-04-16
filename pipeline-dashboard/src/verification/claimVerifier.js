// ClaimVerifier — Phase F claim-vs-evidence checking.
// Blocks pipeline completion when claims lack evidence.

class ClaimVerifier {
  verify(state) {
    const results = [];
    const missing = [];

    // Rule 1: test-evidence-required
    // If files were edited, Phase F must have run Bash (test command)
    const filesEdited = state.metrics?.filesEdited?.size > 0 ||
      Object.values(state.phases).some((p) => {
        const tools = p.tools || [];
        return tools.some((t) => t.tool === "Edit" || t.tool === "Write");
      });

    const phaseF = state.phases.F || state.phases.f;
    const bashRanInF = phaseF && Array.isArray(phaseF.tools) &&
      phaseF.tools.some((t) => t.tool === "Bash");

    if (filesEdited && !bashRanInF) {
      results.push({ id: "test-evidence-required", pass: false, message: "files edited but no test command run in Phase F" });
      missing.push("test-evidence-required");
    } else {
      results.push({ id: "test-evidence-required", pass: true, message: "ok" });
    }

    // Rule 2: critical-findings-resolved
    const unresolvedCritical = (state.findings || []).filter(
      (f) => f.severity === "critical" || f.severity === "high"
    );
    if (unresolvedCritical.length > 0) {
      results.push({
        id: "critical-findings-resolved",
        pass: false,
        message: `${unresolvedCritical.length} critical/high findings unresolved`,
      });
      missing.push("critical-findings-resolved");
    } else {
      results.push({ id: "critical-findings-resolved", pass: true, message: "ok" });
    }

    // Rule 3: verification-phase-executed
    const phaseFExists = phaseF && Array.isArray(phaseF.tools) && phaseF.tools.length > 0;
    if (!phaseFExists) {
      results.push({ id: "verification-phase-executed", pass: false, message: "Phase F not executed" });
      missing.push("verification-phase-executed");
    } else {
      results.push({ id: "verification-phase-executed", pass: true, message: "ok" });
    }

    return {
      pass: missing.length === 0,
      results,
      missing,
    };
  }
}

module.exports = { ClaimVerifier };
