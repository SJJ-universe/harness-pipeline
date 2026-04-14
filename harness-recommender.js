const { detectTechStack } = require("./context-loader");
const { getSkillsForHarness } = require("./skill-registry");

const HARNESS_TYPES = {
  planning: {
    id: "planning",
    name: "계획 수립",
    icon: "📋",
    description: "작업 범위 정의 및 구현 계획 수립",
    phases: ["context", "plan", "critique", "refine"],
  },
  implementation: {
    id: "implementation",
    name: "구현",
    icon: "⚡",
    description: "계획에 따른 코드 작성 및 구현",
    phases: ["context", "plan", "critique", "refine", "execute", "validate"],
  },
  "code-review": {
    id: "code-review",
    name: "코드 리뷰",
    icon: "🔍",
    description: "보안, 안정성, 가독성 다중 관점 리뷰",
    phases: ["context", "plan", "critique", "refine", "execute", "validate"],
  },
  testing: {
    id: "testing",
    name: "테스트",
    icon: "🧪",
    description: "테스트 작성 및 커버리지 개선",
    phases: ["context", "plan", "critique", "refine", "execute", "validate"],
  },
  debugging: {
    id: "debugging",
    name: "디버깅",
    icon: "🐛",
    description: "버그 분석 및 수정",
    phases: ["context", "plan", "execute", "validate"],
  },
  refactoring: {
    id: "refactoring",
    name: "리팩토링",
    icon: "♻️",
    description: "코드 품질 개선 및 기술 부채 해소",
    phases: ["context", "plan", "critique", "refine", "execute", "validate"],
  },
  deployment: {
    id: "deployment",
    name: "배포",
    icon: "🚀",
    description: "CI/CD 파이프라인 및 배포 설정",
    phases: ["context", "plan", "critique", "execute", "validate"],
  },
};

// Natural flow from one harness to the next
const FLOW_MAP = {
  planning: ["implementation", "code-review"],
  implementation: ["code-review", "testing"],
  "code-review": ["debugging", "refactoring", "testing"],
  testing: ["debugging", "deployment"],
  debugging: ["testing", "code-review"],
  refactoring: ["code-review", "testing"],
  deployment: ["testing"],
};

function recommendNext(completedHarnessId, projectContext) {
  const candidates = FLOW_MAP[completedHarnessId] || [];
  const recommendations = [];

  for (const harnessId of candidates) {
    const harness = HARNESS_TYPES[harnessId];
    if (!harness) continue;

    const skills = getSkillsForHarness(harnessId);
    const reason = generateReason(completedHarnessId, harnessId, projectContext);

    recommendations.push({
      ...harness,
      reason,
      skillCount: skills.length,
      priority: candidates.indexOf(harnessId),
    });
  }

  // Add project-state-based recommendations
  if (projectContext) {
    const extraRecs = analyzeProjectState(projectContext, completedHarnessId);
    for (const rec of extraRecs) {
      if (!recommendations.find((r) => r.id === rec.id)) {
        recommendations.push(rec);
      }
    }
  }

  return recommendations.sort((a, b) => a.priority - b.priority);
}

function generateReason(fromId, toId, ctx) {
  const reasons = {
    "planning→implementation": "계획이 완료되었습니다. 구현을 시작하시겠습니까?",
    "planning→code-review": "계획을 리뷰하여 누락된 부분을 확인합니다",
    "implementation→code-review": "구현된 코드를 리뷰하시겠습니까?",
    "implementation→testing": "구현된 코드의 테스트를 작성합니다",
    "code-review→debugging": "리뷰에서 발견된 이슈를 수정합니다",
    "code-review→refactoring": "코드 품질 개선이 필요합니다",
    "code-review→testing": "리뷰 완료 후 테스트를 보강합니다",
    "testing→debugging": "실패한 테스트의 원인을 분석합니다",
    "testing→deployment": "테스트 통과 — 배포 준비가 가능합니다",
    "debugging→testing": "수정 후 테스트로 검증합니다",
    "debugging→code-review": "수정 사항을 리뷰합니다",
    "refactoring→code-review": "리팩토링 결과를 리뷰합니다",
    "refactoring→testing": "리팩토링 후 기존 테스트가 통과하는지 확인합니다",
    "deployment→testing": "배포 전 최종 테스트를 실행합니다",
  };
  return reasons[`${fromId}→${toId}`] || `${HARNESS_TYPES[fromId]?.name || fromId} 완료 후 권장되는 다음 단계입니다`;
}

function analyzeProjectState(ctx, completedId) {
  const recs = [];

  // If there are test files but low coverage signals
  if (ctx.techStack?.tools?.includes("testing") && completedId !== "testing") {
    recs.push({
      ...HARNESS_TYPES.testing,
      reason: "프로젝트에 테스트 프레임워크가 설정되어 있습니다",
      priority: 5,
      skillCount: getSkillsForHarness("testing").length,
    });
  }

  // If Docker is present but not recently worked on
  if (ctx.techStack?.tools?.includes("docker") && completedId !== "deployment") {
    recs.push({
      ...HARNESS_TYPES.deployment,
      reason: "Docker 설정이 감지되었습니다",
      priority: 6,
      skillCount: getSkillsForHarness("deployment").length,
    });
  }

  return recs;
}

function getHarnessTypes() {
  return Object.values(HARNESS_TYPES);
}

function getHarnessById(id) {
  return HARNESS_TYPES[id] || null;
}

module.exports = { recommendNext, getHarnessTypes, getHarnessById, HARNESS_TYPES };
