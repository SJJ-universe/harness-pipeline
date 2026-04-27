#!/usr/bin/env node
//
// Slice MB5 (Phase D Round 2, 2026-04-27) — readiness-report.
//
// One-shot operator check that scores the harness against
// docs/readiness-rubric.md. Exit code maps to release-readiness:
//
//   0 — total ≥ 14 (release-ready)
//   1 — total ≥ 10 (preview-ready)
//   2 — total ≥ 6  (internal-only)
//   3 — total < 6  (blocking — do not ship)
//
// Usage:
//   node scripts/readiness-report.js                # human-readable
//   node scripts/readiness-report.js --json         # machine-readable
//   node scripts/readiness-report.js --no-spawn     # skip the server boot
//
// The server-spawning checks call out to the real harness on a
// throw-away port (5099 by default). Set HARNESS_PORT override before
// running if 5099 is taken.

const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

const PORT = Number(process.env.HARNESS_READINESS_PORT) || 5099;
const HOST = "127.0.0.1";
const SPAWN_TIMEOUT_MS = 4000;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);

// ── tiny http GET wrapper ────────────────────────────────────────────

function get(p) {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port: PORT, path: p, timeout: 1500 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf-8");
        let body = null; try { body = JSON.parse(text); } catch (_) {}
        resolve({ status: res.statusCode, body, text });
      });
    });
    req.on("error", () => resolve({ status: 0, body: null, text: "" }));
    req.on("timeout", () => { try { req.destroy(); } catch (_) {} resolve({ status: 0, body: null, text: "" }); });
  });
}

// ── score categories ────────────────────────────────────────────────

async function scoreRunVisibility() {
  const stars = [];
  const info = await get("/api/server/info");
  const boot = await get("/api/monitor/bootstrap");
  if (info.status === 200 && boot.status === 200) {
    stars.push("server/info + monitor/bootstrap respond 200");
    if (boot.body && Array.isArray(boot.body.runs) && typeof boot.body.selectedRunId !== "undefined") {
      stars.push("bootstrap carries runs + selectedRunId");
    }
    // Star 3: per-run detail endpoint resolves at least one run.
    if (boot.body && boot.body.runs && boot.body.runs.length > 0) {
      const detail = await get("/api/monitor/runs/" + encodeURIComponent(boot.body.runs[0].id));
      if (detail.status === 200) stars.push("monitor/runs/:runId returns detail");
    }
  }
  return { name: "run-visibility", stars };
}

async function scoreChildVisibility() {
  const stars = [];
  const info = await get("/api/server/info");
  if (info.status === 200 && Array.isArray(info.body && info.body.activeChildren)) {
    stars.push("server/info exposes activeChildren");
    // Star 2: monitor/bootstrap also has activeChildren.
    const boot = await get("/api/monitor/bootstrap");
    if (boot.status === 200 && Array.isArray(boot.body && boot.body.activeChildren)) {
      stars.push("monitor/bootstrap exposes activeChildren");
    }
    // Star 3: monitor/runs/:runId exposes subagents field for the default run.
    const detail = await get("/api/monitor/runs/default");
    if (detail.status === 200 && Array.isArray(detail.body && detail.body.subagents)) {
      stars.push("monitor/runs/default exposes subagents");
    }
  }
  return { name: "child-visibility", stars };
}

async function scoreReplayVisibility() {
  const stars = [];
  // Star 1: the buffer module exists + exports the contract.
  try {
    const erb = require("../src/runtime/eventReplayBuffer");
    if (typeof erb.createEventReplayBuffer === "function") stars.push("createEventReplayBuffer module exports the contract");
  } catch (_) {}
  // Star 2: monitor bootstrap recentEvents present.
  const boot = await get("/api/monitor/bootstrap");
  if (boot.status === 200 && Array.isArray(boot.body && boot.body.recentEvents)) {
    stars.push("monitor/bootstrap.recentEvents present");
  }
  // Star 3: store exposes pinnedEvents in fresh snapshot.
  try {
    const { createMonitorStore } = require("../public/js/monitor/store");
    const s = createMonitorStore();
    if (Array.isArray(s.snapshot().pinnedEvents)) stars.push("store.snapshot.pinnedEvents shape ready");
  } catch (_) {}
  return { name: "replay-visibility", stars };
}

async function scoreEventIntegrity() {
  const stars = [];
  // Star 1: normalizer module loads + exposes normalize.
  try {
    const { normalize } = require("../public/js/monitor/normalizer");
    if (typeof normalize === "function") stars.push("normalize() exported");
  } catch (_) {}
  // Star 2: legacy bridge module loads + exposes install.
  try {
    const lb = require("../public/js/monitor/legacy-bridge");
    if (typeof lb.install === "function") stars.push("legacy-bridge.install() exported");
  } catch (_) {}
  // Star 3: dispatcher tap surface present.
  try {
    const d = require("../public/js/event-dispatcher");
    if (typeof d.addTap === "function" && typeof d.notifyTaps === "function") {
      stars.push("event-dispatcher addTap/notifyTaps present");
    }
  } catch (_) {}
  return { name: "event-integrity", stars };
}

async function scoreContractStability() {
  const stars = [];
  // Star 1: monitor/bootstrap response shape stable (top-level keys present).
  const boot = await get("/api/monitor/bootstrap");
  if (boot.status === 200 && boot.body) {
    const required = ["server", "runs", "selectedRunId", "activeChildren", "recentEvents", "exportedAt"];
    const missing = required.filter((k) => !(k in boot.body));
    if (missing.length === 0) stars.push("monitor/bootstrap response shape stable");
  }
  // Star 2: legacy /api/runs/current shape unchanged (snapshot + events).
  const legacy = await get("/api/runs/current");
  if (legacy.status === 200 && legacy.body && legacy.body.snapshot && Array.isArray(legacy.body.events)) {
    stars.push("legacy /api/runs/current shape unchanged");
  }
  // Star 3: layout module exports `mount` + `panels` override hook.
  try {
    const layout = require("../public/js/monitor/layout");
    if (typeof layout.mount === "function") {
      stars.push("layout.mount exported (panels override surface present)");
    }
  } catch (_) {}
  return { name: "contract-stability", stars };
}

// ── server boot helper ──────────────────────────────────────────────

function bootHarness() {
  return new Promise((resolve, reject) => {
    const env = Object.assign({}, process.env, {
      HARNESS_PORT: String(PORT),
      HARNESS_CSP_MODE: "enforce",
    });
    const cwd = path.resolve(__dirname, "..");
    const proc = spawn(process.execPath, ["server.js"], {
      cwd, env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) { resolved = true; reject(new Error("server boot timed out")); }
    }, SPAWN_TIMEOUT_MS);
    proc.stdout.on("data", (chunk) => {
      const s = chunk.toString();
      if (!resolved && /Pipeline Dashboard:/.test(s)) {
        resolved = true;
        clearTimeout(timer);
        resolve(proc);
      }
    });
    proc.on("error", (err) => { if (!resolved) { resolved = true; reject(err); } });
    proc.on("exit", () => { if (!resolved) { resolved = true; reject(new Error("server exited before boot")); } });
  });
}

// ── main ────────────────────────────────────────────────────────────

async function main() {
  const json = flag("--json");
  const noSpawn = flag("--no-spawn");

  let proc = null;
  try {
    if (!noSpawn) {
      try {
        proc = await bootHarness();
      } catch (err) {
        if (!json) {
          process.stdout.write("WARN: failed to boot harness for live checks: " + err.message + "\n");
          process.stdout.write("      run with --no-spawn if you've started the harness yourself.\n");
        }
      }
    }

    const categories = [
      await scoreRunVisibility(),
      await scoreChildVisibility(),
      await scoreReplayVisibility(),
      await scoreEventIntegrity(),
      await scoreContractStability(),
    ];

    const total = categories.reduce((acc, c) => acc + c.stars.length, 0);
    const max = categories.length * 3;

    let exit = 3;
    if (total >= 14) exit = 0;
    else if (total >= 10) exit = 1;
    else if (total >= 6) exit = 2;

    if (json) {
      process.stdout.write(JSON.stringify({
        total, max, exit, categories,
      }, null, 2) + "\n");
    } else {
      process.stdout.write("=== Harness Readiness Report ===\n");
      for (const c of categories) {
        const s = c.stars.length;
        const stars = "★".repeat(s) + "·".repeat(3 - s);
        process.stdout.write("  " + (c.name + " ".repeat(20)).slice(0, 20) + " " + stars + "  (" + s + "/3)\n");
        for (const note of c.stars) process.stdout.write("    + " + note + "\n");
      }
      process.stdout.write("  ───────────────────────────────\n");
      process.stdout.write("  total                " + total + "/" + max + "\n");
      const verdict = exit === 0 ? "release-ready"
        : exit === 1 ? "preview-ready"
        : exit === 2 ? "internal-only"
        : "blocking";
      process.stdout.write("  → " + verdict + "\n");
    }

    return exit;
  } finally {
    if (proc) {
      try { proc.kill(); } catch (_) {}
    }
  }
}

main()
  .then((exit) => process.exit(exit))
  .catch((err) => {
    process.stderr.write("readiness-report error: " + (err && err.message) + "\n");
    process.exit(3);
  });
