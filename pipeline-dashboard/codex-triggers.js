// On-demand Codex triggers.
//
// Each trigger defines:
//   - id:            stable key used by the UI + API
//   - name:          short label shown on the card
//   - description:   one-line hint shown under the label
//   - color:         css variant class applied to .recommend-card
//   - contextSource: how the server resolves the context to feed Codex
//                    ("plan" | "git-diff" | "user-input")
//   - promptTemplate(context): builds the Codex prompt string
//
// Server side resolves the context, builds the prompt, calls CodexRunner,
// persists the result to _workspace/codex-trigger-{id}-{ts}.md, and returns
// { ok, summary, findings, filePath } to the UI.

const TRIGGERS = [
  {
    id: "plan-verify",
    name: "계획 검증",
    description: "현재 plan.md를 Codex에게 비평받기",
    color: "plan",
    contextSource: "plan",
    timeoutMs: 600000,
    promptTemplate(ctx) {
      return [
        "당신은 시니어 엔지니어입니다. 아래 구현 계획을 읽고 위험 요소, 누락된 단계, 애매한 가정, 순서상 문제를 지적하세요.",
        "",
        "출력 형식:",
        "## Summary",
        "한 문단으로 전반적 평가를 작성",
        "",
        "## Findings",
        "- [critical|high|medium|low] 구체적 문제 한 줄 (근거 포함)",
        "",
        "---",
        "# 계획 문서",
        ctx,
      ].join("\n");
    },
  },
  {
    id: "code-review",
    name: "코드 리뷰",
    description: "작업 중 변경분(git diff HEAD)을 Codex에게 리뷰 요청",
    color: "review",
    contextSource: "git-diff",
    timeoutMs: 300000,
    promptTemplate(ctx) {
      return [
        "당신은 꼼꼼한 코드 리뷰어입니다. 아래 git diff를 읽고 버그, 엣지 케이스, 성능 문제, 가독성 이슈를 지적하세요.",
        "추측성 제안은 피하고, 실제 diff에 근거한 문제만 보고하세요.",
        "",
        "출력 형식:",
        "## Summary",
        "한 문단 요약",
        "",
        "## Findings",
        "- [critical|high|medium|low] 파일:행 — 문제 설명",
        "",
        "---",
        "# Git Diff",
        ctx,
      ].join("\n");
    },
  },
  {
    id: "debug-analysis",
    name: "디버그 분석",
    description: "에러 로그/증상을 Codex에게 전달해 원인 분석 요청",
    color: "debug",
    contextSource: "user-input",
    timeoutMs: 300000,
    requiresInput: true,
    inputLabel: "에러 메시지 또는 증상을 붙여넣으세요",
    promptTemplate(ctx) {
      return [
        "당신은 디버깅 전문가입니다. 아래 에러/증상을 읽고 가장 가능성 높은 원인 3개를 제시하고 각각의 검증 방법을 적으세요.",
        "",
        "출력 형식:",
        "## Summary",
        "가장 유력한 원인 1줄 요약",
        "",
        "## Findings",
        "- [critical|high|medium|low] 원인 가설 — 검증 방법",
        "",
        "---",
        "# 증상",
        ctx,
      ].join("\n");
    },
  },
  {
    id: "security-review",
    name: "보안 검토",
    description: "작업 중 변경분을 보안 관점에서 감사",
    color: "security",
    contextSource: "git-diff",
    timeoutMs: 300000,
    promptTemplate(ctx) {
      return [
        "당신은 보안 감사관입니다. 아래 git diff에서 OWASP Top 10 관점의 취약점(SQL 인젝션, XSS, 인증 우회, 시크릿 노출, 경로 조작, 안전하지 않은 역직렬화 등)을 찾으세요.",
        "추측 말고 diff에 실제로 존재하는 코드에 근거한 취약점만 보고하세요.",
        "",
        "출력 형식:",
        "## Summary",
        "보안 전반 평가 한 문단",
        "",
        "## Findings",
        "- [critical|high|medium|low] 취약점 유형 — 파일:행 — 설명",
        "",
        "---",
        "# Git Diff",
        ctx,
      ].join("\n");
    },
  },
];

function getTriggers() {
  return TRIGGERS.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    color: t.color,
    contextSource: t.contextSource,
    requiresInput: !!t.requiresInput,
    inputLabel: t.inputLabel || null,
    timeoutMs: t.timeoutMs,
  }));
}

function getTriggerById(id) {
  return TRIGGERS.find((t) => t.id === id) || null;
}

module.exports = { getTriggers, getTriggerById, TRIGGERS };
