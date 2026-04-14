// PipelineAdapter — runtime pipeline mutation (Phase 4)
//
// Inspects the active pipeline + accumulated PipelineState and decides whether
// to mutate the template mid-run. Mutations let the harness react to reality
// instead of blindly walking a static phase list.
//
// Mutation types returned by a rule:
//   { type: "insert-phase",  at: idx, phase: {...}, markId }
//   { type: "switch-template", templateId, markId }
//   { type: "merge-template",  at: idx, templateId, phases?: [...], markId }
//
// Returning null means "no change — proceed normally".
//
// Rules use `markId` so the same mutation is never reapplied on a given run.
// The executor records applied marks on `active._adapterMarks`.

class PipelineAdapter {
  constructor({ templates } = {}) {
    this.templates = templates || {};
    this.rules = this._loadRules();
  }

  async review(active, state) {
    if (!active || !active.template) return null;
    const marks = active._adapterMarks || (active._adapterMarks = new Set());

    for (const rule of this.rules) {
      if (marks.has(rule.id)) continue;
      let hit = null;
      try {
        hit = rule.when(active, state) ? rule.build(active, state, this.templates) : null;
      } catch (_) {
        hit = null;
      }
      if (hit) {
        hit.ruleId = rule.id;
        hit.markId = hit.markId || rule.id;
        return hit;
      }
    }
    return null;
  }

  _loadRules() {
    return [
      {
        id: "insert-hotfix-on-critical",
        when: (active, state) =>
          state.findings.some((f) => f.severity === "critical"),
        build: (active) => ({
          type: "insert-phase",
          at: active.phaseIdx + 1,
          phase: {
            id: "E0",
            name: "긴급 수정",
            label: "Phase E0",
            agent: "claude",
            allowedTools: ["Read", "Edit", "Write", "Grep"],
            exitCriteria: [
              { type: "no-critical-findings", message: "critical finding이 여전히 남아있음" },
              { type: "files-edited", min: 1, message: "hotfix 단계에서 파일 수정이 없음" },
            ],
            nodes: [
              {
                id: "hotfix",
                icon: "!",
                iconType: "emoji",
                label: "Hotfix",
                sublabel: "긴급 수정",
              },
            ],
            _injected: true,
          },
        }),
      },
      {
        id: "switch-to-debugging-on-stuck-cycle",
        when: (active, state) => {
          const phase = active.template.phases[active.phaseIdx];
          if (!phase || !phase.cycle) return false;
          if (active.iteration < (phase.maxIterations || 3)) return false;
          return state.findings.some(
            (f) => f.severity === "critical" || f.severity === "high"
          );
        },
        build: (active, state, templates) => {
          const target = templates.debugging || templates.default;
          if (!target) return null;
          return {
            type: "switch-template",
            templateId: target.id || "default",
          };
        },
      },
      {
        id: "merge-testing-when-many-edits",
        when: (active, state) => state.metrics.filesEdited.size >= 20,
        build: (active, state, templates) => {
          const testing = templates.testing;
          if (!testing) return null;
          const phases = (testing.phases || []).filter((p) =>
            /테스트|test/i.test(p.name || "")
          );
          if (phases.length === 0) return null;
          return {
            type: "merge-template",
            at: active.phaseIdx + 1,
            templateId: "testing",
            phases: phases.map((p) => ({ ...p, id: `T_${p.id}`, _injected: true })),
          };
        },
      },
    ];
  }
}

module.exports = { PipelineAdapter };
