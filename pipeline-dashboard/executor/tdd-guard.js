// Slice G (v5) — TDD Guard: Stage 1 (require-test-edit-first).
//
// Pure evaluator. Given a phase config with `tddGuard.stage === "edit-first"`,
// a tool name, and the tool input, decide whether the tool call is allowed
// by consulting the tool history recorded in PipelineState for that phase.
//
// Stage 1 rule: within the same phase, at least one matching test file
// (testPattern) must be edited BEFORE any matching src file (srcPattern) is
// edited. This does NOT prove the test fails — it only enforces edit order,
// which is cheap, framework-agnostic, and still catches the common anti-pattern
// of "update src, forget the test". Proving a failing test exists is Stage 2
// and requires parsing test-runner output; that's deferred to a later round.
//
// Scope limits (intentional):
//   - Read / Glob / Grep / Bash / others: always allowed. The guard is ONLY
//     about mutating source code.
//   - If the file path doesn't match either src or test patterns, the edit is
//     out of scope and passes.
//   - A broken regex (srcPattern or testPattern) fails CLOSED with a descriptive
//     reason so the user sees the misconfiguration, instead of silently letting
//     everything through.

class TddGuard {
  constructor(state) {
    this.state = state;
  }

  /**
   * @param {object} phase        Phase config. May be undefined for phases with
   *                              no guard; in that case the guard passes.
   * @param {string} tool         Tool name from PreToolUse payload (Edit/Write/...).
   * @param {object} input        tool_input — needs file_path / filePath.
   * @returns {{ allow: boolean, reason?: string }}
   */
  evaluate(phase, tool, input = {}) {
    if (!phase || !phase.tddGuard) return { allow: true };
    const rule = phase.tddGuard;
    // Slice Q (v6): stage 2 = "failing-proof" — same edit-first rule PLUS
    // require state.hasFailingTestRun(phase.id) === true.
    if (rule.stage !== "edit-first" && rule.stage !== "failing-proof") {
      return { allow: true };
    }

    // Only source-mutating tools are subject to the guard.
    if (tool !== "Edit" && tool !== "Write") return { allow: true };

    const filePath = _extractFilePath(input);
    if (!filePath) return { allow: true };

    let srcRe, testRe;
    try {
      srcRe = new RegExp(rule.srcPattern);
      testRe = new RegExp(rule.testPattern);
    } catch (err) {
      // Fail closed — don't let a malformed regex silently bypass the guard.
      return {
        allow: false,
        reason: `[TDD Guard] srcPattern/testPattern 정규식 오류: ${err.message}`,
      };
    }

    // Editing a test file is always fine — that's exactly what we want first.
    if (testRe.test(filePath)) return { allow: true };

    // Editing something that isn't a src file either is also out of scope
    // (docs, configs, etc. — the guard only restricts src mutations).
    if (!srcRe.test(filePath)) return { allow: true };

    // src edit — require at least one prior test edit recorded in this phase.
    const phaseTools = this.state && typeof this.state.phaseTools === "function"
      ? this.state.phaseTools(phase.id)
      : [];
    const hadTestEdit = phaseTools.some(
      (t) =>
        (t.tool === "Edit" || t.tool === "Write") &&
        t.filePath &&
        testRe.test(t.filePath)
    );
    if (!hadTestEdit) {
      const msg =
        rule.message ||
        "[TDD Guard] 대응 테스트 파일을 먼저 편집해야 합니다 (Stage 1).";
      return { allow: false, reason: msg };
    }

    // Slice Q (v6) — Stage 2: also require a recorded failing test run in
    // this phase. Parser returning null (unknown format) does NOT satisfy.
    if (rule.stage === "failing-proof") {
      const hasFailing =
        this.state &&
        typeof this.state.hasFailingTestRun === "function" &&
        this.state.hasFailingTestRun(phase.id);
      if (!hasFailing) {
        const msg =
          rule.failingProofMessage ||
          rule.message ||
          "[TDD Guard Stage 2] 실패하는 테스트가 먼저 기록되어야 src 편집이 허용됩니다.";
        return { allow: false, reason: msg };
      }
    }

    return { allow: true };
  }
}

function _extractFilePath(input) {
  if (!input || typeof input !== "object") return null;
  return input.file_path || input.filePath || input.path || null;
}

module.exports = { TddGuard };
