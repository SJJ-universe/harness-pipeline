"use strict";
// 하네스 파이프라인 데모 — 클라이언트. 외부 라이브러리 없음.

// ---------------------------------------------------------------- 정책 (서버 PIPELINE과 동일한 게이트)
const PHASES = [
  { id: "A", name: "컨텍스트 수집", role: "worker", tools: ["Read", "Glob", "Grep", "Agent", "TodoWrite"], bash: "blocked" },
  { id: "B", name: "계획 수립", role: "worker", tools: ["Read", "Glob", "Grep", "TodoWrite", "Write"], bash: "blocked" },
  { id: "C", name: "계획 비평", role: "critic", tools: [], bash: "blocked" },
  { id: "D", name: "계획 보완", role: "worker", tools: ["Read", "Glob", "Grep", "TodoWrite", "Write", "Edit"], bash: "blocked" },
  { id: "E", name: "실행 — 코드 작성", role: "worker", tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep", "TodoWrite"], bash: "allowlisted" },
  { id: "F", name: "검증·판정", role: "critic", tools: ["Read", "Bash", "Glob", "Grep"], bash: "allowlisted" },
];
const ALL_TOOLS = ["Read", "Glob", "Grep", "Agent", "TodoWrite", "Write", "Edit", "Bash"];
const BASH_ALLOWLIST = "npm test · npm run · node · git status/diff/log";
const ROLE_LABEL = { worker: "작업 AI", critic: "비평 AI" };

const $ = (sel) => document.querySelector(sel);

// ---------------------------------------------------------------- 실행 콘솔
const input = $("#task-input");
const runBtn = $("#run-btn");
const errBox = $("#run-error");
const board = $("#board");
const phasesEl = $("#phases");
const railEl = $("#rail-list");
const summaryEl = $("#run-summary");
let running = false;

document.querySelectorAll(".examples button").forEach((b) => {
  b.addEventListener("click", () => { input.value = b.dataset.task; input.focus(); });
});

function buildRail() {
  railEl.textContent = "";
  for (const p of PHASES) {
    const li = document.createElement("li");
    li.id = `rail-${p.id}`;
    li.innerHTML = `${p.id}. ${p.name}<span class="who">${ROLE_LABEL[p.role]}</span>`;
    railEl.appendChild(li);
  }
}

function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// 코드펜스만 분리하는 초소형 렌더러 — 나머지는 평문 유지
function renderContent(el, raw) {
  el.textContent = "";
  const parts = raw.split(/```[a-zA-Z0-9_-]*\n?/);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = part.replace(/\n$/, "");
      pre.appendChild(code);
      el.appendChild(pre);
    } else if (part.trim()) {
      const div = document.createElement("div");
      let h = esc(part.trim());
      h = h.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>").replace(/`([^`\n]+)`/g, "<code>$1</code>");
      div.innerHTML = h;
      el.appendChild(div);
    }
  });
}

function gateChips(phase) {
  const frag = document.createDocumentFragment();
  const label = document.createElement("span");
  label.className = "gate-label";
  label.textContent = "게이트";
  frag.appendChild(label);
  if (phase.tools.length === 0) {
    const c = document.createElement("span");
    c.className = "chip none";
    c.textContent = "작업 AI 도구 전면 차단 — 독립 비평만 수행";
    frag.appendChild(c);
    return frag;
  }
  for (const t of phase.tools) {
    const c = document.createElement("span");
    c.className = "chip";
    c.textContent = t;
    frag.appendChild(c);
  }
  ALL_TOOLS.filter((t) => !phase.tools.includes(t)).slice(0, 3).forEach((t) => {
    const c = document.createElement("span");
    c.className = "chip blocked";
    c.textContent = t;
    frag.appendChild(c);
  });
  return frag;
}

function addPhaseCard(phase) {
  const card = document.createElement("article");
  card.className = `phase-card ${phase.role}`;
  card.id = `card-${phase.id}`;
  card.innerHTML =
    `<div class="phase-head"><span class="phase-id">${phase.id}</span>` +
    `<span class="phase-name">${esc(phase.name)}</span>` +
    `<span class="badge ${phase.role}">${ROLE_LABEL[phase.role]}</span>` +
    `<span class="phase-meta" id="meta-${phase.id}">모델 호출 중</span></div>`;
  const gates = document.createElement("div");
  gates.className = "gate-row";
  gates.appendChild(gateChips(phase));
  card.appendChild(gates);
  const body = document.createElement("div");
  body.className = "phase-body";
  body.id = `body-${phase.id}`;
  body.innerHTML = `<span class="wait">진행 중 — ${ROLE_LABEL[phase.role]} 응답을 기다립니다…</span>`;
  card.appendChild(body);
  phasesEl.appendChild(card);
}

function setRail(id, state) {
  const li = document.getElementById(`rail-${id}`);
  if (li) li.className = state;
}

function stamp(card, verdict) {
  const s = document.createElement("div");
  s.className = "stamp";
  s.setAttribute("role", "img");
  s.setAttribute("aria-label", verdict === "PASS" ? "판정 도장: 적합" : "판정 도장: 보완 필요");
  s.innerHTML = verdict === "PASS"
    ? `적 합<small>HARNESS 검증필</small>`
    : `보완<br>필요<small>HARNESS 검증필</small>`;
  card.appendChild(s);
}

function showError(msg) {
  errBox.textContent = msg;
  errBox.style.display = "block";
}

async function run() {
  const task = input.value.trim();
  if (task.length < 4) { showError("작업 지시를 4자 이상 입력하세요."); return; }
  if (running) return;
  running = true;
  runBtn.disabled = true;
  runBtn.textContent = "절차 진행 중";
  errBox.style.display = "none";
  summaryEl.style.display = "none";
  phasesEl.textContent = "";
  buildRail();
  board.classList.add("active");
  board.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });

  try {
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task }),
    });
    if (!res.ok || !res.body) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `서버 오류 (HTTP ${res.status})`);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        handleBlock(buf.slice(0, idx));
        buf = buf.slice(idx + 2);
      }
    }
  } catch (e) {
    showError(e.message || "연결이 끊어졌습니다. 잠시 후 다시 시도하세요.");
  } finally {
    running = false;
    runBtn.disabled = false;
    runBtn.textContent = "파이프라인 가동";
  }
}

function handleBlock(block) {
  let ev = "message", data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) ev = line.slice(7).trim();
    else if (line.startsWith("data: ")) data += line.slice(6);
  }
  if (!data) return;
  let obj;
  try { obj = JSON.parse(data); } catch { return; }

  if (ev === "phase_start") {
    setRail(obj.id, "now");
    addPhaseCard(PHASES.find((p) => p.id === obj.id) || obj);
  } else if (ev === "phase_done") {
    setRail(obj.id, "done");
    const meta = document.getElementById(`meta-${obj.id}`);
    if (meta) meta.textContent = `${obj.model} · ${(obj.ms / 1000).toFixed(1)}s · ${obj.tokens} tok`;
    const body = document.getElementById(`body-${obj.id}`);
    if (body) renderContent(body, obj.content);
  } else if (ev === "run_done") {
    const fCard = document.getElementById("card-F");
    if (fCard) stamp(fCard, obj.verdict);
    summaryEl.textContent =
      `절차 종료 — 판정 ${obj.verdict === "PASS" ? "적합" : "보완 필요"} · 총 ${obj.totalTokens} 토큰 소모 · ` +
      `작업 AI와 비평 AI가 서로 다른 모델로 6단계를 수행했습니다`;
    summaryEl.style.display = "block";
  } else if (ev === "run_error") {
    showError(`파이프라인 중단: ${obj.error}`);
  }
}

runBtn.addEventListener("click", run);
input.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });

// ---------------------------------------------------------------- 정책 게이트 시뮬레이터
const simPhaseSeg = $("#sim-phases");
const simTools = $("#sim-tools");
const simVerdict = $("#sim-verdict");
let simPhase = PHASES[0];

function drawSim() {
  simPhaseSeg.textContent = "";
  for (const p of PHASES) {
    const b = document.createElement("button");
    b.textContent = `${p.id} ${p.name}`;
    b.setAttribute("aria-pressed", String(p.id === simPhase.id));
    b.addEventListener("click", () => {
      simPhase = p;
      simVerdict.innerHTML = `<span class="why">Phase ${p.id} 선택됨 — 도구를 눌러 게이트 판정을 확인하세요.</span>`;
      drawSim();
    });
    simPhaseSeg.appendChild(b);
  }
  simTools.textContent = "";
  for (const t of ALL_TOOLS) {
    const b = document.createElement("button");
    b.textContent = t;
    b.addEventListener("click", () => judge(t));
    simTools.appendChild(b);
  }
}

function judge(tool) {
  const p = simPhase;
  if (p.tools.length === 0) {
    simVerdict.innerHTML = `<span class="no">차단</span> — Phase ${p.id}(${esc(p.name)})는 비평 AI 전용 단계입니다. ` +
      `<span class="why">작업 AI의 모든 도구 호출이 거부되고, 독립 모델의 비평만 수신합니다.</span>`;
    return;
  }
  if (tool === "Bash" && p.tools.includes("Bash")) {
    simVerdict.innerHTML = `<span class="ok">조건부 허용</span> — Bash는 접두사 allowlist만 통과합니다. ` +
      `<span class="why">허용 접두사: ${BASH_ALLOWLIST}. 그 밖의 명령과 위험 패턴은 차단됩니다.</span>`;
    return;
  }
  if (p.tools.includes(tool)) {
    simVerdict.innerHTML = `<span class="ok">허용</span> — ${tool}은(는) Phase ${p.id} 허용 목록에 있습니다. ` +
      `<span class="why">게이트를 통과해 도구가 실행됩니다.</span>`;
  } else {
    simVerdict.innerHTML = `<span class="no">차단</span> — Phase ${p.id}에서 ${tool} 호출은 정책 게이트가 거부합니다. ` +
      `<span class="why">훅이 허용 도구 목록(${p.tools.join(", ")})을 AI에게 안내하고 턴을 되돌립니다.</span>`;
  }
}

buildRail();
drawSim();
simVerdict.innerHTML = `<span class="why">Phase를 고르고 도구를 눌러 보세요. 같은 도구라도 단계에 따라 판정이 달라집니다.</span>`;
