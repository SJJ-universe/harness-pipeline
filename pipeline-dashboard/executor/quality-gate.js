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
//   { type: "files-edited",         min: N,     message?: str,
//                                   scope?: "phase",      // restrict to current phase
//                                   pathMatch?: regex-str // only count files matching this regex
//   }
//   { type: "bash-ran",             min: N,     message?: str,
//                                   scope?: "phase",         // restrict to current phase
//                                   commandMatch?: regex-str // only count commands matching this regex
//   }
//   { type: "used-tool",            tool: str,  min?: N, message?: str }
//
// Slice B (v4) added `scope`, `pathMatch`, `commandMatch`. Criteria without
// any of these options behave exactly as before (global counters). If the
// supplied regex is malformed we do NOT silently accept — we log once and
// treat the criterion as failed so bad templates surface quickly.

function _compileRegex(source, label) {
  if (source == null || source === "") return null;
  try {
    return new RegExp(source);
  } catch (err) {
    // One-shot console warning — we can't rely on any logger being injected.
    // The criterion-failure message carries the real signal to the user.
    if (!_compileRegex._warned) _compileRegex._warned = new Set();
    const key = `${label}:${source}`;
    if (!_compileRegex._warned.has(key)) {
      _compileRegex._warned.add(key);
      try { console.warn(`[QualityGate] bad ${label} regex ${source}: ${err.message}`); } catch (_) {}
    }
    return { __invalid: true, source };
  }
}

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
        return this._checkFilesEdited(c, phase, state);
      case "bash-ran":
        return this._checkBashRan(c, phase, state);
      case "used-tool":
        return (state.metrics.byTool[c.tool] || 0) >= (c.min || 1);
      default:
        return true; // unknown criterion types pass (forward-compat)
    }
  }

  /**
   * files-edited predicate with optional `scope: "phase"` and `pathMatch`
   * regex. The fast path (no scope, no pathMatch) falls through to the global
   * Set-size check so legacy templates keep their behavior.
   */
  _checkFilesEdited(c, phase, state) {
    const pathRe = _compileRegex(c.pathMatch, "files-edited.pathMatch");
    if (pathRe && pathRe.__invalid) return false;
    const min = c.min || 1;

    if (c.scope === "phase") {
      // Only count files touched by Edit/Write calls in the current phase.
      const seen = new Set();
      const tools = (typeof state.phaseTools === "function")
        ? state.phaseTools(phase.id)
        : (state.phases[phase.id]?.tools || []);
      for (const t of tools) {
        if (t.tool !== "Edit" && t.tool !== "Write") continue;
        if (!t.filePath) continue;
        if (pathRe && !pathRe.test(t.filePath)) continue;
        seen.add(t.filePath);
      }
      return seen.size >= min;
    }

    if (pathRe) {
      let n = 0;
      for (const f of state.metrics.filesEdited) {
        if (pathRe.test(f)) n++;
      }
      return n >= min;
    }

    return state.metrics.filesEdited.size >= min;
  }

  /**
   * bash-ran predicate with optional `scope: "phase"` and `commandMatch`
   * regex. When `commandMatch` is set, we iterate recorded tool entries (which
   * only have the command text after Slice B's PipelineState.recordTool
   * extension) — otherwise we fall back to the global counter.
   */
  _checkBashRan(c, phase, state) {
    const cmdRe = _compileRegex(c.commandMatch, "bash-ran.commandMatch");
    if (cmdRe && cmdRe.__invalid) return false;
    const min = c.min || 1;

    // commandMatch requires looking at actual command text, which lives on
    // per-phase tool entries. Whether scope is "phase" or not, the iteration
    // loops differ only in which tools we walk.
    if (cmdRe) {
      const iter = c.scope === "phase"
        ? ((typeof state.phaseTools === "function"
            ? state.phaseTools(phase.id)
            : (state.phases[phase.id]?.tools || [])))
        : _allTools(state);
      let n = 0;
      for (const t of iter) {
        if (t.tool !== "Bash") continue;
        if (!t.command) continue;
        if (!cmdRe.test(t.command)) continue;
        n++;
      }
      return n >= min;
    }

    if (c.scope === "phase") {
      const tools = (typeof state.phaseTools === "function")
        ? state.phaseTools(phase.id)
        : (state.phases[phase.id]?.tools || []);
      let n = 0;
      for (const t of tools) if (t.tool === "Bash") n++;
      return n >= min;
    }

    return state.metrics.bashCommands >= min;
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

/**
 * Flatten all recorded tool entries across phases. Used by commandMatch when
 * scope is not constrained to the current phase (legacy global behavior).
 */
function _allTools(state) {
  const out = [];
  for (const p of Object.values(state.phases || {})) {
    for (const t of (p.tools || [])) out.push(t);
  }
  return out;
}

module.exports = { QualityGate };
