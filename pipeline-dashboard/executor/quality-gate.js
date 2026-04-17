// QualityGate — evaluates a phase's exitCriteria against PipelineState.
//
// exitCriteria is a list of predicate objects declared on each phase in
// pipeline-templates.json. If any criterion fails, the gate rejects the
// Stop transition and PipelineExecutor feeds the reason back to Claude.
//
// Supported criterion types:
//   { type: "min-tools",            count: N,   message?: str }
//   { type: "min-tools-in-phase",   count: N,   message?: str }   // count in current phase only
//   { type: "has-artifact",         key: str,   scope?: "phase"|"any", message?: str }
//   { type: "no-critical-findings", severities?: ["critical","high"], message?: str }
//   { type: "critique-received",    message?: str }
//   { type: "files-edited",         min: N,     message?: str }
//   { type: "bash-ran",             min: N,     message?: str }
//   { type: "used-tool",            tool: str,  min?: N, message?: str }

class QualityGate {
  async evaluate(phase, state) {
    const criteria = phase.exitCriteria || [];
    const results = [];
    for (const c of criteria) {
      const ok = this._check(c, phase, state);
      results.push({
        type: c.type,
        ok,
        message: ok ? null : (c.message || this._defaultMessage(c)),
      });
    }
    const missing = results.filter((r) => !r.ok).map((r) => r.message);
    return {
      pass: missing.length === 0,
      missing,
      reason: missing.length === 0 ? "all criteria met" : missing.join("; "),
      results,
    };
  }

  _check(c, phase, state) {
    switch (c.type) {
      case "min-tools":
        return state.metrics.toolCount >= (c.count || 1);
      case "min-tools-in-phase":
        return state.phaseToolCount(phase.id) >= (c.count || 1);
      case "has-artifact": {
        if (c.scope === "any") return state.findArtifact(c.key) !== undefined;
        return state.getArtifact(phase.id, c.key) !== undefined;
      }
      case "no-critical-findings": {
        const sevs = c.severities || ["critical", "high"];
        if (c.scope === "latest") {
          // Only check findings from the latest critique in this phase
          const critique = state.phases[phase.id]?.critique;
          if (!critique || !Array.isArray(critique.findings)) return true;
          return !critique.findings.some((f) => sevs.includes(f.severity));
        }
        // TODO: findings accumulate via setCritique() push — no removal mechanism yet.
        // A scope: "phase" option would filter by fromPhase, but is not yet needed.
        return !state.findings.some((f) => sevs.includes(f.severity));
      }
      case "critique-received":
        return state.phases[phase.id]?.critique != null;
      case "files-edited":
        return state.metrics.filesEdited.size >= (c.min || 1);
      case "bash-ran":
        return state.metrics.bashCommands >= (c.min || 1);
      case "used-tool":
        return (state.metrics.byTool[c.tool] || 0) >= (c.min || 1);
      default:
        return true; // unknown criterion types pass (forward-compat)
    }
  }

  _defaultMessage(c) {
    switch (c.type) {
      case "min-tools":            return `최소 ${c.count} 개 도구 호출 필요`;
      case "min-tools-in-phase":   return `현재 phase에서 최소 ${c.count} 개 도구 호출 필요`;
      case "has-artifact":         return `산출물 "${c.key}" 가 없음`;
      case "no-critical-findings": return `critical/high 심각도 finding이 남아있음`;
      case "critique-received":    return `Codex 비평이 도착하지 않음`;
      case "files-edited":         return `파일 수정이 ${c.min || 1} 건 미만`;
      case "bash-ran":             return `Bash 명령이 ${c.min || 1} 회 미만 실행됨`;
      case "used-tool":            return `도구 ${c.tool} 이 ${c.min || 1} 회 미만 사용됨`;
      default:                     return `알 수 없는 조건: ${c.type}`;
    }
  }
}

module.exports = { QualityGate };
