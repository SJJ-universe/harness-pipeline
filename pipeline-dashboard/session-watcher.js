const fs = require("fs");
const path = require("path");

const CLAUDE_DIR = path.join(process.env.HOME || process.env.USERPROFILE, ".claude");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");

// Task type detection patterns (Korean + English)
const TASK_PATTERNS = {
  "code-review": /리뷰|review|검토|코드\s*리뷰|code[\s-]*review|PR\s*리뷰/i,
  "testing": /테스트|test|jest|pytest|vitest|커버리지|coverage|spec\s*작성/i,
  "debugging": /디버그|debug|버그|bug|에러|error|fix|수정|고치|오류/i,
  "refactoring": /리팩토|refactor|개선|improve|clean[\s-]*up|정리/i,
  "planning": /계획|plan|설계|design|아키텍처|architecture/i,
  "implementation": /구현|implement|만들|생성|추가|add|create|feature|기능/i,
};

// Tool → phase mapping per template
const TOOL_PHASE_MAP = {
  "default": [
    { phase: "A", node: "context-analyzer", tools: ["Read", "Glob", "Grep"], label: "context" },
    { phase: "B", node: "task-planner", tools: ["TodoWrite", "EnterPlanMode"], label: "planning" },
    { phase: "C", node: "plan-critic", tools: [], label: "critique" },       // Codex only
    { phase: "D", node: "plan-refiner", tools: [], label: "refine" },        // cycle
    { phase: "E", node: "executor", tools: ["Edit", "Write", "Bash"], label: "execution" },
    { phase: "F", node: "validator", tools: [], label: "validation" },
  ],
  "code-review": [
    { phase: "A", node: "claude-plan", tools: ["Read", "Glob", "Grep"], label: "planning" },
    { phase: "B", node: "claude-code", tools: ["Edit", "Write"], label: "implementation" },
    { phase: "C", node: "orchestrator", tools: ["Agent"], label: "review" },
    { phase: "D", node: "debug", tools: ["Bash"], label: "debug" },
  ],
  "testing": [
    { phase: "A", node: "coverage-analyzer", tools: ["Read", "Glob", "Grep"], label: "analysis" },
    { phase: "B", node: "test-planner", tools: ["TodoWrite", "EnterPlanMode"], label: "planning" },
    { phase: "C", node: "test-critic", tools: [], label: "critique" },
    { phase: "D", node: "test-writer", tools: ["Edit", "Write"], label: "writing" },
    { phase: "E", node: "test-runner", tools: ["Bash"], label: "execution" },
  ],
};

// Refined phase progression based on tool sequence
const TOOL_CATEGORIES = {
  context: ["Read", "Glob", "Grep", "Explore"],
  planning: ["TodoWrite", "EnterPlanMode"],
  execution: ["Edit", "Write"],
  validation: ["Bash"],
  delegation: ["Agent"],
};

class SessionWatcher {
  constructor(broadcastFn, workspacePath) {
    this.broadcast = broadcastFn;
    this.workspacePath = workspacePath;
    this.sessionFile = null;
    this.fileWatcher = null;
    this.dirWatcher = null;
    this.lastSize = 0;
    this.currentTemplate = null;
    this.currentPhase = null;
    this.currentPhaseIndex = -1;
    this.pipelineActive = false;
    this.toolHistory = [];
    this.idleTimer = null;
    this.IDLE_MS = 60000; // 60s idle = task likely done
    this.lastUserMessage = "";
    this.projectDir = null;
    this.checkInterval = null;
  }

  start() {
    if (this.checkInterval) return;
    this.projectDir = this._findProjectDir();
    if (!this.projectDir) {
      console.log("[SessionWatcher] Project dir not found, will retry...");
    }

    // Initialize lastSize to current file size so we only watch NEW records
    const currentFile = this._findLatestSessionFile();
    if (currentFile) {
      this.sessionFile = currentFile;
      try {
        this.lastSize = fs.statSync(currentFile).size;
      } catch (_) {
        this.lastSize = 0;
      }
      console.log(`[SessionWatcher] Tracking: ${path.basename(currentFile)} (skipping ${this.lastSize} existing bytes)`);
    }

    // Poll for session file changes every 2 seconds
    // (more reliable than fs.watch on Windows for appended files)
    this.checkInterval = setInterval(() => this._checkForChanges(), 2000);

    // Also watch directory for new session files
    this._watchDirectory();

    console.log("[SessionWatcher] Started watching for session activity");
  }

  stop() {
    if (this.checkInterval) clearInterval(this.checkInterval);
    if (this.dirWatcher) this.dirWatcher.close();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.checkInterval = null;
    this.dirWatcher = null;
    this.idleTimer = null;
    console.log("[SessionWatcher] Stopped");
  }

  _findProjectDir() {
    try {
      const absPath = path.resolve(this.workspacePath);
      const dirs = fs.readdirSync(PROJECTS_DIR);
      const normalized = absPath
        .replace(/:[\\\/]/g, "--")   // C:\ → C--
        .replace(/:/g, "--")         // remaining colons
        .replace(/[\\/]/g, "-")      // remaining separators
        .replace(/^-+/, "");         // strip leading dashes

      const exact = dirs.find((d) => d === normalized);
      if (exact) return path.join(PROJECTS_DIR, exact);

      const normalizedLower = normalized.toLowerCase();
      const match = dirs.find((d) => {
        const dl = d.toLowerCase();
        return dl === normalizedLower || normalizedLower.includes(dl) || dl.includes(normalizedLower);
      });
      if (match) return path.join(PROJECTS_DIR, match);
    } catch (_) {}
    return null;
  }

  _findLatestSessionFile() {
    if (!this.projectDir) {
      this.projectDir = this._findProjectDir();
      if (!this.projectDir) return null;
    }
    try {
      const files = fs.readdirSync(this.projectDir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => ({
          name: f,
          path: path.join(this.projectDir, f),
          mtime: fs.statSync(path.join(this.projectDir, f)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime);
      return files.length > 0 ? files[0].path : null;
    } catch (_) {
      return null;
    }
  }

  _watchDirectory() {
    if (!this.projectDir) return;
    try {
      this.dirWatcher = fs.watch(this.projectDir, (eventType, filename) => {
        if (filename && filename.endsWith(".jsonl")) {
          // New session file may have appeared
          const latest = this._findLatestSessionFile();
          if (latest && latest !== this.sessionFile) {
            this.sessionFile = latest;
            this.lastSize = 0;
            console.log(`[SessionWatcher] New session: ${path.basename(latest)}`);
          }
        }
      });
    } catch (_) {}
  }

  _checkForChanges() {
    const latest = this._findLatestSessionFile();
    if (!latest) return;

    if (latest !== this.sessionFile) {
      this.sessionFile = latest;
      this.lastSize = 0;
    }

    try {
      const stat = fs.statSync(this.sessionFile);
      if (stat.size <= this.lastSize) return;

      // Read new content
      const newContent = Buffer.alloc(stat.size - this.lastSize);
      const fd = fs.openSync(this.sessionFile, "r");
      fs.readSync(fd, newContent, 0, newContent.length, this.lastSize);
      fs.closeSync(fd);

      this.lastSize = stat.size;

      const newLines = newContent.toString("utf-8").split("\n").filter(Boolean);
      for (const line of newLines) {
        try {
          const record = JSON.parse(line);
          this._processRecord(record);
        } catch (_) {
          // skip malformed lines
        }
      }
    } catch (_) {}
  }

  _processRecord(record) {
    const type = record.type;
    const msg = record.message || {};

    if (type === "user") {
      this._handleUserMessage(msg);
    } else if (type === "assistant") {
      this._handleAssistantMessage(msg);
    }

    // Reset idle timer on any activity
    this._resetIdleTimer();
  }

  _handleUserMessage(msg) {
    const content = msg.content;
    let text = "";

    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      // Extract text blocks (skip tool_result blocks)
      const textBlocks = content.filter((b) => b.type === "text");
      text = textBlocks.map((b) => b.text || "").join(" ");
    }

    // Skip empty messages or tool results
    if (!text.trim() || text.includes("tool_result")) return;
    // Skip hook feedback / system messages
    if (text.includes("Stop hook feedback") || text.includes("system-reminder")) return;

    this.lastUserMessage = text.trim();

    // Detect task type
    const taskType = this._detectTaskType(text);
    if (taskType && !this.pipelineActive) {
      this._startAutoPipeline(taskType, text);
    }
  }

  _handleAssistantMessage(msg) {
    if (!this.pipelineActive) return;

    const content = msg.content || [];
    if (!Array.isArray(content)) return;

    for (const block of content) {
      if (block.type === "tool_use") {
        this._handleToolUse(block.name, block.input);
      }
    }

    // If stop_reason is "end_turn", the assistant finished responding
    if (msg.stop_reason === "end_turn") {
      this._onAssistantTurnEnd();
    }
  }

  _detectTaskType(text) {
    for (const [type, pattern] of Object.entries(TASK_PATTERNS)) {
      if (pattern.test(text)) return type;
    }
    // Default to "default" template for unrecognized tasks
    // Only trigger if it looks like a real task (not just a question/greeting)
    if (text.length > 10 && /[해줘세요하세요만들어주세요implement|create|build|write|make]/i.test(text)) {
      return "default";
    }
    return null;
  }

  _startAutoPipeline(taskType, userMessage) {
    // Map task type to pipeline template
    const templateMap = {
      "code-review": "code-review",
      "testing": "testing",
      "debugging": "default",
      "refactoring": "default",
      "planning": "default",
      "implementation": "default",
      "default": "default",
    };

    this.currentTemplate = templateMap[taskType] || "default";
    this.currentPhaseIndex = -1;
    this.currentPhase = null;
    this.toolHistory = [];
    this.pipelineActive = true;

    // Broadcast pipeline detection event
    this.broadcast({
      type: "auto_pipeline_detect",
      data: {
        templateId: this.currentTemplate,
        taskType,
        reason: this._getTaskReason(taskType, userMessage),
      },
    });

    // Start Phase A
    this._advancePhase();

    console.log(`[SessionWatcher] Auto-pipeline: ${this.currentTemplate} (${taskType})`);
  }

  _getTaskReason(taskType, message) {
    const reasons = {
      "code-review": "코드 리뷰 작업 감지",
      "testing": "테스트 작업 감지",
      "debugging": "디버깅 작업 감지",
      "refactoring": "리팩토링 작업 감지",
      "planning": "설계/계획 작업 감지",
      "implementation": "구현 작업 감지",
      "default": "일반 작업 감지",
    };
    return reasons[taskType] || "작업 감지";
  }

  _handleToolUse(toolName, toolInput) {
    if (!this.pipelineActive || !this.currentTemplate) return;

    this.toolHistory.push(toolName);

    // Determine which category this tool belongs to
    let category = null;
    for (const [cat, tools] of Object.entries(TOOL_CATEGORIES)) {
      if (tools.includes(toolName)) {
        category = cat;
        break;
      }
    }
    if (!category) return;

    const phaseMap = TOOL_PHASE_MAP[this.currentTemplate];
    if (!phaseMap) return;

    // Find the best phase for this tool
    // Priority: advance forward if tool matches a later phase
    for (let i = 0; i < phaseMap.length; i++) {
      const pm = phaseMap[i];
      if (pm.tools.includes(toolName) && i >= this.currentPhaseIndex) {
        if (i > this.currentPhaseIndex) {
          // Advance to new phase
          this._advanceTo(i);
        }
        // Update node status
        this.broadcast({
          type: "node_update",
          data: { node: pm.node, status: "active" },
        });
        break;
      }
    }
  }

  _advancePhase() {
    const phaseMap = TOOL_PHASE_MAP[this.currentTemplate];
    if (!phaseMap) return;

    const nextIndex = this.currentPhaseIndex + 1;
    if (nextIndex >= phaseMap.length) return;

    this._advanceTo(nextIndex);
  }

  _advanceTo(index) {
    const phaseMap = TOOL_PHASE_MAP[this.currentTemplate];
    if (!phaseMap || index >= phaseMap.length) return;

    // Complete current phase
    if (this.currentPhaseIndex >= 0 && this.currentPhaseIndex < phaseMap.length) {
      const prev = phaseMap[this.currentPhaseIndex];
      this.broadcast({
        type: "node_update",
        data: { node: prev.node, status: "completed" },
      });
      this.broadcast({
        type: "phase_update",
        data: { phase: prev.phase, status: "completed" },
      });
    }

    // Start new phase
    this.currentPhaseIndex = index;
    const current = phaseMap[index];
    this.currentPhase = current.phase;

    this.broadcast({
      type: "phase_update",
      data: { phase: current.phase, status: "active" },
    });
    this.broadcast({
      type: "node_update",
      data: { node: current.node, status: "active" },
    });
  }

  _onAssistantTurnEnd() {
    // When the assistant completes a turn, check if we should advance
    // This catches cases where the tool pattern doesn't clearly map
    const phaseMap = TOOL_PHASE_MAP[this.currentTemplate];
    if (!phaseMap || this.currentPhaseIndex < 0) return;

    // If we have a significant number of execution tools, advance from context→execution
    const recentTools = this.toolHistory.slice(-5);
    const execCount = recentTools.filter((t) => ["Edit", "Write"].includes(t)).length;
    const readCount = recentTools.filter((t) => ["Read", "Glob", "Grep"].includes(t)).length;

    if (execCount > readCount && this.currentPhaseIndex < phaseMap.length - 2) {
      // Find execution phase
      const execPhaseIdx = phaseMap.findIndex((p) => p.label === "execution" || p.label === "writing");
      if (execPhaseIdx > this.currentPhaseIndex) {
        this._advanceTo(execPhaseIdx);
      }
    }
  }

  _resetIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this._onIdle(), this.IDLE_MS);
  }

  _onIdle() {
    if (!this.pipelineActive) return;

    // Complete the pipeline
    const phaseMap = TOOL_PHASE_MAP[this.currentTemplate];
    if (phaseMap && this.currentPhaseIndex >= 0) {
      // Complete current phase
      const current = phaseMap[this.currentPhaseIndex];
      this.broadcast({
        type: "node_update",
        data: { node: current.node, status: "completed" },
      });
      this.broadcast({
        type: "phase_update",
        data: { phase: current.phase, status: "completed" },
      });
    }

    this.broadcast({
      type: "pipeline_complete",
      data: {
        harnessId: this.currentTemplate,
        auto: true,
        toolsUsed: [...new Set(this.toolHistory)],
      },
    });

    this.pipelineActive = false;
    this.currentPhaseIndex = -1;
    this.currentPhase = null;
    this.toolHistory = [];

    console.log("[SessionWatcher] Pipeline auto-completed (idle timeout)");
  }

  // Allow manual pipeline completion from API
  completePipeline() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this._onIdle();
  }

  getStatus() {
    return {
      active: this.pipelineActive,
      template: this.currentTemplate,
      phase: this.currentPhase,
      phaseIndex: this.currentPhaseIndex,
      toolHistory: this.toolHistory.slice(-20),
      sessionFile: this.sessionFile ? path.basename(this.sessionFile) : null,
      lastUserMessage: this.lastUserMessage.slice(0, 100),
    };
  }
}

module.exports = { SessionWatcher };
