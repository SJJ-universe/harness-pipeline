// T0: Structural regression tests — these verify that demo code is removed
// and hook-driven infrastructure is properly wired.
// Initially some tests FAIL intentionally; they pass after T1/T2.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");

function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("Structural Removal — demo pipeline", () => {
  const serverSrc = readFile("server.js");
  const pipelineRoutesSrc = readFile("src/routes/pipelineRoutes.js");
  const appSrc = readFile("public/app.js");

  it("server.js should not contain runPipeline function (runGeneralPipeline is OK)", () => {
    // Match "function runPipeline" or "runPipeline(" but NOT "runGeneralPipeline"
    const lines = serverSrc.split("\n");
    const offending = lines.filter(
      (l) => /\brunPipeline\b/.test(l) && !/runGeneralPipeline/.test(l)
    );
    assert.equal(
      offending.length, 0,
      `Found ${offending.length} references to runPipeline (not runGeneralPipeline):\n${offending.join("\n")}`
    );
  });

  it("server.js should not broadcast token_update events", () => {
    assert.ok(
      !serverSrc.includes('"token_update"'),
      "server.js still contains token_update broadcast"
    );
  });

  it("pipelineRoutes.js should not have active /run handler (410 Gone is OK)", () => {
    // The route handler should NOT call runPipeline
    assert.ok(
      !pipelineRoutesSrc.includes("runPipeline"),
      "pipelineRoutes.js still references runPipeline"
    );
  });

  it("app.js should not define updateTokens function", () => {
    assert.ok(
      !appSrc.includes("function updateTokens"),
      "app.js still defines updateTokens()"
    );
  });
});

describe("Structural Removal — template contracts", () => {
  const templates = JSON.parse(readFile("pipeline-templates.json"));

  it("code-review template phases must all have agent field", () => {
    const cr = templates["code-review"];
    assert.ok(cr, "code-review template missing");
    for (const phase of cr.phases) {
      assert.ok(
        phase.agent,
        `code-review Phase ${phase.id} (${phase.name}) missing agent field`
      );
    }
  });

  it("code-review Phase A must not allow Bash", () => {
    const cr = templates["code-review"];
    const phaseA = cr.phases.find((p) => p.id === "A");
    assert.ok(phaseA, "Phase A not found");
    if (phaseA.allowedTools) {
      assert.ok(
        !phaseA.allowedTools.includes("Bash"),
        "Phase A should not allow Bash (planning stage)"
      );
    }
  });

  it("code-review Phase C must be codex cycle with linkedCycle", () => {
    const cr = templates["code-review"];
    const phaseC = cr.phases.find((p) => p.id === "C");
    assert.ok(phaseC, "Phase C not found");
    assert.equal(phaseC.agent, "codex", "Phase C agent should be codex");
    assert.ok(phaseC.cycle, "Phase C should have cycle: true");
    assert.ok(phaseC.maxIterations >= 1, "Phase C needs maxIterations >= 1");
    assert.ok(phaseC.linkedCycle, "Phase C needs linkedCycle");
  });

  it("code-review Phase D must be the linkedCycle target", () => {
    const cr = templates["code-review"];
    const phaseC = cr.phases.find((p) => p.id === "C");
    const phaseD = cr.phases.find((p) => p.id === "D");
    assert.ok(phaseD, "Phase D not found");
    assert.equal(
      phaseC.linkedCycle, phaseD.id,
      `Phase C linkedCycle (${phaseC.linkedCycle}) should point to Phase D (${phaseD.id})`
    );
  });

  it("code-review all phases must have exitCriteria", () => {
    const cr = templates["code-review"];
    for (const phase of cr.phases) {
      assert.ok(
        phase.exitCriteria && phase.exitCriteria.length > 0,
        `code-review Phase ${phase.id} missing exitCriteria`
      );
    }
  });

  it("default template Phase E must have files-edited exitCriteria", () => {
    const def = templates["default"];
    const phaseE = def.phases.find((p) => p.id === "E");
    assert.ok(phaseE, "default Phase E not found");
    assert.ok(
      phaseE.exitCriteria.some((c) => c.type === "files-edited"),
      "Phase E should have files-edited criterion"
    );
  });

  it("default template Phase F must have bash-ran and no-critical-findings", () => {
    const def = templates["default"];
    const phaseF = def.phases.find((p) => p.id === "F");
    assert.ok(phaseF, "default Phase F not found");
    assert.ok(
      phaseF.exitCriteria.some((c) => c.type === "bash-ran"),
      "Phase F should have bash-ran criterion"
    );
    assert.ok(
      phaseF.exitCriteria.some((c) => c.type === "no-critical-findings"),
      "Phase F should have no-critical-findings criterion"
    );
  });

  it("default template Phase G exists with codex agent and cycle to F", () => {
    const def = templates["default"];
    const phaseG = def.phases.find((p) => p.id === "G");
    assert.ok(phaseG, "default Phase G not found");
    assert.equal(phaseG.agent, "codex");
    assert.equal(phaseG.cycle, true);
    assert.equal(phaseG.linkedCycle, "F");
    assert.ok(
      phaseG.exitCriteria.some((c) => c.type === "critique-received"),
      "Phase G should have critique-received criterion"
    );
  });
});

describe("tool_blocked source field", () => {
  const executorSrc = readFile("executor/pipeline-executor.js");

  it("all tool_blocked broadcasts must include source field", () => {
    const lines = executorSrc.split("\n");
    // Find all lines that contain 'type: "tool_blocked"' and collect the
    // surrounding data object (next few lines until closing brace)
    const blocks = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('"tool_blocked"')) {
        // Collect up to 5 lines after to find the data object
        const block = lines.slice(i, i + 5).join("\n");
        blocks.push({ line: i + 1, block });
      }
    }
    assert.ok(blocks.length >= 4, `Expected at least 4 tool_blocked broadcasts, found ${blocks.length}`);
    for (const { line, block } of blocks) {
      assert.ok(
        block.includes("source:"),
        `tool_blocked at line ${line} missing source field:\n${block}`
      );
    }
  });
});

describe("Harness track animation structure", () => {
  const htmlSrc = readFile("public/index.html");
  const appSrc = readFile("public/app.js");

  it("index.html contains harness-track, horse-rider, harness-status elements", () => {
    assert.ok(htmlSrc.includes('id="harness-track"'), "harness-track missing");
    assert.ok(htmlSrc.includes('id="horse-rider"'), "horse-rider missing");
    assert.ok(htmlSrc.includes('id="harness-status"'), "harness-status missing");
  });

  it("index.html title is SJ Harness Engine", () => {
    assert.ok(htmlSrc.includes("<title>SJ Harness Engine</title>"), "title not updated");
  });

  it("index.html has pipeline-pill instead of select dropdown", () => {
    assert.ok(htmlSrc.includes('id="pipeline-pill"'), "pipeline-pill missing");
    assert.ok(!htmlSrc.includes('<select id="pipeline-select"'), "old select dropdown still present");
  });

  it("app.js defines setHorseState and _clearHorseTimer", () => {
    assert.ok(appSrc.includes("function setHorseState"), "setHorseState missing");
    assert.ok(appSrc.includes("function _clearHorseTimer"), "_clearHorseTimer missing");
    assert.ok(appSrc.includes("function reinThenResume"), "reinThenResume missing");
  });

  it("app.js calls setHorseState in pipeline_start and pipeline_complete handlers", () => {
    assert.ok(appSrc.includes('setHorseState("galloping"'), "galloping call missing");
    assert.ok(appSrc.includes('setHorseState("idle"'), "idle call missing");
    assert.ok(appSrc.includes('setHorseState("reining"'), "reining call missing");
  });
});
