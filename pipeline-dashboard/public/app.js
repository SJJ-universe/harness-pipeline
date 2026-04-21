// ── State ──
// Slice K (v5): raw WebSocket is now owned by HarnessWsClient. app.js keeps
// a reference to the client for watchdog reads.
let _wsClient = null;
let startTime = null;
let timerInterval = null;
let findings = { critical: 0, high: 0, medium: 0, low: 0, note: 0 };
const TOOL_FEED_LIMIT = 50;
const CRITIQUE_TIMELINE_LIMIT = 20;
const toolFeed = [];
const critiqueTimeline = [];
let currentPipelineConfig = null;
let pipelineTemplates = {};
let compactMode = false;
let currentTemplateId = "code-review";

// ── Korean Mappings ──
// Verdict mapping retained for log messages
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
      innerHtml += renderNodeHtml(ungrouped[0]);
      innerHtml += `<div class="connector horizontal"><div class="connector-line"></div><div class="connector-arrows">&#x21C4;</div><div class="connector-line"></div></div>`;
      innerHtml += renderNodeHtml(ungrouped[1]);
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
          innerHtml += renderNodeHtml(node, true);
          // Check if next node exits the group
          if (!nextNode || !nextNode.group) {
            innerHtml += `</div></div>`; // close reviewer-row + fan-out
            inGroup = false;
          }
        } else {
          innerHtml += renderNodeHtml(node);
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
        innerHtml += renderNodeHtml(node);
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

  // Sync compact view if active
  if (compactMode) renderCompactPipeline();
}

let _nodePhaseMap = {};

function renderNode(node, isReviewer) {
  const iconClass = ICON_CLASSES[node.iconType] || "emoji-icon";
  const phase = findPhaseForNode(node.id);

  const el = document.createElement("div");
  el.className = "node" + (isReviewer ? " reviewer" : "");
  el.id = `node-${node.id}`;
  el.dataset.node = node.id;

  const icon = document.createElement("div");
  icon.className = `node-icon ${iconClass}`;
  icon.textContent = node.icon;
  el.appendChild(icon);

  const label = document.createElement("div");
  label.className = "node-label";
  label.textContent = node.label;
  label.appendChild(document.createElement("br"));
  const sub = document.createElement("small");
  sub.textContent = node.sublabel;
  label.appendChild(sub);
  el.appendChild(label);

  if (phase) {
    const meta = document.createElement("div");
    meta.className = "node-meta";
    // Use node's own iconType for agent tag (claude/codex), fall back to phase agent
    const nodeAgent = (node.iconType === "claude" || node.iconType === "codex")
      ? node.iconType : phase.agent;
    if (nodeAgent) {
      const tag = document.createElement("span");
      tag.className = `node-agent-tag agent-${nodeAgent}`;
      tag.textContent = nodeAgent;
      meta.appendChild(tag);
    }
    if (phase.allowedTools && phase.allowedTools.length > 0) {
      const tc = document.createElement("span");
      tc.className = "node-tool-count";
      tc.textContent = `${phase.allowedTools.length} tools`;
      tc.title = phase.allowedTools.join(", ");
      meta.appendChild(tc);
    }
    el.appendChild(meta);
  }

  if (isReviewer) {
    const badge = document.createElement("div");
    badge.className = "findings-badge";
    badge.id = `badge-${node.id}`;
    el.appendChild(badge);
  }

  return el;
}

function findPhaseForNode(nodeId) {
  if (!currentPipelineConfig) return null;
  for (const phase of currentPipelineConfig.phases) {
    if (phase.nodes.some(n => n.id === nodeId)) return phase;
  }
  return null;
}

function renderNodeHtml(node, isReviewer) {
  const el = renderNode(node, isReviewer);
  return el.outerHTML;
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
    currentTemplateId = templateId;
    updatePipelinePill();
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
      updatePipelinePill();
    }
  } catch (err) {
    console.error("Failed to load templates:", err);
  }
}

// ── Pipeline Pill (template cycling) ──
const TEMPLATE_ORDER = ["code-review", "default", "testing"];
const TEMPLATE_NAMES = { "code-review": "코드 리뷰", "default": "범용 태스크", "testing": "테스트" };

function cyclePipelineTemplate() {
  const idx = TEMPLATE_ORDER.indexOf(currentTemplateId);
  const next = TEMPLATE_ORDER[(idx + 1) % TEMPLATE_ORDER.length];
  currentTemplateId = next;
  loadPipelineTemplate(next);
  updatePipelinePill();
}

function updatePipelinePill() {
  const pill = document.getElementById("pipeline-pill");
  if (pill) pill.textContent = TEMPLATE_NAMES[currentTemplateId] || currentTemplateId;
}

// ── Compact Pipeline Mode ──
function toggleCompactMode() {
  compactMode = !compactMode;
  const compact = document.getElementById("compact-pipeline");
  const full = document.getElementById("pipeline-container");
  const btn = document.getElementById("btn-toggle-compact");
  if (compactMode) {
    compact.classList.remove("hidden");
    full.classList.add("hidden");
    if (btn) btn.textContent = "detail";
    renderCompactPipeline();
  } else {
    compact.classList.add("hidden");
    full.classList.remove("hidden");
    if (btn) btn.textContent = "compact";
  }
}

function renderCompactPipeline() {
  if (!currentPipelineConfig) return;
  const container = document.getElementById("compact-pipeline");
  if (!container) return;
  container.textContent = "";
  const bar = document.createElement("div");
  bar.className = "compact-bar";

  currentPipelineConfig.phases.forEach((phase, idx) => {
    if (idx > 0) {
      const arrow = document.createElement("span");
      arrow.className = "compact-arrow";
      arrow.textContent = phase.linkedCycle ? "\u27F2" : "\u2192";
      bar.appendChild(arrow);
    }
    const dot = document.createElement("div");
    dot.className = "compact-phase";
    dot.id = `compact-${phase.id}`;
    dot.dataset.phase = phase.id;
    dot.title = `${phase.label}: ${phase.name}`;
    dot.addEventListener("click", () => {
      const title = PHASE_NAMES[phase.id] || `Phase ${phase.id}`;
      openModal(title, stageLogKey("phase", phase.id));
    });

    const label = document.createElement("span");
    label.className = "compact-label";
    label.textContent = phase.id;

    const name = document.createElement("span");
    name.className = "compact-name";
    name.textContent = phase.name;

    dot.appendChild(label);
    dot.appendChild(name);
    bar.appendChild(dot);
  });

  container.appendChild(bar);
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

// ── Harness Horse Animation (pixel art, 3 frames) ──
const P = 3;
function _px(x, y, c) { return `<rect x="${x*P}" y="${y*P}" width="${P}" height="${P}" fill="${c}"/>`; }

// mode: "run1" | "run2" (gallop frames) | "rein" (front legs raised, body lifts)
function _buildHorseSvg(mode) {
  const B = "#d4a574", H = "#e8c9a0", D = "#a07850";
  const R = "#58a6ff", K = "#3a3a3a";
  const isRein = mode === "rein";
  const G = isRein ? "#f85149" : "#3fb950";
  const W = 20 * P, Ht = 14 * P;

  // Rein offsets: front body lifts, rear stays planted
  const liftY = isRein ? -1 : 0;       // slight body lift
  const chestY = isRein ? -2 : 0;      // front body/head lift
  const viewMinY = isRein ? -2 * P : 0;
  const viewHeight = Ht + (isRein ? 2 * P : 0);

  let px = "";

  if (isRein) {
    // ── REARING POSE: rider leans back, reins taut, front legs raised ──
    // Render order: back→front so legs/reins visible on top.

    // Rear body (slightly lifted, planted on rear legs)
    [5,6,7,8,9].forEach(x => [6,7,8].forEach(y => { px += _px(x, y + liftY, B); }));
    [7,8,9].forEach(x => { px += _px(x, 6 + liftY, H); });
    [6,7,8,9].forEach(x => { px += _px(x, 8 + liftY, D); });

    // Front body (chest raised high)
    [10,11,12,13].forEach(x => [6,7,8].forEach(y => { px += _px(x, y + chestY, B); }));
    [10,11].forEach(x => { px += _px(x, 6 + chestY, H); });
    [10,11,12].forEach(x => { px += _px(x, 8 + chestY, D); });

    // Neck (lifts with chest)
    [12,13].forEach(x => [4,5].forEach(y => { px += _px(x, y + chestY, B); }));

    // Head raised high
    px += _px(14, 1 + chestY, B); px += _px(15, 0 + chestY, B);
    [13,14,15].forEach(x => [2,3].forEach(y => { px += _px(x, y + chestY, B); }));
    px += _px(15, 2 + chestY, K);  // eye
    px += _px(16, 3 + chestY, H);  // muzzle highlight

    // Tail (follows rear body)
    px += _px(4, 7 + liftY, D); px += _px(3, 8 + liftY, D);

    // Back legs planted on ground (no offset)
    px += _px(6, 9, D); px += _px(6, 10, D); px += _px(6, 11, K);
    px += _px(7, 9, D); px += _px(7, 10, D); px += _px(7, 11, K);

    // ── Front legs: bent at knee, hooves dangling forward (rendered ON TOP) ──
    // Left front leg (rear of pair): upper close to body, knee bent forward
    px += _px(11, 7, D);   // thigh below belly
    px += _px(12, 8, D);   // knee
    px += _px(13, 9, K);   // hoof (forward & down)
    // Right front leg (forward pair): more extended forward
    px += _px(12, 7, D);   // thigh
    px += _px(13, 7, D);   // knee bent forward
    px += _px(14, 8, D);   // shin
    px += _px(15, 9, K);   // hoof (extended forward)

    // ── Rider leaning BACK (shifted from x=9-10 to x=8-9), arm extended forward ──
    // Upper body (head, torso) — leaned back at x=8
    px += _px(8, 0, R);    // head top
    px += _px(8, 1, R);    // head/face
    px += _px(8, 2, R);    // neck/upper torso
    px += _px(8, 3, R);    // mid torso
    px += _px(9, 2, R);    // shoulder
    px += _px(9, 3, R);    // chest
    px += _px(9, 4, R);    // waist (sitting)
    px += _px(10, 4, R);   // hip on horse
    px += _px(10, 5, R);   // leg on horse
    px += _px(9, 5, R);    // thigh
    // Arm extended forward holding the reins
    px += _px(10, 3, R);   // shoulder-to-arm
    px += _px(11, 3, R);   // forearm
    px += _px(12, 3, R);   // hand grip

    // ── Long taut reins: from rider's hand (12,3) diagonally to horse's mouth (16,1) ──
    px += _px(13, 2, G);
    px += _px(14, 2, G);
    px += _px(15, 1, G);
  } else {
    // ── RUNNING POSE (existing) ──
    // Rider
    [9,10].forEach(x => [1,2].forEach(y => { px += _px(x, y, R); }));
    [9,10].forEach(x => [3,4,5].forEach(y => { px += _px(x, y, R); }));
    // Reins (short, attached to mouth area)
    [11,12,13].forEach(x => { px += _px(x, 5, G); });
    // Head + ear
    px += _px(15, 2, B); px += _px(16, 1, B);
    [14,15,16].forEach(x => [3,4].forEach(y => { px += _px(x, y, B); }));
    px += _px(16, 3, K); px += _px(17, 4, H);
    // Neck
    [12,13].forEach(x => [4,5].forEach(y => { px += _px(x, y, B); }));
    // Body
    [5,6,7,8,9,10,11,12,13].forEach(x => [6,7,8].forEach(y => { px += _px(x, y, B); }));
    [7,8,9,10,11].forEach(x => { px += _px(x, 6, H); });
    [6,7,8,9,10,11,12].forEach(x => { px += _px(x, 8, D); });
    // Tail
    px += _px(4, 5, D); px += _px(3, 4, D); px += _px(2, 3, D);
  }

  // Running gait legs (only for run1/run2 — rein mode handled above)
  if (mode === "run1") {
    px += _px(13, 9, D); px += _px(14, 10, D); px += _px(15, 11, K);
    px += _px(11, 9, D); px += _px(11, 10, D); px += _px(11, 11, K);
    px += _px(6, 9, D); px += _px(5, 10, D); px += _px(4, 11, K);
    px += _px(8, 9, D); px += _px(8, 10, D); px += _px(8, 11, K);
  } else if (mode === "run2") {
    px += _px(12, 9, D); px += _px(12, 10, D); px += _px(12, 11, K);
    px += _px(13, 9, D); px += _px(12, 10, D); px += _px(11, 11, K);
    px += _px(7, 9, D); px += _px(7, 10, D); px += _px(7, 11, K);
    px += _px(6, 9, D); px += _px(5, 10, D); px += _px(5, 11, K);
  }
  return `<svg viewBox="0 ${viewMinY} ${W} ${viewHeight}" xmlns="http://www.w3.org/2000/svg" style="image-rendering:pixelated">${px}</svg>`;
}

const HORSE_FRAMES = [_buildHorseSvg("run1"), _buildHorseSvg("run2")];
const HORSE_SVG_STOP = _buildHorseSvg("rein");

// ── Codex live output panel state ──
let _codexLiveRunId = null;
let _codexLiveHideTimer = null;
const MAX_CODEX_LIVE_LINES = 400;

function _clearCodexLiveHideTimer() {
  if (_codexLiveHideTimer) {
    clearTimeout(_codexLiveHideTimer);
    _codexLiveHideTimer = null;
  }
}

function _trimCodexLive() {
  const out = document.getElementById("codex-live-output");
  if (!out) return;
  const text = out.textContent || "";
  const lines = text.split("\n");
  if (lines.length > MAX_CODEX_LIVE_LINES) {
    out.textContent = lines.slice(-MAX_CODEX_LIVE_LINES).join("\n");
  }
}

let horseState = "idle";
let _horseTimer = null;
let _gallopInterval = null;
let _gallopFrame = 0;

function _clearHorseTimer() {
  if (_horseTimer) { clearTimeout(_horseTimer); _horseTimer = null; }
}

function _stopGallop() {
  if (_gallopInterval) { clearInterval(_gallopInterval); _gallopInterval = null; }
}

function _startGallop() {
  _stopGallop();
  const rider = document.getElementById("horse-rider");
  if (!rider) return;
  _gallopFrame = 0;
  rider.innerHTML = HORSE_FRAMES[0];
  _gallopInterval = setInterval(() => {
    _gallopFrame = (_gallopFrame + 1) % 2;
    rider.innerHTML = HORSE_FRAMES[_gallopFrame];
  }, 250);
}

function _renderHorseSvg(state) {
  _stopGallop();
  if (state === "galloping") {
    _startGallop();
  } else {
    const rider = document.getElementById("horse-rider");
    if (rider) rider.innerHTML = HORSE_SVG_STOP;
  }
}

function setHorseState(state, statusText) {
  _clearHorseTimer();
  if (state === horseState && state !== "reining") return;
  horseState = state;
  const rider = document.getElementById("horse-rider");
  const status = document.getElementById("harness-status");
  if (!rider) return;

  rider.classList.remove("galloping", "reining");

  if (state === "galloping") {
    _renderHorseSvg("galloping");
    rider.classList.add("galloping");
    if (status) { status.textContent = statusText || ""; status.className = "harness-status active"; }
  } else if (state === "reining") {
    _renderHorseSvg("reining");
    rider.classList.add("reining");
    if (status) { status.textContent = statusText || ""; status.className = "harness-status blocked"; }
  } else {
    _renderHorseSvg("idle");
    if (status) { status.textContent = ""; status.className = "harness-status"; }
  }
}

function reinThenResume(statusText, delayMs) {
  setHorseState("reining", statusText);
  _horseTimer = setTimeout(() => {
    _horseTimer = null;
    if (horseState === "reining") setHorseState("galloping", "실행 중");
  }, delayMs);
}

// Update only the status text without toggling horse state (for heartbeat ticks)
function setHorseStatusText(text) {
  const status = document.getElementById("harness-status");
  if (status) status.textContent = text || "";
}

// ── WebSocket ──
// Slice K (v5): the raw socket / reconnect loop / wasConnected bookkeeping
// moved into public/js/ws-client.js (HarnessWsClient). app.js keeps only
//   - the watchdog that reads the client's last-event timestamp
//   - the toast callbacks wired into the client's lifecycle events
//   - a thin connectWS() entry point so init() reads the same as before.
let _wsMonitorTimer = null;
let _pipelineActive = false;

function startWsMonitor() {
  if (_wsMonitorTimer) return; // single global monitor — no duplicates on reconnect
  _wsMonitorTimer = setInterval(() => {
    if (!_wsClient) return;
    const silentMs = Date.now() - _wsClient.getLastEventAt();
    if (silentMs > 10_000 && _pipelineActive) {
      const sec = Math.round(silentMs / 1000);
      setBadge("warn", `서버 응답 없음 ${sec}s`);
    }
  }, 2000);
}

function _toast(opts) {
  try {
    if (window.HarnessToast && typeof window.HarnessToast.show === "function") {
      return window.HarnessToast.show(opts);
    }
  } catch (_) {}
  return null;
}

function connectWS() {
  if (!window.HarnessWsClient) {
    console.error("HarnessWsClient not loaded — check index.html script order");
    return;
  }
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  _wsClient = window.HarnessWsClient.install({
    url: `${protocol}//${location.host}`,
    onEvent: (event) => handleEvent(event),
    onConnected: () => { startWsMonitor(); },
    onReconnected: () => {
      startWsMonitor();
      _toast({ type: "success", message: "서버 재연결됨", duration: 2500 });
    },
    onDisconnected: () => {
      _toast({ type: "warn", message: "서버 연결 끊김 — 재연결 중…", duration: 4000 });
    },
    onInitialError: ({ retry }) => {
      _toast({
        type: "error",
        message: "서버에 연결할 수 없습니다",
        actionLabel: "재시도",
        onAction: retry,
      });
    },
  });
}

// ── Event Handler ──
// Pure reducer for pipeline_replay — restores UI state WITHOUT side effects.
// Skips: horse animations, live card toggling, timers, sound, auto-scroll of non-feeds.
function applyReplayEvent(event) {
  if (!event || !event.type) return;
  const d = event.data || {};
  const _stageKeys = getStageKeysForEvent(event);
  switch (event.type) {
    case "phase_update":
      updatePhase(d.phase, d.status);
      addLog("phase", `Phase ${d.phase}: ${d.status}`, false, _stageKeys);
      break;
    case "node_update":
      updateNode(d.node, d.status);
      if (d.findings != null) showFindingsBadge(d.node, d.findings);
      if (d.totalFindings) updateFindingCounts(d.totalFindings);
      break;
    case "tool_recorded":
      pushToolFeed({
        ts: d.timestamp || Date.now(),
        phase: d.phase || "?",
        tool: d.tool || "?",
        input: summarizeToolInput(d.tool, d.input),
        blocked: false,
      });
      break;
    case "tool_blocked":
      pushToolFeed({
        ts: Date.now(),
        phase: d.phase || "?",
        tool: d.tool || "?",
        blocked: true,
        reason: d.reason || "",
        source: d.source || "unknown",
      });
      break;
    case "gate_failed":
      for (const m of (d.missing || [])) {
        pushToolFeed({
          ts: Date.now(),
          phase: d.phase || "?",
          tool: "QualityGate",
          input: m,
          blocked: true,
          reason: `attempt ${d.retries || 0}/3`,
        });
      }
      break;
    case "critique_received": {
      const f = d.findings || [];
      const counts = { critical: 0, high: 0, medium: 0, low: 0, note: 0 };
      for (const item of f) {
        const sev = item.severity || "note";
        if (counts[sev] !== undefined) counts[sev]++;
      }
      findings.critical += counts.critical;
      findings.high += counts.high;
      findings.medium += counts.medium;
      findings.low += counts.low;
      findings.note += counts.note;
      pushCritique({
        ts: Date.now(),
        phase: d.phase || "?",
        iteration: d.iteration != null ? d.iteration : null,
        summary: d.summary || "",
        counts,
        topFindings: f.slice(0, 3).map((x) => ({
          severity: x.severity || "note",
          note: x.note || x.message || x.description || "",
        })),
      });
      break;
    }
    case "cycle_iteration":
      updateCycleCounter(d.iteration);
      addLog("phase", `사이클 반복 ${d.iteration} — ${d.phase} → ${d.linkedTo}`, false, _stageKeys);
      break;
    case "artifact_captured":
      // Flash would be visually distracting during replay; skip animation, just log
      addLog("phase", `[${d.phase}] 산출물 수집 — ${d.key}`, false, _stageKeys);
      break;
    // Slice D (v4): subagent lifecycle replay. We route through the tray's
    // `restore()` entry point so it can skip the post-complete fade timer —
    // a refreshed page should see historical subagents in their final state,
    // not watch them fade immediately after replay.
    case "subagent_started":
      if (window.HarnessSubagentTray && typeof window.HarnessSubagentTray.restore === "function") {
        window.HarnessSubagentTray.restore("subagent_started", d);
      }
      break;
    case "subagent_completed":
      if (window.HarnessSubagentTray && typeof window.HarnessSubagentTray.restore === "function") {
        window.HarnessSubagentTray.restore("subagent_completed", d);
      }
      break;
    // Intentionally skipped (side-effectful): codex_started, codex_progress, heartbeat,
    //   pipeline_start, pipeline_complete, pipeline_reset, pipeline_resume, pipeline_restored,
    //   pipeline_paused, claim_verification_failed, hook_event, auto_pipeline_detect,
    //   pipeline_mutated, harness_notification, pipeline_compacted
  }
}

function handleEvent(event) {
  // Slice R (v6): try the registry first. Handlers registered via
  // HarnessEventDispatcher.register() handle their own type; the switch
  // below is the legacy fallback for types that haven't been migrated yet.
  // This lets Slice T/U add new event types (child_queue_depth, run_tab_*,
  // runId-scoped events) without stretching the 32-case switch.
  if (window.HarnessEventDispatcher && window.HarnessEventDispatcher.dispatch(event)) {
    return;
  }

  // Track which stage keys this event belongs to (for modal popup)
  const _stageKeys = getStageKeysForEvent(event);

  switch (event.type) {
    case "pipeline_reset":
      resetUI();
      addLog("phase", "파이프라인 리셋됨");
      setHorseState("idle");
      _pipelineActive = false;
      break;

    case "pipeline_start":
      resetUI();
      startTimer();
      setBadge("running", event.data.mode === "live" ? "라이브" : "실행중");
      addLog("phase", `파이프라인 시작 — ${event.data.mode} 모드 — ${event.data.targetFile}`, false, _stageKeys);
      setHorseState("galloping", "실행 중");
      _pipelineActive = true;
      break;

    case "pipeline_resume": {
      const d = event.data || {};
      addLog("phase", `기존 파이프라인 계속 — Phase ${d.phase || "?"} (${d.templateId || "unknown"})`);
      setHorseState("galloping", `Phase ${d.phase || "?"} 계속`);
      _pipelineActive = true;
      break;
    }

    case "pipeline_restored": {
      const d = event.data || {};
      const time = d.savedAt ? new Date(d.savedAt).toLocaleTimeString() : "?";
      addLog("phase", `체크포인트 복원 — Phase ${d.phase || "?"} (저장 시각: ${time})`);
      setHorseState("galloping", `Phase ${d.phase || "?"} 복원`);
      _pipelineActive = true;
      break;
    }

    case "pipeline_paused": {
      const d = event.data || {};
      addLog("phase", `일시중단 (${d.reason || "?"}) — Phase ${d.phase || "?"}`);
      setHorseState("idle", `일시중단 — Phase ${d.phase || "?"}`);
      setBadge("warn", "일시중단");
      _pipelineActive = false;
      // Mark the current phase as paused (amber dim) so UI shows where it stopped
      if (d.phase) updatePhase(d.phase, "paused");
      break;
    }

    case "pipeline_replay": {
      const d = event.data || {};
      if (d.status === "idle") {
        _pipelineActive = false;
        return;
      }
      // 1. Render pipeline structure (destroys old DOM, builds new)
      if (d.template) {
        currentPipelineConfig = d.template;
        renderPipeline(d.template);
      }
      // 2. Reset UI state buffers (events will rebuild them)
      toolFeed.length = 0;
      critiqueTimeline.length = 0;
      stageLogs = {};
      findings = { critical: 0, high: 0, medium: 0, low: 0, note: 0 };
      // 3. Apply each event via PURE reducer (no horse/timer/live card side effects)
      for (const ev of (d.events || [])) {
        try { applyReplayEvent(ev); } catch (_) {}
      }
      // 4. Render accumulated buffers
      renderToolFeed();
      renderCritiqueTimeline();
      renderFindingCounts();
      // 5. Final phase state (overrides any stale phase_update from replayed events)
      if (d.template && Array.isArray(d.template.phases) && d.phaseIdx >= 0) {
        for (let i = 0; i < d.template.phases.length; i++) {
          const p = d.template.phases[i];
          if (i < d.phaseIdx) updatePhase(p.id, "completed");
          else if (i === d.phaseIdx) updatePhase(p.id, d.status === "paused" ? "paused" : "active");
          else updatePhase(p.id, "");
        }
      }
      // 6. Final horse/badge state
      if (d.status === "active") {
        setHorseState("galloping", `복원됨 — Phase ${d.phase || "?"}`);
        _pipelineActive = true;
      } else if (d.status === "paused") {
        setHorseState("idle", `일시중단 — Phase ${d.phase || "?"}`);
        setBadge("warn", "일시중단");
        _pipelineActive = false;
      }
      break;
    }

    case "heartbeat": {
      const d = event.data || {};
      const sec = Math.round((d.elapsedMs || 0) / 1000);
      if (d.codexRunning) {
        const codexSec = Math.round((Date.now() - d.codexRunning) / 1000);
        setHorseStatusText(`Codex 작업 중… ${codexSec}s (총 ${sec}s)`);
      } else {
        setHorseStatusText(`Phase ${d.phase || "?"} 진행 중… ${sec}s`);
      }
      break;
    }

    case "phase_update":
      updatePhase(event.data.phase, event.data.status);
      addLog("phase", `Phase ${event.data.phase}: ${event.data.status}`, false, _stageKeys);
      if (event.data.status === "active") {
        setHorseState("galloping", `Phase ${event.data.phase} 진행`);
      } else if (event.data.status === "completed") {
        reinThenResume("Phase 전환", 800);
      }
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

    case "findings":
      processFindingsEvent(event.data, _stageKeys);
      break;

    case "error":
      handleError(event.data, _stageKeys);
      break;

    case "verdict": {
      const koVerdict = VERDICT_KO[event.data.verdict] || event.data.verdict;
      addLog("verdict", `판정: ${koVerdict} (${event.data.verdict})`, false, _stageKeys);
      break;
    }

    case "pipeline_complete":
      stopTimer();
      setBadge("done", "완료");
      addLog("phase", "파이프라인 완료");
      if (event.data.errors && event.data.errors.length > 0) {
        addLog("error", `${event.data.errors.length}개 오류 발생`);
      }
      // Show verification result
      if (event.data.verification) {
        updateVerificationStatus(event.data.verification);
      }
      setHorseState("idle");
      _pipelineActive = false;
      break;

    case "harness_complete":
      stopTimer();
      setBadge("done", "완료");
      addLog("phase", `하네스 완료: ${event.data.harnessId || "unknown"}`);
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
        source: event.data.source || "unknown",
      };
      pushToolFeed(entry);
      const layerLabel = {
        danger: "DangerGate",
        policy: "PhasePolicy",
        contract: "AgentContract",
        allowedTools: "AllowedTools",
      }[entry.source] || entry.source;
      addLog("error",
        `[${entry.phase}] ${entry.tool} 차단 [${layerLabel}] — ${entry.reason || (entry.allowed || []).join(", ")}`,
        true, _stageKeys);
      setHorseState("reining", `정책 차단: ${entry.tool}`);
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
      // Show each missing criterion as a separate tool-feed entry
      for (const m of (event.data.missing || [])) {
        pushToolFeed({
          ts: Date.now(),
          phase: event.data.phase || "?",
          tool: "QualityGate",
          input: m,
          blocked: true,
          reason: `attempt ${event.data.retries}/3`,
        });
      }
      addLog("error",
        `[${event.data.phase}] 품질 게이트 실패 (시도 ${event.data.retries}/3) — ${reasons}`,
        true, _stageKeys);
      setHorseState("reining", "게이트 실패");
      break;
    }

    case "gate_bypassed":
      addLog("error",
        `[${event.data.phase}] 게이트 우회됨 (재시도 ${event.data.retries}회 초과) — ${(event.data.missing || []).join("; ")}`,
        true, _stageKeys);
      break;

    case "codex_started": {
      const d = event.data || {};
      _clearCodexLiveHideTimer();
      _codexLiveRunId = d.runId || null;
      const card = document.getElementById("codex-live-card");
      const out = document.getElementById("codex-live-output");
      const meta = document.getElementById("codex-live-meta");
      if (card) card.classList.remove("is-hidden");
      if (out) out.textContent = "";
      if (meta) meta.textContent = `phase ${d.phase || "?"} · iter ${d.iteration || 0}`;
      addLog("phase", `[${d.phase}] Codex 시작 — ${d.promptPreview || ""}`, false, _stageKeys);
      break;
    }

    case "codex_progress": {
      const d = event.data || {};
      // Ignore chunks from a different run (prevents cross-iteration bleed)
      if (_codexLiveRunId != null && d.runId != null && _codexLiveRunId !== d.runId) break;
      const out = document.getElementById("codex-live-output");
      if (out) {
        if (d.stderr) {
          const span = document.createElement("span");
          span.className = "stderr-line";
          span.textContent = d.stderr;
          out.appendChild(span);
        }
        if (d.stdout) {
          out.appendChild(document.createTextNode(d.stdout));
        }
        _trimCodexLive();
        out.scrollTop = out.scrollHeight;
      }
      const meta = document.getElementById("codex-live-meta");
      if (meta) {
        const sec = Math.round((d.elapsedMs || 0) / 1000);
        meta.textContent = `phase ${d.phase || "?"} · iter ${d.iteration || 0} · ${sec}s${d.truncated ? " · truncated" : ""}`;
      }
      break;
    }

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

      // Schedule live card hide — but only if no new run takes over within 5s
      _clearCodexLiveHideTimer();
      const hidingRunId = _codexLiveRunId;
      _codexLiveHideTimer = setTimeout(() => {
        _codexLiveHideTimer = null;
        // If a new codex_started changed the runId, the next cycle is using the card — don't hide
        if (_codexLiveRunId !== hidingRunId) return;
        const card = document.getElementById("codex-live-card");
        if (card) card.classList.add("is-hidden");
        _codexLiveRunId = null;
      }, 5000);
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

    // Slice C (v4): Claude Code's Notification hook is surfaced via
    // harness_notification. Render as a toast with the hook's own level.
    case "harness_notification": {
      const d = event.data || {};
      const level = (d.level || "info").toLowerCase();
      const toastType =
        level === "error" || level === "critical" ? "error"
        : level === "warn" || level === "warning" ? "warn"
        : level === "success" ? "success"
        : "info";
      _toast({ type: toastType, message: d.message || "(알림)" });
      addLog(toastType === "error" ? "error" : "phase",
        `[알림/${level}] ${d.message || ""}`, toastType === "error");
      break;
    }

    // Slice A (v4): broadcast from onPreCompact. No UI state change required —
    // the pipeline is briefly paused for compaction and SessionStart(compact)
    // will re-inject the summary. Just log + toast so the user sees it.
    case "pipeline_compacted": {
      const d = event.data || {};
      addLog("phase",
        `컨텍스트 압축됨 (Phase ${d.phase || "?"}) — 요약 ${d.summaryBytes || 0}B 저장, 다음 세션에서 재주입`);
      _toast({ type: "info", message: `컨텍스트 압축 — 요약 저장됨`, duration: 3500 });
      break;
    }

    // Slice E (v4): custom template was added/removed on the server. If the
    // editor modal is open, it refetches the list. Either way the pipeline
    // selector pill should re-read the merged list so users can cycle into
    // the newly-added template without reloading.
    case "template_registry_reloaded": {
      const d = event.data || {};
      if (window.HarnessTemplateEditor && typeof window.HarnessTemplateEditor.onRegistryReloaded === "function") {
        window.HarnessTemplateEditor.onRegistryReloaded();
      }
      // Refresh in-memory template cache that cyclePipelineTemplate uses
      try { if (typeof loadAllTemplates === "function") loadAllTemplates(); } catch (_) {}
      addLog("phase",
        `템플릿 레지스트리 갱신 — ${d.kind || "?"}: ${d.changed || "?"}`);
      break;
    }

    // Slice D (v4): Claude Code subagent (Agent tool) lifecycle surfaces into
    // a dedicated tray. The live handlers just delegate to HarnessSubagentTray
    // which owns animation + fade-out; we only log the summary here.
    case "subagent_started": {
      const d = event.data || {};
      if (window.HarnessSubagentTray) {
        window.HarnessSubagentTray.start({
          session_id: d.session_id || d.agent_id,
          agent_type: d.agent_type,
          parent_session_id: d.parent_session_id || null,
        });
      }
      addLog("phase",
        `서브에이전트 시작 — ${d.agent_type || "unknown"} (id=${String(d.session_id || d.agent_id || "").slice(0, 8)})`);
      break;
    }
    case "subagent_completed": {
      const d = event.data || {};
      if (window.HarnessSubagentTray) {
        window.HarnessSubagentTray.complete({
          session_id: d.session_id || d.agent_id,
          agent_type: d.agent_type,
          elapsedMs: d.elapsedMs,
        });
      }
      const sec = Number.isFinite(d.elapsedMs) ? (d.elapsedMs / 1000).toFixed(1) + "s" : "?s";
      addLog("phase",
        `서브에이전트 완료 — ${d.agent_type || "unknown"} (${sec})`);
      break;
    }

    case "general_plan_complete": {
      const triggerBtn = document.getElementById("btn-start-general");
      const abortBtn = document.getElementById("btn-abort-general");
      if (triggerBtn) triggerBtn.disabled = false;
      if (abortBtn) abortBtn.classList.add("is-hidden");
      showFinalPlan(event.data || {});
      break;
    }

    case "context_alarm": {
      const d = event.data || {};
      const level = d.level || "warning";
      const pct = d.percent || d.pct || "?";
      updateContextBar(pct, level);
      addLog(level === "block" ? "error" : "phase",
        `[Context] ${d.message || ""} (${pct}% 사용)`,
        level === "block", _stageKeys);
      break;
    }

    case "claim_verification_failed": {
      const missing = (event.data.missing || []).join(", ");
      updateVerificationStatus({ pass: false, missing: event.data.missing || [] });
      addLog("error", `[검증 실패] 증거 부족: ${missing}`, true, _stageKeys);
      setHorseState("reining", "검증 대기: 증거 부족");
      break;
    }

    case "critique_persist_failed": {
      addLog("error",
        `[Phase ${event.data.phase || "?"}] 비평 저장 실패: ${event.data.error || "unknown"}`,
        true, _stageKeys);
      break;
    }

    case "hook_event": {
      pushToolFeed({
        ts: event.data.at || Date.now(),
        phase: "H",
        tool: `hook:${event.data.event || "?"}`,
        input: event.data.tool || "",
        blocked: false,
      });
      break;
    }

    case "codex_trigger_started": {
      const d = event.data || {};
      addLog("phase", `[Codex] 트리거 시작: ${d.triggerId || "?"} (timeout: ${d.timeoutMs || "?"}ms)`);
      break;
    }

    case "codex_trigger_done": {
      const d = event.data || {};
      addLog(d.ok ? "phase" : "error",
        `[Codex] 트리거 완료: ${d.triggerId || "?"} — ${d.ok ? "성공" : "실패"} (${d.durationMs || "?"}ms)`,
        !d.ok, _stageKeys);
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

  // Update pipeline pill
  currentTemplateId = templateId;
  updatePipelinePill();

  // Load and render the template
  loadPipelineTemplate(templateId);

  addLog("phase", `자동 감지: ${reason} → ${templateId} 파이프라인 로드`);
}

// ── UI Updates ──

function updatePhase(phase, status) {
  // Full mode — remove all state classes, then add the current one if truthy
  const el = document.getElementById(`phase-${phase}`);
  if (el) {
    el.classList.remove("active", "completed", "error", "paused");
    if (status && status !== "idle") el.classList.add(status);
  }
  // Compact mode
  const compact = document.getElementById(`compact-${phase}`);
  if (compact) {
    compact.classList.remove("active", "completed", "error", "paused");
    if (status && status !== "idle") compact.classList.add(status);
  }
}

function updateNode(node, status) {
  const el = document.getElementById(`node-${node}`);
  if (!el) return;
  el.classList.remove("active", "completed", "error");
  if (status !== "idle") el.classList.add(status);
}

function showFindingsBadge(node, count) {
  const el = document.getElementById(`badge-${node}`);
  if (!el) return;
  el.textContent = count;
  el.classList.add("visible");
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
    el.textContent = "";
    el.appendChild(Object.assign(document.createElement("div"), { className: "tool-empty", textContent: "아직 기록된 툴 호출이 없습니다." }));
    return;
  }
  el.textContent = "";
  for (const e of toolFeed) {
    const div = document.createElement("div");
    div.className = e.blocked ? "tool-entry blocked" : "tool-entry";
    const time = Object.assign(document.createElement("span"), { className: "tool-time", textContent: formatHMS(e.ts) });
    const phase = Object.assign(document.createElement("span"), { className: "tool-phase", textContent: `[${e.phase}]` });
    const tool = Object.assign(document.createElement("span"), { className: "tool-tool", textContent: e.tool });
    div.appendChild(time);
    div.appendChild(phase);
    div.appendChild(tool);
    if (e.blocked) {
      div.appendChild(Object.assign(document.createElement("span"), { className: "tool-blocked", textContent: "BLOCK" }));
      div.appendChild(Object.assign(document.createElement("span"), { className: "tool-reason", textContent: e.reason || (e.allowed || []).join(",") }));
    } else {
      div.appendChild(document.createElement("span"));
      div.appendChild(Object.assign(document.createElement("span"), { className: "tool-input", textContent: e.input || "" }));
    }
    el.appendChild(div);
  }
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
    el.textContent = "";
    el.appendChild(Object.assign(document.createElement("div"), { className: "tool-empty", textContent: "아직 수신된 비평이 없습니다." }));
    return;
  }
  el.textContent = "";
  for (const e of critiqueTimeline) {
    const entry = document.createElement("div");
    entry.className = "critique-entry";
    const head = document.createElement("div");
    head.className = "critique-head";
    const iter = e.iteration != null ? ` iter ${e.iteration}` : "";
    head.appendChild(Object.assign(document.createElement("span"), { className: "critique-time", textContent: formatHMS(e.ts) }));
    head.appendChild(Object.assign(document.createElement("span"), { className: "critique-phase", textContent: `[${e.phase}${iter}]` }));
    const chipsSpan = document.createElement("span");
    chipsSpan.className = "critique-chips";
    for (const k of ["critical", "high", "medium", "low", "note"]) {
      if (e.counts[k] > 0) {
        chipsSpan.appendChild(Object.assign(document.createElement("span"), { className: `sev-chip sev-${k}`, textContent: `${k.charAt(0).toUpperCase()}:${e.counts[k]}` }));
      }
    }
    head.appendChild(chipsSpan);
    entry.appendChild(head);
    if (e.summary) {
      entry.appendChild(Object.assign(document.createElement("div"), { className: "critique-summary", textContent: e.summary }));
    }
    for (const f of (e.topFindings || [])) {
      const finding = document.createElement("div");
      finding.className = "critique-finding";
      finding.appendChild(Object.assign(document.createElement("span"), { className: `sev-dot sev-${f.severity}` }));
      finding.appendChild(document.createTextNode(f.note));
      entry.appendChild(finding);
    }
    el.appendChild(entry);
  }
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
  if (tool === "Bash") return String(input.command || "").slice(0, 80);
  if (tool === "Agent") return (input.description || input.subagent_type || "").slice(0, 50);
  if (tool === "TodoWrite") return `${(input.todos || []).length} items`;
  if (tool === "WebFetch") return input.url || "";
  if (tool === "WebSearch") return input.query || "";
  if (tool === "Skill") return input.skill || "";
  // MCP tools (mcp__xxx__yyy)
  if (tool.startsWith("mcp__")) {
    const parts = tool.split("__");
    return parts.length >= 3 ? parts[2] : tool;
  }
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

  const entry = document.createElement("div");
  entry.className = "log-entry";
  const avatarEl = Object.assign(document.createElement("div"), { className: `log-avatar ${tag}`, textContent: avatar.icon });
  const bubble = Object.assign(document.createElement("div"), { className: `log-bubble${bubbleClass}` });
  const header = document.createElement("div");
  header.className = "log-bubble-header";
  header.appendChild(Object.assign(document.createElement("span"), { className: "log-sender", textContent: avatar.label }));
  header.appendChild(Object.assign(document.createElement("span"), { className: "log-time", textContent: time }));
  bubble.appendChild(header);
  bubble.appendChild(Object.assign(document.createElement("div"), { className: `log-msg${isError ? " error-msg" : ""}`, textContent: message }));
  entry.appendChild(avatarEl);
  entry.appendChild(bubble);
  container.appendChild(entry);
  container.scrollTop = container.scrollHeight;

  // Store text for per-stage popup modal
  for (const key of stageKeys) {
    addStageLog(key, { time, message, isError });
  }
}

function clearLog() {
  document.getElementById("log-content").textContent = "";
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
  // Reset timer
  stopTimer();
  // Reset badge
  setBadge("", "대기");
  // Reset stage logs
  stageLogs = {};
  // Slice D (v4): drop the subagent tray state along with everything else so
  // a new pipeline doesn't inherit ghost agents from the previous run.
  if (window.HarnessSubagentTray && typeof window.HarnessSubagentTray.reset === "function") {
    window.HarnessSubagentTray.reset();
  }
}


// ── Context Bar + Verification Status ──
function updateContextBar(percent, level) {
  const bar = document.getElementById("context-bar");
  if (!bar) return;
  const fill = bar.querySelector(".context-fill");
  const label = bar.querySelector(".context-label");
  if (fill) {
    fill.style.width = `${Math.min(percent, 100)}%`;
    fill.className = `context-fill context-${level}`;
  }
  if (label) label.textContent = `${percent}%`;
}

function updateVerificationStatus(verification) {
  const el = document.getElementById("verify-status");
  if (!el) return;
  if (verification.pass) {
    el.textContent = "PASS";
    el.className = "verify-status verify-pass";
    el.title = "";
  } else {
    const missing = verification.missing || [];
    el.textContent = `FAIL (${missing.length})`;
    el.className = "verify-status verify-fail";
    el.title = missing.join(", ");
  }
}

// ── Modal / Stage Popup ──
function openModal(title, key) {
  const overlay = document.getElementById("modal-overlay");
  const titleEl = document.getElementById("modal-title");
  const body = document.getElementById("modal-body");

  titleEl.textContent = title;
  const logs = stageLogs[key] || [];

  body.textContent = "";

  // Show phase operational metadata if this is a phase modal
  if (key.startsWith("phase-") && currentPipelineConfig) {
    const phaseId = key.replace("phase-", "");
    const phase = currentPipelineConfig.phases.find(p => p.id === phaseId);
    if (phase && (phase.agent || phase.allowedTools || phase.exitCriteria)) {
      const meta = document.createElement("div");
      meta.className = "modal-phase-meta";
      const items = [];
      if (phase.agent) items.push(`Agent: ${phase.agent}`);
      if (phase.allowedTools) items.push(`Tools: ${phase.allowedTools.join(", ")}`);
      if (phase.exitCriteria) {
        items.push(`Exit: ${phase.exitCriteria.map(c => c.message).join("; ")}`);
      }
      if (phase.cycle) items.push(`Cycle: max ${phase.maxIterations || 3} iterations → Phase ${phase.linkedCycle || "?"}`);
      meta.textContent = items.join(" | ");
      body.appendChild(meta);
    }
  }

  if (logs.length === 0) {
    body.appendChild(Object.assign(document.createElement("div"), { className: "modal-empty", textContent: "이 단계의 로그가 아직 없습니다." }));
  } else {
    for (const log of logs) {
      const entry = document.createElement("div");
      entry.className = "log-entry";
      if (typeof log === "object" && log.time) {
        entry.appendChild(Object.assign(document.createElement("span"), { className: "log-time", textContent: log.time }));
        entry.appendChild(Object.assign(document.createElement("span"), { className: `log-msg${log.isError ? " error-msg" : ""}`, textContent: log.message }));
      } else {
        entry.textContent = String(log);
      }
      body.appendChild(entry);
    }
  }

  overlay.classList.add("visible");
}

function closeModal() {
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

async function initTerminal() {
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

  // Await token before connecting — prevents 1008 unauthorized on first load
  const token = await (window.HarnessApi ? window.HarnessApi.getToken() : Promise.resolve(window.HARNESS_TOKEN || ""));
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const terminalToken = encodeURIComponent(token || "");
  termWs = new WebSocket(`${protocol}//${location.host}/terminal?token=${terminalToken}`);

  let promptReady = false;
  let continueFailed = false;

  termWs.onopen = () => {
    termWs.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
  };

  termWs.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "output") {
      term.write(msg.data);

      // Detect "No conversation found to continue" → fallback to plain claude
      if (!continueFailed && msg.data.includes("No conversation found")) {
        continueFailed = true;
        setTimeout(() => {
          if (termWs.readyState === 1) {
            termWs.send(JSON.stringify({ type: "input", data: "claude\n" }));
          }
        }, 300);
      }

      // Auto-launch claude --continue after first shell prompt appears
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

  termWs.onclose = (ev) => {
    if (ev.code === 1008) {
      // Auth failed — token may not have loaded yet, retry once
      term.write("\r\n\x1b[33m[인증 재시도 중...]\x1b[0m\r\n");
      setTimeout(() => initTerminal(), 1500);
      return;
    }
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
  if (currentTemplateId !== "default") {
    loadPipelineTemplate("default");
  }
  document.getElementById("general-run-overlay").classList.add("visible");
  setTimeout(() => {
    const ti = document.getElementById("gr-task-input");
    if (ti) ti.focus();
  }, 50);
}

function closeGeneralRun() {
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
    if (abortBtn) abortBtn.classList.remove("is-hidden");
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

function closeFinalPlan() {
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
  meta.textContent = "";
  const verdictSpan = Object.assign(document.createElement("span"), { className: verdictClass, textContent: verdict });
  meta.appendChild(document.createTextNode("판정: "));
  meta.appendChild(verdictSpan);
  meta.appendChild(document.createTextNode(
    ` · 반복: ${data.iterations || 0}` +
    ` · 소요: ${Math.round((data.durationMs || 0) / 100) / 10}s` +
    ` · 최종 findings: C${counts.critical}/H${counts.high}/M${counts.medium}/L${counts.low}/N${counts.note}` +
    (data.reason ? ` · 이유: ${data.reason}` : "")
  ));
  text.textContent = data.finalPlan || "(플랜 없음)";
  overlay.classList.add("visible");
}

// ── Event Bindings (CSP-safe: no inline onclick) ──
function initEventBindings() {
  const _b = (sel, fn) => { const el = document.querySelector(sel); if (el) el.addEventListener("click", fn); };

  // Header
  _b("#btn-codex-verify", verifyCodex);
  _b("#btn-server-restart", restartServer);
  _b("#btn-server-stop", stopServer);

  // Pipeline controls
  _b("#pipeline-pill", cyclePipelineTemplate);
  _b("#btn-start-general", openGeneralRun);
  _b("#btn-abort-general", abortGeneralRun);
  _b("#btn-toggle-compact", toggleCompactMode);
  // Slice E (v4): open template editor modal
  _b("#btn-open-template-editor", () => {
    if (window.HarnessTemplateEditor) window.HarnessTemplateEditor.open();
  });
  // Slice E (v4): run history drawer. applyReplayEvent must be reachable from
  // the drawer's click handler — expose it on window explicitly so the test
  // harness and the drawer both use the same reducer.
  window.applyReplayEvent = applyReplayEvent;
  _b("#btn-open-run-history", () => {
    if (window.HarnessRunHistory) window.HarnessRunHistory.open();
  });
  // Slice F (v5): analytics panel — install handles the open/close button
  // wiring + backdrop + Escape key, so no separate _b binding is needed.
  if (window.HarnessAnalyticsPanel) {
    window.HarnessAnalyticsPanel.install({
      overlayId: "analytics-drawer",
      bodyId: "analytics-body",
      timelineId: "analytics-timeline",
      openBtnId: "btn-open-analytics",
      closeBtnId: "btn-analytics-close",
    });
  }

  // Slice H (v5): wrap every modal panel's open/close so a focus trap is
  // installed automatically. Monkey-patches each panel's methods so we
  // don't have to touch template-editor.js / run-history.js / analytics-
  // panel.js individually. Traps are released on close() so previously-
  // focused elements regain focus — standard modal a11y contract.
  function _installFocusTraps() {
    if (!window.HarnessFocusTrap) return;
    const wrap = (panel, overlayId) => {
      if (!panel || typeof panel.open !== "function") return;
      const origOpen = panel.open.bind(panel);
      const origClose = typeof panel.close === "function" ? panel.close.bind(panel) : null;
      let release = null;
      panel.open = async function (...args) {
        const result = await origOpen(...args);
        const el = document.getElementById(overlayId);
        if (el) {
          release = window.HarnessFocusTrap.trap(el, {
            onEscape: () => { if (origClose) origClose(); },
          });
        }
        return result;
      };
      if (origClose) {
        panel.close = function (...args) {
          if (release) { release(); release = null; }
          return origClose(...args);
        };
      }
    };
    wrap(window.HarnessTemplateEditor, "template-editor-overlay");
    wrap(window.HarnessRunHistory, "run-history-drawer");
    wrap(window.HarnessAnalyticsPanel, "analytics-drawer");
  }
  _installFocusTraps();

  // Slice H (v5): keyboard shortcuts. 'g t' → template editor, 'g h' →
  // history, 'g m' → metrics, '?' → tooltip hint. Escape is already
  // handled by each modal's onEscape trap, so we don't bind it here.
  if (window.HarnessKeybindings) {
    window.HarnessKeybindings.install({ doc: document });
    window.HarnessKeybindings.register({
      "g t": () => { if (window.HarnessTemplateEditor) window.HarnessTemplateEditor.open(); },
      "g h": () => { if (window.HarnessRunHistory) window.HarnessRunHistory.open(); },
      "g m": () => { if (window.HarnessAnalyticsPanel) window.HarnessAnalyticsPanel.open(); },
      "?": () => {
        if (window.HarnessToast) {
          const msg = window.HarnessI18n
            ? window.HarnessI18n.t("toast.keybindings")
            : "단축키: g t=템플릿, g h=히스토리, g m=메트릭, Esc=닫기";
          window.HarnessToast.show({ type: "info", message: msg, duration: 6000 });
        }
      },
    });
  }

  // Slice I (v5): translate static DOM content + wire language toggle.
  // ko/en tables are loaded from /js/i18n/{ko,en}.js before this script,
  // and HarnessI18n picks up the stored lang from localStorage.
  if (window.HarnessI18n) {
    const currentLang = window.HarnessI18n.getLang();
    document.documentElement.lang = currentLang;
    window.HarnessI18n.applyDom();
    // Reflect active language in the toolbar toggle.
    const langBtns = Array.from(document.querySelectorAll(".lang-btn"));
    function _refreshLangToggle() {
      const lang = window.HarnessI18n.getLang();
      for (const btn of langBtns) {
        btn.classList.toggle("is-active", btn.dataset.lang === lang);
        btn.setAttribute("aria-pressed", btn.dataset.lang === lang ? "true" : "false");
      }
    }
    for (const btn of langBtns) {
      btn.addEventListener("click", () => {
        window.HarnessI18n.setLang(btn.dataset.lang);
        _refreshLangToggle();
      });
    }
    _refreshLangToggle();
  }

  // Stats
  _b("#btn-clear-tool-feed", clearToolFeed);
  _b("#btn-clear-critique", clearCritiqueTimeline);
  _b("#btn-clear-log", clearLog);

  // Tabs
  _b("#tab-btn-log", () => switchTab("log"));
  _b("#tab-btn-terminal", () => switchTab("terminal"));

  // General run modal
  _b("#btn-gr-cancel", closeGeneralRun);
  _b("#btn-gr-start", submitGeneralRun);

  // Modal overlays: backdrop click → close, content → stopPropagation, X → close
  ["general-run-overlay", "final-plan-overlay", "modal-overlay"].forEach(id => {
    const overlay = document.getElementById(id);
    if (!overlay) return;
    const closeFn = id === "general-run-overlay" ? closeGeneralRun
                  : id === "final-plan-overlay" ? closeFinalPlan
                  : closeModal;
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeFn(); });
    const content = overlay.querySelector(".modal-content");
    if (content) content.addEventListener("click", (e) => e.stopPropagation());
    const closeBtn = overlay.querySelector(".modal-close");
    if (closeBtn) closeBtn.addEventListener("click", closeFn);
  });
}

// ── Init ──
initEventBindings();
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
// Init horse in idle state
_renderHorseSvg("idle");
