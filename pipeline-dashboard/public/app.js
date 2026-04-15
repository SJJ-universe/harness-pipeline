// ── State ──
let ws = null;
let startTime = null;
let timerInterval = null;
let findings = { critical: 0, high: 0, medium: 0, low: 0, note: 0 };
const TOOL_FEED_LIMIT = 50;
const CRITIQUE_TIMELINE_LIMIT = 20;
const toolFeed = [];
const critiqueTimeline = [];
let currentPipelineConfig = null;
let pipelineTemplates = {};

// ── Korean Mappings ──
const VERDICT_KO = { BLOCK: "차단", CONCERNS: "주의", CLEAN: "통과" };
// Dynamic — built from pipeline config
let PHASE_NAMES = {};
let NODE_NAMES = {};

// ── Icon type → CSS class mapping ──
const ICON_CLASSES = {
  claude: "claude-icon",
  codex: "codex-icon",
  orch: "orch-icon",
  sabo: "sabo-icon",
  sec: "sec-icon",
  read: "read-icon",
  synth: "synth-icon",
  debug: "debug-icon",
  emoji: "emoji-icon",
};

// ══════════════════════════════════
// Dynamic Pipeline Rendering
// ══════════════════════════════════

function renderPipeline(config) {
  currentPipelineConfig = config;
  const container = document.getElementById("pipeline-container");
  container.innerHTML = "";

  // Rebuild name maps
  PHASE_NAMES = {};
  NODE_NAMES = {};
  const nodePhaseMap = {};

  config.phases.forEach((phase, idx) => {
    PHASE_NAMES[phase.id] = `${phase.label} — ${phase.name}`;
    phase.nodes.forEach((n) => {
      NODE_NAMES[n.id] = `${n.label} — ${n.sublabel}`;
      nodePhaseMap[n.id] = phase.id;
    });

    // Add vertical connector between phases (except before first)
    if (idx > 0) {
      // Cycle arrow between cycle phases
      if (phase.linkedCycle) {
        const cycleHtml = `
          <div class="cycle-container">
            <div class="connector vertical"><div class="connector-line-v"></div></div>
            <div class="cycle-arrow" id="cycle-arrow">
              <svg width="40" height="40" viewBox="0 0 40 40">
                <path d="M 30 20 A 10 10 0 1 1 20 10" fill="none" stroke="currentColor" stroke-width="2"/>
                <polygon points="18,6 22,10 18,14" fill="currentColor"/>
              </svg>
              <span id="cycle-count"></span>
            </div>
          </div>`;
        container.insertAdjacentHTML("beforeend", cycleHtml);
      } else {
        container.insertAdjacentHTML("beforeend",
          '<div class="connector vertical"><div class="connector-line-v"></div></div>');
      }
    }

    // Determine if this phase has grouped nodes (like reviewers)
    const grouped = phase.nodes.filter((n) => n.group);
    const ungrouped = phase.nodes.filter((n) => !n.group);
    const hasReviewerGroup = grouped.length > 0;

    const phaseEl = document.createElement("div");
    phaseEl.className = "phase" + (hasReviewerGroup ? " phase-large" : "");
    phaseEl.id = `phase-${phase.id}`;

    let innerHtml = `<div class="phase-label">${phase.label} <span>${phase.name}</span></div>`;

    if (phase.layout === "row" && ungrouped.length >= 2) {
      // Side-by-side layout with bidirectional connector
      innerHtml += `<div class="phase-content phase-row">`;
      innerHtml += renderNode(ungrouped[0]);
      innerHtml += `<div class="connector horizontal"><div class="connector-line"></div><div class="connector-arrows">&#x21C4;</div><div class="connector-line"></div></div>`;
      innerHtml += renderNode(ungrouped[1]);
      innerHtml += `</div>`;
    } else if (hasReviewerGroup) {
      // Complex layout: nodes in order, grouped nodes become fan-out row
      innerHtml += `<div class="phase-content"><div class="review-flow">`;

      let inGroup = false;
      for (let i = 0; i < phase.nodes.length; i++) {
        const node = phase.nodes[i];
        const prevNode = phase.nodes[i - 1];
        const nextNode = phase.nodes[i + 1];

        if (node.group && !inGroup) {
          // Start of group — add connector + fan-out header
          innerHtml += `<div class="connector vertical small"><div class="connector-line-v"></div></div>`;
          const fanLines = grouped.map((_, gi) => {
            const positions = ["left", "center", "right"];
            return `<div class="fan-line ${positions[gi] || "center"}"></div>`;
          }).join("");
          innerHtml += `<div class="fan-out"><div class="fan-lines">${fanLines}</div><div class="reviewer-row">`;
          inGroup = true;
        }

        if (node.group) {
          innerHtml += renderNode(node, true);
          // Check if next node exits the group
          if (!nextNode || !nextNode.group) {
            innerHtml += `</div></div>`; // close reviewer-row + fan-out
            inGroup = false;
          }
        } else {
          innerHtml += renderNode(node);
        }

        // Add connector to next non-group node (or before group starts)
        if (nextNode && !inGroup) {
          innerHtml += `<div class="connector vertical small"><div class="connector-line-v"></div></div>`;
        }
      }

      innerHtml += `</div></div>`;
    } else {
      // Simple vertical layout
      innerHtml += `<div class="phase-content">`;
      ungrouped.forEach((node, i) => {
        innerHtml += renderNode(node);
        if (i < ungrouped.length - 1) {
          innerHtml += `<div class="connector vertical small"><div class="connector-line-v"></div></div>`;
        }
      });
      innerHtml += `</div>`;
    }

    phaseEl.innerHTML = innerHtml;
    container.appendChild(phaseEl);
  });

  // Update nodeToPhase mapping
  _nodePhaseMap = nodePhaseMap;

  // Re-bind click handlers
  bindPipelineClicks();
}

let _nodePhaseMap = {};

function renderNode(node, isReviewer) {
  const iconClass = ICON_CLASSES[node.iconType] || "emoji-icon";
  const reviewerClass = isReviewer ? " reviewer" : "";
  const badgeHtml = isReviewer ? `<div class="findings-badge" id="badge-${node.id}"></div>` : "";
  return `
    <div class="node${reviewerClass}" id="node-${node.id}" data-node="${node.id}">
      <div class="node-icon ${iconClass}">${node.icon}</div>
      <div class="node-label">${node.label}<br/><small>${node.sublabel}</small></div>
      ${badgeHtml}
    </div>`;
}

function bindPipelineClicks() {
  document.querySelectorAll(".phase").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".node")) return;
      const phaseId = el.id.replace("phase-", "");
      const title = PHASE_NAMES[phaseId] || `Phase ${phaseId}`;
      openModal(title, stageLogKey("phase", phaseId));
    });
  });
  document.querySelectorAll(".node").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const nodeId = el.getAttribute("data-node");
      const title = NODE_NAMES[nodeId] || nodeId;
      openModal(title, stageLogKey("node", nodeId));
    });
  });
}

async function loadPipelineTemplate(templateId) {
  try {
    if (!pipelineTemplates[templateId]) {
      const resp = await fetch(`/api/pipeline/templates/${templateId}`);
      pipelineTemplates[templateId] = await resp.json();
    }
    renderPipeline(pipelineTemplates[templateId]);
  } catch (err) {
    console.error("Failed to load template:", err);
  }
}

async function loadAllTemplates() {
  try {
    const resp = await fetch("/api/pipeline/templates");
    pipelineTemplates = await resp.json();
    // Render default (code-review)
    if (pipelineTemplates["code-review"]) {
      renderPipeline(pipelineTemplates["code-review"]);
    }
  } catch (err) {
    console.error("Failed to load templates:", err);
  }
}

// ── Per-stage Log Storage ──
let stageLogs = {}; // key: "phase-A", "node-saboteur", etc.

function stageLogKey(type, id) { return `${type}-${id}`; }

function addStageLog(key, html) {
  if (!stageLogs[key]) stageLogs[key] = [];
  stageLogs[key].push(html);
}

// Determine which stage keys a log entry belongs to
function getStageKeysForEvent(event) {
  const keys = [];
  if (event.type === "phase_update") keys.push(stageLogKey("phase", event.data.phase));
  if (event.type === "node_update") {
    keys.push(stageLogKey("node", event.data.node));
    // Also add to parent phase
    const nodePhase = nodeToPhase(event.data.node);
    if (nodePhase) keys.push(stageLogKey("phase", nodePhase));
  }
  if (event.type === "findings") {
    const persona = event.data.persona;
    keys.push(stageLogKey("node", persona === "codex" ? "codex-review" : persona));
    const nodePhase = nodeToPhase(persona === "codex" ? "codex-review" : persona);
    if (nodePhase) keys.push(stageLogKey("phase", nodePhase));
  }
  if (event.type === "error" && event.data.node) {
    keys.push(stageLogKey("node", event.data.node));
    if (event.data.phase) keys.push(stageLogKey("phase", event.data.phase));
  }
  if (event.type === "verdict") keys.push(stageLogKey("phase", "C"));
  return keys;
}

function nodeToPhase(node) {
  return _nodePhaseMap[node] || null;
}

// ── WebSocket ──
function connectWS() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${location.host}`);
  ws.onmessage = (e) => handleEvent(JSON.parse(e.data));
  ws.onclose = () => setTimeout(connectWS, 2000);
}

// ── Event Handler ──
function handleEvent(event) {
  // Track which stage keys this event belongs to (for modal popup)
  const _stageKeys = getStageKeysForEvent(event);

  switch (event.type) {
    case "pipeline_reset":
      resetUI();
      addLog("phase", "파이프라인 리셋됨");
      break;

    case "pipeline_start":
      resetUI();
      startTimer();
      setBadge("running", event.data.mode === "live" ? "라이브" : "실행중");
      addLog("phase", `파이프라인 시작 — ${event.data.mode} 모드 — ${event.data.targetFile}`, false, _stageKeys);
      break;

    case "phase_update":
      updatePhase(event.data.phase, event.data.status);
      addLog("phase", `Phase ${event.data.phase}: ${event.data.status}`, false, _stageKeys);
      break;

    case "node_update":
      updateNode(event.data.node, event.data.status);
      if (event.data.findings != null) {
        showFindingsBadge(event.data.node, event.data.findings);
      }
      if (event.data.totalFindings) {
        updateFindingCounts(event.data.totalFindings);
      }
      addLog("node", `${event.data.node}: ${event.data.status}${event.data.findings != null ? ` (${event.data.findings} 발견)` : ""}`, false, _stageKeys);
      break;

    case "token_update":
      updateTokens(event.data.claude, event.data.codex);
      break;

    case "findings":
      processFindingsEvent(event.data, _stageKeys);
      break;

    case "error":
      handleError(event.data, _stageKeys);
      break;

    case "verdict":
      showVerdict(event.data, _stageKeys);
      break;

    case "pipeline_complete":
      stopTimer();
      setBadge("done", "완료");
      addLog("phase", "파이프라인 완료");
      if (event.data.errors && event.data.errors.length > 0) {
        addLog("error", `${event.data.errors.length}개 오류 발생`);
      }
      // Trigger harness recommendations
      if (event.data.harnessId) {
        showRecommendations(event.data.harnessId);
      } else {
        showRecommendations("code-review");
      }
      break;

    case "harness_complete":
      stopTimer();
      setBadge("done", "완료");
      addLog("phase", `하네스 완료: ${event.data.harnessId || "unknown"}`);
      showRecommendations(event.data.harnessId);
      break;

    case "auto_pipeline_detect":
      // Auto-detected task — load appropriate pipeline template
      handleAutoPipeline(event.data);
      break;

    // ── Harness events (Phase 1-4) ──
    case "harness_mode":
      updateHarnessMode(event.data.enabled);
      break;

    case "tool_blocked": {
      const entry = {
        ts: Date.now(),
        phase: event.data.phase || "?",
        tool: event.data.tool || "?",
        blocked: true,
        allowed: event.data.allowed || [],
        reason: event.data.reason || "",
      };
      pushToolFeed(entry);
      addLog("error", `[${entry.phase}] ${entry.tool} 차단됨 — 허용: ${entry.allowed.join(", ")}`, true, _stageKeys);
      break;
    }

    case "tool_recorded": {
      pushToolFeed({
        ts: event.data.timestamp || Date.now(),
        phase: event.data.phase || "?",
        tool: event.data.tool || "?",
        input: summarizeToolInput(event.data.tool, event.data.input),
        blocked: false,
      });
      break;
    }

    case "artifact_captured":
      flashPhase(event.data.phase, "artifact");
      addLog("phase", `[${event.data.phase}] 산출물 캡처: ${event.data.key} = ${event.data.path || "(present)"}`, false, _stageKeys);
      break;

    case "gate_evaluated":
      // Silent unless failure — gate_failed handles the noisy case
      break;

    case "gate_failed": {
      const reasons = (event.data.missing || []).join("; ");
      flashPhase(event.data.phase, "error");
      addLog("error",
        `[${event.data.phase}] 품질 게이트 실패 (시도 ${event.data.retries}/3) — ${reasons}`,
        true, _stageKeys);
      break;
    }

    case "gate_bypassed":
      addLog("error",
        `[${event.data.phase}] 게이트 우회됨 (재시도 ${event.data.retries}회 초과) — ${(event.data.missing || []).join("; ")}`,
        true, _stageKeys);
      break;

    case "codex_started":
      addLog("phase", `[${event.data.phase}] Codex 시작 — ${event.data.promptPreview || ""}`, false, _stageKeys);
      break;

    case "critique_received": {
      const f = event.data.findings || [];
      const counts = { critical: 0, high: 0, medium: 0, low: 0, note: 0 };
      for (const item of f) {
        const sev = item.severity || "note";
        if (counts[sev] !== undefined) counts[sev]++;
      }
      findings.critical += counts.critical;
      findings.high     += counts.high;
      findings.medium   += counts.medium;
      findings.low      += counts.low;
      findings.note     += counts.note;
      renderFindingCounts();

      pushCritique({
        ts: Date.now(),
        phase: event.data.phase || "?",
        iteration: event.data.iteration != null ? event.data.iteration : null,
        summary: event.data.summary || "",
        counts,
        topFindings: f.slice(0, 3).map((x) => ({
          severity: x.severity || "note",
          note: x.note || x.message || x.description || "",
        })),
      });

      addLog("verdict",
        `[${event.data.phase}] Codex 비평 — ${event.data.summary || ""} ` +
        `(C:${counts.critical} H:${counts.high} M:${counts.medium} L:${counts.low} N:${counts.note})`,
        false, _stageKeys);
      break;
    }

    case "cycle_iteration":
      updateCycleCounter(event.data.iteration);
      addLog("phase", `사이클 반복 ${event.data.iteration} — ${event.data.phase} → ${event.data.linkedTo}`, false, _stageKeys);
      break;

    case "pipeline_mutated":
      handlePipelineMutated(event.data);
      break;

    // ── Server control / Codex verify ──
    case "server_shutdown":
      setServerIndicator("down", `서버: 종료됨 (${event.data && event.data.reason || "—"})`);
      addLog("error", `서버 종료: ${event.data && event.data.reason || "unknown"}`, true);
      break;

    case "server_restart":
      setServerIndicator("checking", "서버: 재시작 중…");
      addLog("phase", "서버 재시작 요청됨 — 곧 재연결합니다");
      break;

    case "codex_verify_started":
      setCodexIndicator("checking", "Codex: 확인중…");
      addLog("phase", "Codex CLI 검증 호출 시작 (실제 subprocess)");
      break;

    case "codex_verify_result": {
      const d = event.data || {};
      if (d.ok && d.detectedMarker) {
        setCodexIndicator("ok", `Codex: OK (${d.durationMs}ms)`);
        addLog("phase", `Codex 검증 성공 — exit=${d.exitCode} duration=${d.durationMs}ms marker=OK`);
      } else {
        setCodexIndicator("fail", "Codex: 실패");
        addLog("error",
          `Codex 검증 실패 — ok=${d.ok} exit=${d.exitCode} ` +
          `marker=${d.detectedMarker} error=${d.error || "—"}`, true);
      }
      break;
    }

    case "log_message": {
      const level = (event.data && event.data.level) || "info";
      const msg = (event.data && event.data.message) || "";
      addLog(level === "error" ? "error" : "phase", msg, level === "error");
      break;
    }

    case "general_plan_complete": {
      const triggerBtn = document.getElementById("btn-start-general");
      const abortBtn = document.getElementById("btn-abort-general");
      if (triggerBtn) triggerBtn.disabled = false;
      if (abortBtn) abortBtn.style.display = "none";
      showFinalPlan(event.data || {});
      break;
    }
  }
}

// ── Harness Helpers (Phase 1-4 events) ──

function handlePipelineMutated(data) {
  const { template, mutationType, ruleId, nextIdx } = data;
  if (!template) return;

  // Re-render with the mutated phase list. This blows away phase status
  // classes, so phase_update events that follow will repaint them.
  renderPipeline(template);

  // Highlight the freshly inserted/swapped phase, if we know its idx
  if (typeof nextIdx === "number" && template.phases && template.phases[nextIdx]) {
    const phaseId = template.phases[nextIdx].id;
    flashPhase(phaseId, "mutated");
  }

  addLog("phase",
    `파이프라인 변형 — ${mutationType} (rule: ${ruleId})`,
    false, []);
}

function flashPhase(phaseId, kind) {
  const el = document.getElementById(`phase-${phaseId}`);
  if (!el) return;
  const cls = `flash-${kind}`;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 1500);
}

function updateCycleCounter(iteration) {
  const el = document.getElementById("cycle-count");
  if (el) el.textContent = `×${iteration}`;
}

function updateHarnessMode(enabled) {
  let el = document.getElementById("harness-mode-indicator");
  if (!el) {
    const right = document.querySelector(".header-right");
    if (!right) return;
    el = document.createElement("span");
    el.id = "harness-mode-indicator";
    el.className = "harness-mode-indicator";
    el.title = "하네스 모드 (클릭하여 토글)";
    el.addEventListener("click", toggleHarnessMode);
    right.appendChild(el);
  }
  el.textContent = enabled ? "🔒 Harness ON" : "Harness OFF";
  el.classList.toggle("on", !!enabled);
}

function toggleHarnessMode() {
  fetch("/api/executor/mode")
    .then((r) => r.json())
    .then((s) => fetch("/api/executor/mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !s.enabled }),
    }))
    .then((r) => r.json())
    .then((s) => updateHarnessMode(s.enabled))
    .catch((err) => console.error("toggle failed:", err));
}

function fetchHarnessMode() {
  fetch("/api/executor/mode")
    .then((r) => r.json())
    .then((s) => updateHarnessMode(s.enabled))
    .catch(() => {});
}

function handleAutoPipeline(data) {
  const { templateId, taskType, reason } = data;

  // Reset UI for new pipeline
  resetUI();
  startTimer();
  setBadge("running", reason);

  // Update pipeline selector
  const select = document.getElementById("pipeline-select");
  if (select) select.value = templateId;

  // Load and render the template
  loadPipelineTemplate(templateId);

  addLog("phase", `자동 감지: ${reason} → ${templateId} 파이프라인 로드`);
}

// ── UI Updates ──

function updatePhase(phase, status) {
  const el = document.getElementById(`phase-${phase}`);
  if (!el) return;
  el.classList.remove("active", "completed", "error");
  if (status !== "idle") el.classList.add(status);
}

function updateNode(node, status) {
  const el = document.getElementById(`node-${node}`);
  if (!el) return;
  el.classList.remove("active", "completed", "error");
  if (status !== "idle") el.classList.add(status);
}

function showFindingsBadge(node, count) {
  const badgeMap = {
    saboteur: "badge-saboteur",
    security: "badge-security",
    readability: "badge-readability",
    "codex-review": "badge-codex",
  };
  const id = badgeMap[node];
  if (!id) return;
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = count;
  el.classList.add("visible");
}

function updateTokens(claude, codex) {
  // Legacy support for pipeline events — no longer primary display
}

// ── Tool Feed + Critique Timeline ──
function pushToolFeed(entry) {
  toolFeed.unshift(entry);
  if (toolFeed.length > TOOL_FEED_LIMIT) toolFeed.length = TOOL_FEED_LIMIT;
  renderToolFeed();
}

function renderToolFeed() {
  const el = document.getElementById("tool-feed");
  const counter = document.getElementById("tool-feed-counter");
  if (!el) return;
  if (counter) counter.textContent = toolFeed.length;
  if (toolFeed.length === 0) {
    el.innerHTML = '<div class="tool-empty">아직 기록된 툴 호출이 없습니다.</div>';
    return;
  }
  el.innerHTML = toolFeed.map((e) => {
    const time = formatHMS(e.ts);
    const cls = e.blocked ? "tool-entry blocked" : "tool-entry";
    const body = e.blocked
      ? `<span class="tool-tool">${escapeHtml(e.tool)}</span><span class="tool-blocked">BLOCK</span><span class="tool-reason">${escapeHtml(e.reason || (e.allowed || []).join(","))}</span>`
      : `<span class="tool-tool">${escapeHtml(e.tool)}</span><span></span><span class="tool-input">${escapeHtml(e.input || "")}</span>`;
    return `<div class="${cls}"><span class="tool-time">${time}</span><span class="tool-phase">[${escapeHtml(e.phase)}]</span>${body}</div>`;
  }).join("");
}

function pushCritique(entry) {
  critiqueTimeline.unshift(entry);
  if (critiqueTimeline.length > CRITIQUE_TIMELINE_LIMIT) critiqueTimeline.length = CRITIQUE_TIMELINE_LIMIT;
  renderCritiqueTimeline();
}

function renderCritiqueTimeline() {
  const el = document.getElementById("critique-timeline");
  const counter = document.getElementById("critique-counter");
  if (!el) return;
  if (counter) counter.textContent = critiqueTimeline.length;
  if (critiqueTimeline.length === 0) {
    el.innerHTML = '<div class="tool-empty">아직 수신된 비평이 없습니다.</div>';
    return;
  }
  el.innerHTML = critiqueTimeline.map((e) => {
    const time = formatHMS(e.ts);
    const iter = e.iteration != null ? ` iter ${e.iteration}` : "";
    const chips = ["critical", "high", "medium", "low", "note"]
      .filter((k) => e.counts[k] > 0)
      .map((k) => `<span class="sev-chip sev-${k}">${k.charAt(0).toUpperCase()}:${e.counts[k]}</span>`)
      .join("");
    const top = (e.topFindings || []).map((f) =>
      `<div class="critique-finding"><span class="sev-dot sev-${f.severity}"></span>${escapeHtml(f.note)}</div>`
    ).join("");
    return `
      <div class="critique-entry">
        <div class="critique-head">
          <span class="critique-time">${time}</span>
          <span class="critique-phase">[${escapeHtml(e.phase)}${iter}]</span>
          <span class="critique-chips">${chips}</span>
        </div>
        ${e.summary ? `<div class="critique-summary">${escapeHtml(e.summary)}</div>` : ""}
        ${top}
      </div>`;
  }).join("");
}

function renderFindingCounts() {
  for (const k of ["critical", "high", "medium", "low", "note"]) {
    const el = document.getElementById(`count-${k}`);
    if (el) el.textContent = findings[k];
  }
}

function summarizeToolInput(tool, input) {
  if (!input || typeof input !== "object") return "";
  if (tool === "Read" || tool === "Edit" || tool === "Write" || tool === "NotebookEdit") {
    return shortPath(input.filePath || input.file_path || input.notebook_path || "");
  }
  if (tool === "Grep" || tool === "Glob") return input.pattern || "";
  if (tool === "Bash") return String(input.command || "").slice(0, 60);
  if (tool === "Task") return (input.description || input.subagent_type || "").slice(0, 40);
  if (tool === "WebFetch") return input.url || "";
  return "";
}

function shortPath(p) {
  if (!p) return "";
  const parts = String(p).replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.slice(-2).join("/");
}

function formatHMS(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function clearToolFeed() {
  toolFeed.length = 0;
  renderToolFeed();
}

function clearCritiqueTimeline() {
  critiqueTimeline.length = 0;
  renderCritiqueTimeline();
}

function updateFindingCounts(counts) {
  // Legacy event path — map 3-tier → 5-tier best-effort
  if (counts.critical != null) findings.critical = counts.critical;
  if (counts.warning  != null) findings.medium   = counts.warning;
  if (counts.note     != null) findings.note     = counts.note;
  renderFindingCounts();
}

function processFindingsEvent(data, stageKeys) {
  const { persona, findings: items } = data;
  const local = { critical: 0, high: 0, medium: 0, low: 0, note: 0 };
  for (const f of items) {
    const sev = (f.severity || "note").toLowerCase();
    const key = local[sev] !== undefined ? sev : "note";
    local[key]++;
    addLog("finding", `[${sev.toUpperCase()}] ${persona} — ${f.file}:${f.line} — ${f.message}`, false, stageKeys);
  }
  findings.critical += local.critical;
  findings.high     += local.high;
  findings.medium   += local.medium;
  findings.low      += local.low;
  findings.note     += local.note;
  renderFindingCounts();
}

function handleError(data, stageKeys) {
  addLog("error", `[Phase ${data.phase}] ${data.node}: ${data.message}`, true, stageKeys);
  if (data.node) {
    updateNode(data.node, "error");
  }
}

function showVerdict(data, stageKeys) {
  const el = document.getElementById("verdict-value");
  const koVerdict = VERDICT_KO[data.verdict] || data.verdict;
  el.textContent = koVerdict;
  el.className = "verdict-value " + data.verdict;
  addLog("verdict", `판정: ${koVerdict} (${data.verdict}) — 심각:${data.stats.critical} 경고:${data.stats.warning} 참고:${data.stats.note} (+Codex:${data.stats.codexAdditional})`, false, stageKeys);
}

function setBadge(cls, text) {
  const el = document.getElementById("status-badge");
  el.className = "badge " + cls;
  el.textContent = text;
}

// ── Timer (internal tracking only) ──
function startTimer() {
  startTime = Date.now();
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
}

// ── Log (Chat Style) ──
const LOG_AVATARS = {
  phase: { icon: "P", label: "Pipeline" },
  node: { icon: "A", label: "Agent" },
  finding: { icon: "!", label: "Finding" },
  error: { icon: "✕", label: "Error" },
  verdict: { icon: "✓", label: "Verdict" },
  token: { icon: "T", label: "Token" },
};

function addLog(tag, message, isError = false, stageKeys = []) {
  const container = document.getElementById("log-content");
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  const avatar = LOG_AVATARS[tag] || LOG_AVATARS.phase;

  const bubbleClass = tag === "finding" ? " finding-bubble"
    : tag === "error" ? " error-bubble"
    : tag === "verdict" ? " verdict-bubble"
    : "";

  const html = `
    <div class="log-avatar ${tag}">${avatar.icon}</div>
    <div class="log-bubble${bubbleClass}">
      <div class="log-bubble-header">
        <span class="log-sender">${avatar.label}</span>
        <span class="log-time">${time}</span>
      </div>
      <div class="log-msg${isError ? " error-msg" : ""}">${escapeHtml(message)}</div>
    </div>
  `;

  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.innerHTML = html;
  container.appendChild(entry);
  container.scrollTop = container.scrollHeight;

  // Store for per-stage popup (flat html for modal)
  const flatHtml = `
    <span class="log-time">${time}</span>
    <span class="log-msg${isError ? " error-msg" : ""}">${escapeHtml(message)}</span>
  `;
  for (const key of stageKeys) {
    addStageLog(key, flatHtml);
  }
}

function clearLog() {
  document.getElementById("log-content").innerHTML = "";
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// ── Reset ──
function resetUI() {
  // Clear phases
  document.querySelectorAll(".phase").forEach((el) => {
    el.classList.remove("active", "completed", "error");
  });
  // Clear nodes
  document.querySelectorAll(".node").forEach((el) => {
    el.classList.remove("active", "completed", "error");
  });
  // Clear badges
  document.querySelectorAll(".findings-badge").forEach((el) => {
    el.classList.remove("visible");
    el.textContent = "";
  });
  // Reset findings
  findings = { critical: 0, high: 0, medium: 0, low: 0, note: 0 };
  renderFindingCounts();
  // Reset feed buffers
  toolFeed.length = 0;
  critiqueTimeline.length = 0;
  renderToolFeed();
  renderCritiqueTimeline();
  // Reset verdict
  const v = document.getElementById("verdict-value");
  v.textContent = "—";
  v.className = "verdict-value";
  // Reset timer
  stopTimer();
  // Reset badge
  setBadge("", "대기");
  // Reset stage logs
  stageLogs = {};
}


// ── Modal / Stage Popup ──
function openModal(title, key) {
  const overlay = document.getElementById("modal-overlay");
  const titleEl = document.getElementById("modal-title");
  const body = document.getElementById("modal-body");

  titleEl.textContent = title;
  const logs = stageLogs[key] || [];

  if (logs.length === 0) {
    body.innerHTML = '<div class="modal-empty">이 단계의 로그가 아직 없습니다.</div>';
  } else {
    body.innerHTML = logs.map((html) => `<div class="log-entry">${html}</div>`).join("");
  }

  overlay.classList.add("visible");
}

function closeModal(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById("modal-overlay").classList.remove("visible");
}

// Close on Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.getElementById("modal-overlay").classList.remove("visible");
    ["general-run-overlay", "final-plan-overlay"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.remove("visible");
    });
  }
});

// Click handlers are now bound dynamically by bindPipelineClicks()

// ── Terminal (xterm.js + node-pty) ──
let term = null;
let termWs = null;

function initTerminal() {
  if (typeof Terminal === "undefined") {
    document.getElementById("terminal-container").innerHTML =
      '<div class="modal-empty">xterm.js를 로드할 수 없습니다. 인터넷 연결을 확인하세요.</div>';
    return;
  }

  term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: "'Cascadia Code', 'Fira Code', monospace",
    theme: {
      background: "#0d1117",
      foreground: "#e6edf3",
      cursor: "#d4a574",
      selectionBackground: "#264f78",
    },
  });

  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById("terminal-container"));
  fitAddon.fit();

  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown") return true;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && !e.shiftKey && !e.altKey && (e.key === "c" || e.key === "C")) {
      const sel = term.getSelection();
      if (sel && sel.length > 0) {
        navigator.clipboard.writeText(sel).catch(() => {});
        term.clearSelection();
        return false;
      }
      return true;
    }
    if (ctrl && e.shiftKey && (e.key === "C" || e.key === "c")) {
      const sel = term.getSelection();
      if (sel && sel.length > 0) {
        navigator.clipboard.writeText(sel).catch(() => {});
        term.clearSelection();
      }
      return false;
    }
    if (ctrl && (e.key === "v" || e.key === "V")) {
      return false;
    }
    return true;
  });

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  termWs = new WebSocket(`${protocol}//${location.host}/terminal`);

  let promptReady = false;

  termWs.onopen = () => {
    termWs.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
  };

  termWs.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "output") {
      term.write(msg.data);
      // Auto-launch claude after first shell prompt appears
      if (!promptReady && msg.data.includes("$")) {
        promptReady = true;
        setTimeout(() => {
          if (termWs.readyState === 1) {
            termWs.send(JSON.stringify({ type: "input", data: "claude --continue\n" }));
          }
        }, 300);
      }
    }
  };

  termWs.onclose = () => {
    term.write("\r\n\x1b[31m[연결 종료]\x1b[0m\r\n");
  };

  term.onData((data) => {
    if (termWs && termWs.readyState === 1) {
      termWs.send(JSON.stringify({ type: "input", data }));
    }
  });

  const resizeObserver = new ResizeObserver(() => {
    fitAddon.fit();
    if (termWs && termWs.readyState === 1) {
      termWs.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    }
  });
  resizeObserver.observe(document.getElementById("terminal-container"));
}

function switchTab(tab) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach((c) => c.classList.add("hidden"));
  document.getElementById(`tab-${tab}`).classList.remove("hidden");
  document.getElementById(`tab-btn-${tab}`).classList.add("active");
  if (tab === "terminal" && !term) initTerminal();
}

// ── Harness Recommendations ──
function showRecommendations(completedHarnessId) {
  fetch("/api/harness/recommend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ completedHarnessId }),
  })
    .then((r) => r.json())
    .then((recs) => {
      const container = document.getElementById("recommend-cards");
      const panel = document.getElementById("harness-recommend");
      if (!recs.length) { panel.style.display = "none"; return; }

      container.innerHTML = recs.map((r) => `
        <div class="recommend-card" onclick="selectHarness('${r.id}')">
          <div class="recommend-card-icon">${r.icon}</div>
          <div class="recommend-card-body">
            <div class="recommend-card-name">${r.name}</div>
            <div class="recommend-card-reason">${r.reason}</div>
            <div class="recommend-card-meta">${r.skillCount} skills</div>
          </div>
        </div>
      `).join("");
      panel.style.display = "block";
    })
    .catch(() => {});
}

function selectHarness(harnessId) {
  document.getElementById("harness-recommend").style.display = "none";
  addLog("phase", `하네스 선택: ${harnessId}`);
  // Future: load pipeline template and start harness
}

function dismissRecommendations() {
  document.getElementById("harness-recommend").style.display = "none";
}

// ══════════════════════════════════
// Server control + Codex verify + General plan critique
// ══════════════════════════════════

function setServerIndicator(state, text) {
  const el = document.getElementById("server-indicator");
  const label = document.getElementById("server-label");
  if (!el || !label) return;
  el.classList.remove("ok", "down", "checking");
  if (state) el.classList.add(state);
  if (text) label.textContent = text;
}

function setCodexIndicator(state, text) {
  const el = document.getElementById("codex-indicator");
  const label = document.getElementById("codex-label");
  if (!el || !label) return;
  el.classList.remove("ok", "fail", "checking");
  if (state) el.classList.add(state);
  if (text) label.textContent = text;
}

async function fetchServerInfo() {
  try {
    const r = await fetch("/api/server/info");
    if (!r.ok) throw new Error(String(r.status));
    const info = await r.json();
    setServerIndicator("ok", `서버: 연결 (pid ${info.pid}${info.supervised ? " · 감독" : ""})`);
    // Disable restart button if not supervised
    const restartBtn = document.getElementById("btn-server-restart");
    if (restartBtn && !info.supervised) {
      restartBtn.disabled = true;
      restartBtn.title = "start.js를 통해 실행되지 않아 재시작 불가";
    }
  } catch (err) {
    setServerIndicator("down", "서버: 연결 끊김");
  }
}

async function stopServer() {
  if (!confirm("서버를 정말 종료합니까? 진행 중인 파이프라인과 터미널 세션이 모두 종료됩니다.")) return;
  setServerIndicator("checking", "서버: 종료 요청…");
  try {
    await fetch("/api/server/shutdown", { method: "POST" });
  } catch (_) { /* connection likely dropped — that's OK */ }
}

async function restartServer() {
  if (!confirm("서버를 재시작합니까?")) return;
  setServerIndicator("checking", "서버: 재시작 요청…");
  try {
    const r = await fetch("/api/server/restart", { method: "POST" });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert("재시작 실패: " + (err.error || r.status));
      fetchServerInfo();
    }
  } catch (_) { /* connection will drop when server exits */ }
}

async function verifyCodex() {
  const btn = document.getElementById("btn-codex-verify");
  if (btn) btn.disabled = true;
  setCodexIndicator("checking", "Codex: 검증 중…");
  try {
    const r = await fetch("/api/codex/verify", { method: "POST" });
    const d = await r.json();
    // The broadcast event will also update the indicator; this is a fallback
    if (d.ok && d.detectedMarker) {
      setCodexIndicator("ok", `Codex: OK (${d.durationMs}ms)`);
    } else {
      setCodexIndicator("fail", "Codex: 실패");
      const msg = [
        `exitCode: ${d.exitCode}`,
        `detectedMarker: ${d.detectedMarker}`,
        d.error ? `error: ${d.error}` : "",
        d.stderrSnippet ? `stderr: ${d.stderrSnippet.slice(0, 200)}` : "",
      ].filter(Boolean).join("\n");
      alert("Codex 검증 실패\n\n" + msg);
    }
  } catch (err) {
    setCodexIndicator("fail", "Codex: 오류");
    alert("Codex 검증 요청 실패: " + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Automated General Pipeline (Claude plan ↔ Codex critique) ──

function openGeneralRun() {
  // Auto-switch visual template to "default" so the user sees the phases
  // that will actually run.
  const sel = document.getElementById("pipeline-select");
  if (sel && sel.value !== "default") {
    sel.value = "default";
    loadPipelineTemplate("default");
  }
  document.getElementById("general-run-overlay").classList.add("visible");
  setTimeout(() => {
    const ti = document.getElementById("gr-task-input");
    if (ti) ti.focus();
  }, 50);
}

function closeGeneralRun(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById("general-run-overlay").classList.remove("visible");
}

async function submitGeneralRun() {
  const task = document.getElementById("gr-task-input").value.trim();
  const maxIter = parseInt(document.getElementById("gr-max-iter").value, 10) || 3;
  if (task.length < 3) {
    alert("작업 설명을 3자 이상 입력하세요");
    return;
  }
  const startBtn = document.getElementById("btn-gr-start");
  const triggerBtn = document.getElementById("btn-start-general");
  const abortBtn = document.getElementById("btn-abort-general");
  if (startBtn) startBtn.disabled = true;
  if (triggerBtn) triggerBtn.disabled = true;
  try {
    const r = await fetch("/api/pipeline/general-run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task, maxIterations: maxIter }),
    });
    const d = await r.json();
    if (!r.ok) {
      alert("시작 실패: " + (d.error || r.status));
      if (triggerBtn) triggerBtn.disabled = false;
      return;
    }
    closeGeneralRun();
    if (abortBtn) abortBtn.style.display = "";
    addLog("phase", `범용 파이프라인 시작 — ${task.slice(0, 60)} (max ${maxIter} iter)`);
  } catch (err) {
    alert("요청 실패: " + err.message);
    if (triggerBtn) triggerBtn.disabled = false;
  } finally {
    if (startBtn) startBtn.disabled = false;
  }
}

async function abortGeneralRun() {
  if (!confirm("진행 중인 파이프라인을 중단합니까?")) return;
  try {
    await fetch("/api/pipeline/general-abort", { method: "POST" });
  } catch (_) {}
}

function closeFinalPlan(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById("final-plan-overlay").classList.remove("visible");
}

function showFinalPlan(data) {
  const overlay = document.getElementById("final-plan-overlay");
  const meta = document.getElementById("final-plan-meta");
  const text = document.getElementById("final-plan-text");
  const title = document.getElementById("final-plan-title");
  if (!overlay || !meta || !text) return;

  const verdict = data.verdict || "—";
  const verdictClass =
    verdict === "CLEAN" ? "ok" :
    verdict === "CONCERNS" ? "warn" :
    verdict === "ERROR" || verdict === "ABORTED" ? "fail" : "";
  const findings = (data.lastCritique && data.lastCritique.findings) || [];
  const counts = { critical: 0, high: 0, medium: 0, low: 0, note: 0 };
  findings.forEach((f) => {
    const sev = f.severity || "note";
    if (counts[sev] !== undefined) counts[sev]++;
  });

  title.textContent = "최종 플랜 — 범용 파이프라인";
  meta.innerHTML =
    `판정: <span class="${verdictClass}">${verdict}</span>` +
    ` · 반복: ${data.iterations || 0}` +
    ` · 소요: ${Math.round((data.durationMs || 0) / 100) / 10}s` +
    ` · 최종 findings: C${counts.critical}/H${counts.high}/M${counts.medium}/L${counts.low}/N${counts.note}` +
    (data.reason ? ` · 이유: ${data.reason}` : "");
  text.textContent = data.finalPlan || "(플랜 없음)";
  overlay.classList.add("visible");
}

// ── Init ──
connectWS();
// Terminal is default tab — init immediately
initTerminal();
// Seed empty tool feed + critique timeline placeholders
renderToolFeed();
renderCritiqueTimeline();
// Load pipeline templates and render default
loadAllTemplates();
// Show harness mode indicator (state from server)
fetchHarnessMode();
// Server / Codex initial status
fetchServerInfo();
setInterval(fetchServerInfo, 15000);
