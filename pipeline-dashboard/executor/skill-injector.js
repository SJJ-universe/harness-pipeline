// SkillInjector — loads SKILL.md content for a phase and builds prompts
// that stitch together skill guidelines + previous-phase artifacts.
//
// Phase 3 scope:
//   - gather(phase): returns SKILL.md body text (or null)
//   - buildCodexPrompt(phase, state): assembles a Codex prompt that
//       (1) frames the task, (2) injects skill context, (3) exposes prior
//       artifacts, (4) enforces an output format the runner can parse.

// P-3 Performance: total prompt budget to keep Codex calls fast & cheap
const TOTAL_PROMPT_CAP = 12_000;

class SkillInjector {
  constructor({ skillRegistry } = {}) {
    this.skillRegistry = skillRegistry; // optional; null → skill context skipped
  }

  async gather(phase) {
    if (!phase || !phase.skill || !this.skillRegistry) return null;
    try {
      // skill-registry exposes getSkillContent(id) synchronously
      const content = this.skillRegistry.getSkillContent
        ? this.skillRegistry.getSkillContent(phase.skill)
        : null;
      return content || null;
    } catch (_) {
      return null;
    }
  }

  buildCodexPrompt(phase, state) {
    const lines = [];
    lines.push(`# Task: ${phase.name || phase.label || phase.id}`);
    lines.push("");
    lines.push(`## User Goal`);
    lines.push(state.meta.userPrompt || "(none)");
    lines.push("");
    lines.push(`## Your Role`);
    lines.push(
      `You are the critic for phase "${phase.id}" in an automated harness ` +
        `pipeline. Review the current state and report concrete issues — ` +
        `do not rewrite or apologize.`
    );
    lines.push("");

    const skillContext = state.phases[phase.id]?.skillContext;
    if (skillContext) {
      lines.push(`## Guidelines`);
      lines.push(this._truncate(skillContext, 4000));
      lines.push("");
    }

    const priorArtifacts = this._collectPriorArtifacts(phase, state);
    if (priorArtifacts.length > 0) {
      lines.push(`## Previous Phase Outputs`);
      for (const { phaseId, key, value } of priorArtifacts) {
        lines.push(`### ${phaseId}.${key}`);
        lines.push(this._stringifyArtifact(value));
        lines.push("");
      }
    }

    if (state.findings.length > 0) {
      lines.push(`## Known Findings So Far`);
      for (const f of state.findings.slice(-10)) {
        lines.push(`- [${f.severity}] ${f.message} (${f.fromPhase || "?"})`);
      }
      lines.push("");
    }

    lines.push(`## Required Output Format`);
    lines.push(
      `List concrete issues as bullet points using exactly this format:`
    );
    lines.push(`- [critical] <issue that will break production>`);
    lines.push(`- [high] <significant problem>`);
    lines.push(`- [medium] <notable concern>`);
    lines.push(`- [low] <minor note>`);
    lines.push("");
    lines.push(`End with a "## Summary" section (1-2 sentences, verdict).`);

    // P-3: enforce total prompt budget — drop oldest artifacts if over cap
    // Split into body (truncatable) and suffix (non-truncatable output format)
    const OUTPUT_FORMAT_HEADER = "## Required Output Format";
    const formatIdx = lines.findIndex((l) => l === OUTPUT_FORMAT_HEADER);
    const suffix = formatIdx >= 0 ? "\n" + lines.slice(formatIdx).join("\n") : "";
    const bodyLines = formatIdx >= 0 ? lines.slice(0, formatIdx) : [...lines];
    const BODY_BUDGET = TOTAL_PROMPT_CAP - suffix.length;

    let result = bodyLines.join("\n");
    if (result.length > BODY_BUDGET && priorArtifacts.length > 0) {
      let dropCount = 0;
      while (result.length > BODY_BUDGET && dropCount < priorArtifacts.length) {
        dropCount++;
        const kept = priorArtifacts.slice(dropCount);
        const rebuilt = [];
        const artifactHeader = "## Previous Phase Outputs";
        const headerIdx = bodyLines.findIndex((l) => l === artifactHeader);
        if (headerIdx >= 0) {
          rebuilt.push(...bodyLines.slice(0, headerIdx));
          if (kept.length > 0) {
            rebuilt.push(artifactHeader);
            for (const { phaseId, key, value } of kept) {
              rebuilt.push(`### ${phaseId}.${key}`);
              rebuilt.push(this._stringifyArtifact(value));
              rebuilt.push("");
            }
          }
          const findingsIdx = bodyLines.findIndex((l) => l === "## Known Findings So Far");
          if (findingsIdx >= 0) rebuilt.push(...bodyLines.slice(findingsIdx));
        } else {
          rebuilt.push(...bodyLines);
        }
        result = rebuilt.join("\n");
      }
    }
    // Hard truncate body only — suffix always preserved
    if (result.length > BODY_BUDGET) {
      result = result.slice(0, BODY_BUDGET) + "\n...(truncated)";
    }
    return result + suffix;
  }

  _collectPriorArtifacts(currentPhase, state) {
    const out = [];
    for (const [phaseId, p] of Object.entries(state.phases)) {
      if (phaseId === currentPhase.id) continue;
      for (const [key, value] of Object.entries(p.artifacts || {})) {
        out.push({ phaseId, key, value });
      }
    }
    return out;
  }

  _stringifyArtifact(v) {
    if (v == null) return "(empty)";
    if (typeof v === "string") return this._truncate(v, 2000);
    try {
      return this._truncate(JSON.stringify(v, null, 2), 2000);
    } catch (_) {
      return String(v).slice(0, 2000);
    }
  }

  _truncate(s, n) {
    if (typeof s !== "string") return s;
    return s.length > n ? s.slice(0, n) + "\n…(truncated)" : s;
  }
}

module.exports = { SkillInjector };
