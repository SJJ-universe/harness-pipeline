# Harness Design — Level 2 → Level 4 로드맵 구현 설계

> 작성일: 2026-04-14
> 대상 성숙도: Observable(2) → Directive(3) → Adaptive(4)
> 상위 문서: `HARNESS-ENGINEERING-GUIDE.md`

---

## 0. 설계 원칙

1. **하네스는 관찰자가 아니라 조종자** — 현재 SessionWatcher는 뒷북 관찰만 하지만, 설계 후 하네스는 Claude의 다음 행동을 실제로 강제·유도한다.
2. **Codex는 대화 상대가 아니라 품질 게이트** — Codex는 사람이 한 번씩 부르는 도구가 아니라, 파이프라인이 자동으로 호출하는 2차 검증자다.
3. **상태는 Phase 사이를 흐른다** — Phase B의 결과물(계획)이 Phase C의 입력(검토 대상)이 되고, Phase C의 피드백이 Phase D의 입력이 된다. 이 흐름이 `PipelineState`다.
4. **품질 게이트는 통과 기준을 코드로 가진다** — "다음 Phase로 가도 되는가?"를 판단하는 로직을 `QualityGate`가 소유한다.
5. **설계는 선언적, 실행은 절차적** — 파이프라인은 JSON으로 선언하고, 실행기는 그 선언을 읽어서 하네스 루프를 돈다.

---

## 1. 전체 아키텍처

```
 ┌───────────────────────────────────────────────────────────────┐
 │                      Claude Code (Terminal)                    │
 │                                                                 │
 │  PreToolUse ─┐   PostToolUse ─┐   Stop ─┐   UserPromptSubmit ─┐│
 └──────┼──────────────┼────────────┼────────────┼────────────────┘
        │              │            │            │
        ▼              ▼            ▼            ▼
 ┌───────────────────────────────────────────────────────────────┐
 │                 Harness Hook Bridge (hooks/harness-hook.js)    │
 │     stdin JSON → HTTP POST /api/hook → JSON response            │
 └──────────────────────────┬────────────────────────────────────┘
                            │
                            ▼
 ┌───────────────────────────────────────────────────────────────┐
 │                    Dashboard Server (server.js)                 │
 │                                                                 │
 │   POST /api/hook ──► HookRouter                                 │
 │                         │                                       │
 │                         ├──► PipelineExecutor  (run loop)       │
 │                         │      ├── PipelineState (shared data)  │
 │                         │      ├── QualityGate  (exit criteria) │
 │                         │      ├── SkillInjector (prompt aug)   │
 │                         │      ├── CodexRunner   (subprocess)   │
 │                         │      └── PipelineAdapter (mutation)   │
 │                         │                                       │
 │                         └──► WebSocket broadcast → UI            │
 └───────────────────────────────────────────────────────────────┘
```

**레이어 책임**
- **Hook Bridge**: Claude Code가 내보내는 이벤트를 HTTP로 변환.
- **HookRouter**: 이벤트 종류별로 `PipelineExecutor`의 적절한 메서드를 호출.
- **PipelineExecutor**: 현재 활성 파이프라인의 상태를 보유하고 Phase 전이를 관리.
- **데이터 모듈**: 상태/게이트/스킬/어댑터는 서로 독립, Executor가 조립.

---

## 2. Phase 1 — Hook 인프라 (Level 2 → 3의 진입점)

### 2.1 현재의 한계

`session-watcher.js`는 JSONL 파일을 2초 주기로 polling한다. 문제:
- **지연**: 최악 2초, 평균 1초의 지연.
- **사후성**: 이미 실행된 tool_use를 읽을 뿐, 막거나 수정할 수 없다.
- **단방향**: 하네스가 Claude에게 피드백을 돌려줄 통로가 없다.

Hook은 이 셋을 모두 해결한다. Claude Code가 `PreToolUse`에서 동기적으로 결과를 기다리므로, 하네스는 `{"decision": "block", "reason": "..."}`로 실제 차단이 가능하다.

### 2.2 Hook 설정 (`.claude/settings.json`)

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "node C:/Users/SJ/workspace/pipeline-dashboard/hooks/harness-hook.js user-prompt" }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Edit|Write|Bash",
        "hooks": [
          { "type": "command", "command": "node C:/Users/SJ/workspace/pipeline-dashboard/hooks/harness-hook.js pre-tool" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "node C:/Users/SJ/workspace/pipeline-dashboard/hooks/harness-hook.js post-tool" }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "node C:/Users/SJ/workspace/pipeline-dashboard/hooks/harness-hook.js stop" }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "node C:/Users/SJ/workspace/pipeline-dashboard/hooks/harness-hook.js session-end" }
        ]
      }
    ]
  }
}
```

- `PreToolUse`의 `matcher`를 `Edit|Write|Bash`로 좁힌 이유: Read/Glob/Grep은 사이드 이펙트가 없어 차단 필요가 없고, 매 호출 hook 왕복은 오버헤드다.
- `UserPromptSubmit`은 사용자가 새 태스크를 던진 순간을 잡아 파이프라인 시작의 신호로 쓴다.
- `Stop`은 어시스턴트가 한 턴을 끝낸 시점. Phase 전이 판단의 주된 트리거.
- `SessionEnd`는 세션 종료 시 파이프라인 정리.

### 2.3 `hooks/harness-hook.js` (신규)

Claude Code는 hook 스크립트에 **JSON을 stdin으로** 넘기고, stdout의 JSON을 파싱한다. 하네스 브리지는 그 JSON을 대시보드 서버로 릴레이한다.

```javascript
// pipeline-dashboard/hooks/harness-hook.js
const http = require("http");

const [,, eventType] = process.argv;
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", async () => {
  let payload = {};
  try { payload = JSON.parse(Buffer.concat(chunks).toString("utf-8")); } catch (_) {}

  const body = JSON.stringify({ event: eventType, payload });
  const req = http.request({
    host: "127.0.0.1",
    port: 4200,
    path: "/api/hook",
    method: "POST",
    headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
    timeout: 1500,
  }, (res) => {
    const out = [];
    res.on("data", (c) => out.push(c));
    res.on("end", () => {
      // 서버 응답을 그대로 Claude Code에 돌려준다
      process.stdout.write(Buffer.concat(out).toString("utf-8") || "{}");
      process.exit(0);
    });
  });
  req.on("error", () => process.exit(0));   // 실패해도 Claude를 막지 않는다
  req.on("timeout", () => { req.destroy(); process.exit(0); });
  req.write(body);
  req.end();
});
```

**설계 포인트**
- 서버가 없어도 Claude는 멈추면 안 된다 → 모든 에러 경로에서 `exit(0)`, stdout 빈 응답.
- 타임아웃 1.5초 → 하네스 장애가 Claude 응답 지연으로 번지지 않도록.

### 2.4 `/api/hook` 엔드포인트

```javascript
// server.js 추가
app.post("/api/hook", async (req, res) => {
  const { event, payload } = req.body;
  const decision = await hookRouter.route(event, payload);
  res.json(decision || {});
});
```

`HookRouter.route`는 이벤트별로 분기:

| event | 호출 | 응답 |
|---|---|---|
| `user-prompt` | `executor.startFromPrompt(payload.prompt)` | `{}` |
| `pre-tool` | `executor.onPreTool(payload.tool_name, payload.tool_input)` | 차단 시 `{"decision":"block","reason":"..."}` |
| `post-tool` | `executor.onPostTool(payload.tool_name, payload.tool_response)` | `{}` |
| `stop` | `executor.onStop()` | 다시 작업 요청 시 `{"decision":"block","reason":"..."}` |
| `session-end` | `executor.onSessionEnd()` | `{}` |

### 2.5 SessionWatcher의 운명

삭제하지 않는다. 하네스 hook이 설치되지 않은 사용자를 위한 **폴백**으로 남긴다. `PipelineExecutor.isHookDriven` 플래그가 true면 SessionWatcher는 broadcast를 건너뛴다.

---

## 3. Phase 2 — Pipeline Executor & Codex Runner (자동 호출)

### 3.1 현재의 한계

지금은 Codex를 파이프라인이 직접 부르지 않는다. "Phase C: Codex 검토"는 그림일 뿐, 실제로는 사용자가 `/plan-critic` 같은 걸 손으로 돌려야 한다.

하네스가 Codex를 진짜로 호출하려면:
- `codex exec --full-auto "<prompt>"` 를 자식 프로세스로 실행
- stdout에서 비평 결과를 받아 `PipelineState`에 주입
- 다음 Phase(Claude)의 프롬프트에 그 비평을 포함시킨다

### 3.2 `pipeline-executor.js` (신규, 핵심 모듈)

```javascript
class PipelineExecutor {
  constructor({ broadcast, templates, codexRunner, state, gates, injector, adapter }) {
    this.broadcast = broadcast;
    this.templates = templates;       // pipeline-templates.json
    this.codex = codexRunner;
    this.state = state;               // PipelineState
    this.gates = gates;               // QualityGate
    this.injector = injector;         // SkillInjector
    this.adapter = adapter;           // PipelineAdapter

    this.active = null;               // { templateId, template, phaseIdx, iteration }
    this.isHookDriven = false;
  }

  async startFromPrompt(userPrompt) {
    const templateId = this._detectTemplate(userPrompt);
    const template = this.templates[templateId];
    this.active = { templateId, template, phaseIdx: -1, iteration: 0 };
    this.state.reset({ userPrompt, templateId });

    this.broadcast({ type: "auto_pipeline_detect", data: { templateId, reason: "hook-driven" } });
    await this._enterPhase(0);
  }

  async onPreTool(tool, input) {
    const phase = this._currentPhase();
    if (!phase) return null;

    // 허용되지 않은 도구 차단
    const allowed = phase.allowedTools;
    if (allowed && !allowed.includes(tool)) {
      return {
        decision: "block",
        reason: `하네스 ${phase.label} 단계에서는 ${allowed.join(", ")}만 사용할 수 있습니다. 현재 도구: ${tool}`,
      };
    }
    return null;
  }

  async onPostTool(tool, response) {
    const phase = this._currentPhase();
    if (!phase) return;
    this.state.recordTool(phase.id, tool, response);
    this.broadcast({ type: "tool_recorded", data: { phase: phase.id, tool } });
  }

  async onStop() {
    const phase = this._currentPhase();
    if (!phase) return null;

    // 품질 게이트 평가
    const gateResult = await this.gates.evaluate(phase, this.state);
    if (!gateResult.pass) {
      // 실패: 다음 phase로 넘어가지 못하게 차단 + 이유를 Claude에 피드백
      return {
        decision: "block",
        reason: `${phase.label} 미완료: ${gateResult.reason}\n필요 작업: ${gateResult.missing.join(", ")}`,
      };
    }

    // 통과: 다음 phase로
    await this._advance();
    return null;
  }

  async _enterPhase(idx) {
    this.active.phaseIdx = idx;
    const phase = this.active.template.phases[idx];

    // 스킬 주입: SKILL.md 내용을 현재 세션에 컨텍스트로 주입
    const skillContext = await this.injector.gather(phase);
    if (skillContext) this.state.setSkillContext(phase.id, skillContext);

    this.broadcast({ type: "phase_update", data: { phase: phase.id, status: "active" } });

    // Codex phase라면 자동 실행
    if (phase.agent === "codex") {
      await this._runCodexPhase(phase);
    }
  }

  async _runCodexPhase(phase) {
    const prompt = this.injector.buildCodexPrompt(phase, this.state);
    this.broadcast({ type: "node_update", data: { node: phase.nodes[0].id, status: "running" } });

    const result = await this.codex.exec(prompt, { timeoutMs: phase.timeoutMs || 120000 });
    this.state.setCritique(phase.id, result);

    this.broadcast({ type: "node_update", data: { node: phase.nodes[0].id, status: "completed" } });
    this.broadcast({ type: "critique_received", data: { phase: phase.id, summary: result.summary } });

    // Codex 비평 후, 루프 phase라면 다음 반복을 돌릴지 판단
    if (phase.cycle) {
      const gateResult = await this.gates.evaluate(phase, this.state);
      if (!gateResult.pass && this.active.iteration < (phase.maxIterations || 3)) {
        this.active.iteration++;
        // linkedCycle(예: D가 C와 묶인) 다시 Claude로 돌려보낸다
        const refinePhase = this._findPhase(phase.linkedCycle);
        if (refinePhase) {
          await this._enterPhase(refinePhase.index);
          return;
        }
      }
    }

    // 자동으로 다음 phase 진행
    await this._advance();
  }

  async _advance() {
    const next = this.active.phaseIdx + 1;
    if (next >= this.active.template.phases.length) {
      this._complete();
      return;
    }

    // 어댑터에게 "이 다음 phase 그대로 가도 되는가" 질의
    const mutation = await this.adapter.review(this.active, this.state);
    if (mutation) this._applyMutation(mutation);

    await this._enterPhase(next);
  }

  _complete() {
    this.broadcast({ type: "pipeline_complete", data: { harnessId: this.active.templateId, state: this.state.snapshot() } });
    this.active = null;
  }
}
```

**설계 포인트**
- `onPreTool`이 `decision: "block"`을 돌려주면 Claude는 해당 도구를 실행하지 못한다. 이것이 "조종"의 정체.
- `onStop`에서 품질 게이트가 실패하면 Claude는 턴을 끝내지 못하고 `reason`을 받아 다시 작업한다. 이것이 Level 3 Directive.
- Codex phase는 `_runCodexPhase`에서 자식 프로세스로 실행. 사용자 개입 없음.

### 3.3 `codex-runner.js` (신규)

```javascript
const { spawn } = require("child_process");

class CodexRunner {
  exec(prompt, { timeoutMs = 120000 } = {}) {
    return new Promise((resolve) => {
      const child = spawn("codex", ["exec", "--full-auto", prompt], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      const out = [];
      const err = [];
      const timer = setTimeout(() => child.kill(), timeoutMs);

      child.stdout.on("data", (c) => out.push(c));
      child.stderr.on("data", (c) => err.push(c));
      child.on("close", (code) => {
        clearTimeout(timer);
        const stdout = Buffer.concat(out).toString("utf-8");
        resolve({
          ok: code === 0,
          stdout,
          stderr: Buffer.concat(err).toString("utf-8"),
          summary: this._extractSummary(stdout),
          findings: this._extractFindings(stdout),
        });
      });
      child.on("error", () => resolve({ ok: false, stdout: "", stderr: "spawn failed", summary: "", findings: [] }));
    });
  }

  _extractSummary(stdout) {
    // Codex 출력의 마지막 '## Summary' 블록 또는 마지막 300자
    const m = stdout.match(/##\s*Summary[\s\S]*?(?=\n##|\n*$)/i);
    return m ? m[0].trim() : stdout.slice(-300);
  }

  _extractFindings(stdout) {
    // "- [severity] message" 형식 라인 파싱
    const lines = stdout.split("\n");
    return lines
      .map((l) => l.match(/^[-*]\s*\[(critical|high|medium|low)\]\s*(.+)$/i))
      .filter(Boolean)
      .map((m) => ({ severity: m[1].toLowerCase(), message: m[2] }));
  }
}
```

**설계 포인트**
- `--full-auto` 모드로 승인 없이 실행.
- 타임아웃 기본 120초 (계획 비평 수준의 작업).
- `summary`/`findings`는 heuristic 추출 — Codex 프롬프트에 특정 출력 형식을 강제하면 파싱이 안정화된다 (`SkillInjector.buildCodexPrompt`에서).

---

## 4. Phase 3 — State, Quality Gate, Skill Injector

### 4.1 `PipelineState` (신규)

Phase 사이의 데이터 흐름 계약. Phase B(계획)의 산출물이 Phase C(비평)의 입력으로, C의 비평이 D(보완)의 입력으로 흐른다.

```javascript
class PipelineState {
  constructor() {
    this.reset();
  }
  reset(meta = {}) {
    this.meta = meta;                     // { userPrompt, templateId, startedAt }
    this.phases = {};                     // id → { tools[], artifacts{}, critique, skillContext }
    this.findings = [];                   // 누적 findings (모든 critique 합본)
    this.metrics = { filesEdited: new Set(), bashCommands: 0, toolCount: 0 };
  }
  recordTool(phaseId, tool, response) {
    const p = this._ensurePhase(phaseId);
    p.tools.push({ tool, at: Date.now() });
    this.metrics.toolCount++;
    if (tool === "Edit" || tool === "Write") {
      const path = response?.filePath || response?.file_path;
      if (path) this.metrics.filesEdited.add(path);
    }
    if (tool === "Bash") this.metrics.bashCommands++;
  }
  setArtifact(phaseId, key, value) {
    this._ensurePhase(phaseId).artifacts[key] = value;
  }
  getArtifact(phaseId, key) {
    return this.phases[phaseId]?.artifacts[key];
  }
  setCritique(phaseId, critique) {
    this._ensurePhase(phaseId).critique = critique;
    if (critique?.findings) this.findings.push(...critique.findings);
  }
  setSkillContext(phaseId, text) {
    this._ensurePhase(phaseId).skillContext = text;
  }
  snapshot() {
    return {
      meta: this.meta,
      findings: this.findings,
      metrics: { ...this.metrics, filesEdited: [...this.metrics.filesEdited] },
      phaseCount: Object.keys(this.phases).length,
    };
  }
  _ensurePhase(id) {
    if (!this.phases[id]) this.phases[id] = { tools: [], artifacts: {}, critique: null, skillContext: null };
    return this.phases[id];
  }
}
```

### 4.2 `QualityGate` (신규)

Phase 전이를 판단하는 규칙 엔진. 각 Phase 선언에 `exitCriteria`를 추가해 게이트가 이걸 평가한다.

```javascript
class QualityGate {
  async evaluate(phase, state) {
    const criteria = phase.exitCriteria || [];
    const missing = [];

    for (const c of criteria) {
      const ok = await this._check(c, phase, state);
      if (!ok) missing.push(c.message || c.type);
    }

    return {
      pass: missing.length === 0,
      missing,
      reason: missing.length === 0 ? "all criteria met" : missing.join("; "),
    };
  }

  async _check(c, phase, state) {
    switch (c.type) {
      case "min-tools":
        return (state.phases[phase.id]?.tools.length || 0) >= c.count;
      case "has-artifact":
        return state.getArtifact(phase.id, c.key) != null;
      case "no-critical-findings":
        return !state.findings.some((f) => f.severity === "critical");
      case "critique-received":
        return state.phases[phase.id]?.critique != null;
      case "files-edited":
        return state.metrics.filesEdited.size >= (c.min || 1);
      case "bash-ran":
        return state.metrics.bashCommands >= (c.min || 1);
      case "custom":
        return await c.fn(phase, state);      // 인라인 함수 (코드에서 정의한 템플릿)
      default:
        return true;
    }
  }
}
```

### 4.3 `SkillInjector` (신규)

Skills 라이브러리의 SKILL.md 내용을 파이프라인 프롬프트로 주입한다.

```javascript
class SkillInjector {
  constructor(skillRegistry) {
    this.registry = skillRegistry;       // 기존 skill-registry.js
  }

  async gather(phase) {
    if (!phase.skill) return null;
    const skill = await this.registry.load(phase.skill);
    if (!skill) return null;
    return skill.content;                  // SKILL.md 본문
  }

  buildCodexPrompt(phase, state) {
    const lines = [];
    lines.push(`# Task: ${phase.name}`);
    lines.push("");
    lines.push(`## Context`);
    lines.push(`User goal: ${state.meta.userPrompt}`);
    lines.push("");

    if (phase.skill) {
      lines.push(`## Guidelines`);
      const sc = state.phases[phase.id]?.skillContext;
      if (sc) lines.push(sc);
      lines.push("");
    }

    // 이전 phase의 산출물을 Codex에게 보여준다
    const prevPhase = this._previousArtifactPhase(phase, state);
    if (prevPhase) {
      lines.push(`## Previous Phase Output (${prevPhase.id})`);
      const plan = state.getArtifact(prevPhase.id, "plan");
      if (plan) lines.push(plan);
      lines.push("");
    }

    lines.push(`## Required Output Format`);
    lines.push(`Provide findings as bullet list:`);
    lines.push(`- [critical|high|medium|low] <issue>`);
    lines.push(``);
    lines.push(`End with "## Summary" section.`);

    return lines.join("\n");
  }
}
```

### 4.4 확장된 `pipeline-templates.json` 스키마

```json
{
  "default": {
    "id": "default",
    "name": "범용 태스크 파이프라인",
    "phases": [
      {
        "id": "A",
        "label": "Phase A",
        "name": "컨텍스트 수집",
        "agent": "claude",
        "skill": "superpowers:context-gathering",
        "allowedTools": ["Read", "Glob", "Grep", "Agent"],
        "exitCriteria": [
          { "type": "min-tools", "count": 3, "message": "최소 3개 파일 이상 탐색 필요" }
        ],
        "nodes": [ { "id": "context-analyzer", "icon": "🔎", "iconType": "emoji", "label": "Context Analyzer" } ]
      },
      {
        "id": "B",
        "label": "Phase B",
        "name": "계획 수립",
        "agent": "claude",
        "skill": "superpowers:writing-plans",
        "allowedTools": ["Read", "Glob", "Grep", "TodoWrite", "Write"],
        "exitCriteria": [
          { "type": "has-artifact", "key": "plan", "message": "계획 문서가 작성되지 않음" }
        ],
        "nodes": [ { "id": "task-planner", "icon": "C", "iconType": "claude", "label": "Claude Code" } ]
      },
      {
        "id": "C",
        "label": "Phase C",
        "name": "계획 검토",
        "agent": "codex",
        "cycle": true,
        "maxIterations": 3,
        "linkedCycle": "D",
        "timeoutMs": 120000,
        "exitCriteria": [
          { "type": "critique-received" },
          { "type": "no-critical-findings", "message": "critical 이슈가 남아있음" }
        ],
        "nodes": [ { "id": "plan-critic", "icon": "X", "iconType": "codex", "label": "Codex CLI" } ]
      },
      {
        "id": "D",
        "label": "Phase D",
        "name": "계획 보완",
        "agent": "claude",
        "allowedTools": ["Edit", "Write"],
        "exitCriteria": [
          { "type": "has-artifact", "key": "plan" }
        ],
        "nodes": [ { "id": "plan-refiner", "icon": "C", "iconType": "claude", "label": "Claude Code" } ]
      },
      {
        "id": "E",
        "label": "Phase E",
        "name": "실행",
        "agent": "claude",
        "allowedTools": ["Edit", "Write", "Bash", "Read"],
        "exitCriteria": [
          { "type": "files-edited", "min": 1, "message": "실제 파일 수정이 없음" }
        ],
        "nodes": [ { "id": "executor", "icon": "⚡", "iconType": "emoji", "label": "Executor" } ]
      },
      {
        "id": "F",
        "label": "Phase F",
        "name": "검증",
        "agent": "claude",
        "allowedTools": ["Bash", "Read"],
        "exitCriteria": [
          { "type": "bash-ran", "min": 1, "message": "검증 명령 미실행" }
        ],
        "nodes": [ { "id": "validator", "icon": "✓", "iconType": "emoji", "label": "Validator" } ]
      }
    ]
  }
}
```

**스키마 추가 항목**
- `agent`: `"claude"` | `"codex"` — Codex phase는 Executor가 자동 실행.
- `skill`: 해당 phase에 주입할 SKILL.md 식별자.
- `allowedTools`: 이 phase에서 사용 가능한 도구 whitelist (`PreToolUse`에서 차단 판정).
- `exitCriteria`: 배열. 모두 만족해야 다음 phase로 진행.
- `timeoutMs`: Codex phase의 최대 실행 시간.
- `cycle`/`linkedCycle`: 기존 유지, Executor가 iteration 카운트 관리.

### 4.5 산출물 수집 방식

`PipelineState.setArtifact`는 누가 호출하나? 두 가지 경로:

1. **파일 기반**: `post-tool` 훅에서 `Write`를 감지하면, 파일 경로를 보고 역할을 추정. `*plan*.md` → `artifacts.plan`, `*findings*.md` → `artifacts.findings`.
2. **명시 선언**: 템플릿에 `artifactRules`를 두고 regex 매핑.

```json
"artifactRules": [
  { "toolMatch": "Write", "pathMatch": "plan.*\\.md$", "artifactKey": "plan" }
]
```

Executor의 `onPostTool`이 이 규칙을 적용해 `state.setArtifact`를 호출한다.

---

## 5. Phase 4 — Adaptive Pipeline

### 5.1 목적

실행 중 발견된 사실에 따라 파이프라인을 **런타임에 변형**한다. 예:
- Phase C에서 critical finding 발견 → Phase E(실행) 앞에 "Phase E0: 긴급 수정" 삽입
- Phase E에서 파일 20개가 수정됨 → Phase F(검증)에 `testing` 템플릿의 일부를 병합
- Phase C가 3회 반복해도 pass 못함 → `debugging` 템플릿으로 전환

### 5.2 `PipelineAdapter` (신규)

```javascript
class PipelineAdapter {
  constructor(templates) {
    this.templates = templates;
    this.rules = this._loadRules();
  }

  async review(active, state) {
    for (const rule of this.rules) {
      if (await rule.when(active, state)) {
        return rule.mutation(active, state);
      }
    }
    return null;
  }

  _loadRules() {
    return [
      {
        name: "insert-hotfix-on-critical",
        when: (a, s) => s.findings.some((f) => f.severity === "critical") && !a._hotfixInserted,
        mutation: (a, s) => ({
          type: "insert-phase",
          at: a.phaseIdx + 1,
          phase: {
            id: "E0",
            label: "Phase E0",
            name: "긴급 수정",
            agent: "claude",
            allowedTools: ["Edit", "Write"],
            exitCriteria: [{ type: "no-critical-findings" }],
            nodes: [{ id: "hotfix", icon: "🚨", iconType: "emoji", label: "Hotfix" }],
          },
          mark: "_hotfixInserted",
        }),
      },
      {
        name: "switch-to-debugging-on-stuck-cycle",
        when: (a, s) => a.iteration >= 3 && this._currentPhase(a).cycle,
        mutation: () => ({ type: "switch-template", to: "debugging" }),
      },
      {
        name: "merge-testing-when-many-edits",
        when: (a, s) => s.metrics.filesEdited.size >= 20 && !a._testingMerged,
        mutation: (a) => ({
          type: "merge-template",
          from: "testing",
          at: a.phaseIdx + 1,
          mark: "_testingMerged",
        }),
      },
    ];
  }
}
```

### 5.3 Executor에서 mutation 적용

```javascript
_applyMutation(mutation) {
  const tpl = this.active.template;
  switch (mutation.type) {
    case "insert-phase":
      tpl.phases.splice(mutation.at, 0, mutation.phase);
      break;
    case "switch-template": {
      const next = this.templates[mutation.to];
      if (next) {
        this.active.template = structuredClone(next);
        this.active.phaseIdx = -1;
      }
      break;
    }
    case "merge-template": {
      const src = this.templates[mutation.from];
      if (src) tpl.phases.splice(mutation.at, 0, ...structuredClone(src.phases));
      break;
    }
  }
  if (mutation.mark) this.active[mutation.mark] = true;

  this.broadcast({ type: "pipeline_mutated", data: { mutation: mutation.type, templateId: this.active.templateId } });
}
```

### 5.4 UI 반응

`pipeline_mutated` 이벤트를 받으면 `app.js`가 현재 렌더된 파이프라인을 다시 그린다 (`renderPipeline(active.template)`). 사용자는 phase가 런타임에 늘어나는 것을 눈으로 본다.

---

## 6. 파일 구조 (신규/수정)

```
pipeline-dashboard/
├── hooks/
│   └── harness-hook.js            [신규] Claude Code → 서버 브리지
├── executor/
│   ├── pipeline-executor.js       [신규] Phase 전이 관리자
│   ├── pipeline-state.js          [신규] 상태 컨테이너
│   ├── quality-gate.js            [신규] exitCriteria 평가
│   ├── skill-injector.js          [신규] SKILL.md 주입
│   ├── codex-runner.js            [신규] codex exec 서브프로세스
│   ├── pipeline-adapter.js        [신규] 런타임 mutation
│   └── hook-router.js             [신규] 이벤트 분기
├── pipeline-templates.json        [수정] 스키마 확장 (agent/skill/allowedTools/exitCriteria)
├── skill-registry.js              [기존] SkillInjector가 사용
├── server.js                      [수정] /api/hook 엔드포인트 + executor 초기화
├── session-watcher.js             [기존] 폴백으로 유지
├── public/app.js                  [수정] pipeline_mutated, critique_received 핸들
└── .claude/settings.json          [신규] 워크스페이스 hook 등록
```

---

## 7. 이벤트 프로토콜 추가

| event | 트리거 | payload |
|---|---|---|
| `auto_pipeline_detect` | 기존, hook 경유로 변경 | `{ templateId, reason }` |
| `phase_update` | `_enterPhase`, gate pass | `{ phase, status }` |
| `tool_recorded` | `onPostTool` | `{ phase, tool }` |
| `critique_received` | Codex phase 완료 | `{ phase, summary, findings }` |
| `gate_failed` | `onStop` gate 실패 | `{ phase, missing, iteration }` |
| `pipeline_mutated` | Adapter mutation | `{ mutation, templateId }` |
| `pipeline_complete` | 마지막 phase 통과 | `{ harnessId, state }` |

---

## 8. 구현 순서

1. **Phase 1 (Hook 인프라)** — 이것부터. 없으면 나머지가 다 공중에 뜬다.
   - `harness-hook.js`, `.claude/settings.json`, `/api/hook`, `HookRouter` 뼈대
   - 이 단계에서 기존 `auto_pipeline_detect` 흐름과 동등한 동작만 재현해도 됨 (실시간성만 확보)
2. **Phase 2 (Executor + Codex)** — Directive로의 전환.
   - `pipeline-executor.js`, `codex-runner.js`
   - `allowedTools` 차단, Codex 자동 호출까지
   - 이 시점에 템플릿 스키마 확장 필요
3. **Phase 3 (State + Gate + Injector)** — 품질 게이트 가동.
   - `pipeline-state.js`, `quality-gate.js`, `skill-injector.js`
   - `exitCriteria`, `artifactRules` 적용
   - 기존 템플릿 3개(default/code-review/testing)를 새 스키마로 마이그레이션
4. **Phase 4 (Adapter)** — Adaptive.
   - `pipeline-adapter.js` + `pipeline_mutated` UI 반응
   - 초기 규칙 3개만: hotfix 삽입, debugging 전환, testing 병합

각 Phase는 앞 Phase 없이 동작하지 않는다. 순차 구현.

---

## 9. 검증 시나리오

1. **Phase 1 검증**: 터미널에서 `Read` 호출 → 대시보드가 2초 미만 지연으로 `tool_recorded` 수신.
2. **Phase 2 검증**: 기본 파이프라인 진입 후 `Bash` 호출 시도 → Phase A에서는 `decision: block` 응답, 차단 이유가 Claude 응답에 나타남.
3. **Phase 2 검증 (Codex)**: 계획 문서 작성 후 Phase C 진입 → 사용자 개입 없이 `codex exec` 실행 → 대시보드에 `critique_received` 표시.
4. **Phase 3 검증**: critical finding 포함한 Codex 응답 → Phase C → D 순환, iteration 카운트 증가, 최대 3회 후 포기.
5. **Phase 3 검증 (gate)**: Phase E에서 파일 수정 없이 Stop → `gate_failed` 브로드캐스트, Claude에 "파일 수정이 없음" reason 피드백.
6. **Phase 4 검증**: Phase C에서 critical finding → `E0 긴급 수정` phase가 자동 삽입되어 UI가 다시 렌더링, Claude는 E0부터 실행.

---

## 10. 설계상의 리스크

- **hook 설치 부담**: `.claude/settings.json`이 사용자 워크스페이스마다 필요. `bootstrap-harness.js` 같은 설치 스크립트를 함께 제공해야 한다.
- **block 남용 위험**: `allowedTools`가 과하게 좁으면 Claude가 루프에 갇힌다. 기본값은 관대하게, 각 phase별로 점진적으로 조인다.
- **Codex 호출 비용**: 모든 Phase C가 Codex를 자동으로 부르면 토큰/시간 소모. `phase.agent === "codex"`를 템플릿당 1~2개로 제한.
- **Adapter 무한 mutation**: 규칙이 서로를 트리거하면 루프. mutation 적용 시 `mark` 플래그 필수, 동일 mark는 한 세션에 한 번만.
- **파싱 안정성**: Codex 출력 파싱은 heuristic. 프롬프트에서 `## Summary` 섹션과 finding 형식을 강하게 요구해야 `_extractFindings`가 깨지지 않는다.
