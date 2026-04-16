const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

class RunRegistry {
  constructor({ rootDir }) {
    this.rootDir = rootDir || path.join(process.cwd(), "runs");
    this.runs = new Map();
  }

  start({ kind, input = {}, policyDecision = null } = {}) {
    const runId = `${kind || "run"}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const manifest = {
      runId,
      kind: kind || "run",
      startedAt: new Date().toISOString(),
      completedAt: null,
      durationMs: null,
      inputHash: hash(JSON.stringify(input)),
      policyDecision,
      events: [],
      exitCode: null,
      ok: null,
    };
    this.runs.set(runId, manifest);
    this._persist(manifest);
    return runId;
  }

  append(runId, event) {
    const manifest = this.runs.get(runId);
    if (!manifest) return null;
    manifest.events.push({ at: new Date().toISOString(), ...event });
    this._persist(manifest);
    return manifest;
  }

  complete(runId, result = {}) {
    const manifest = this.runs.get(runId);
    if (!manifest) return null;
    manifest.completedAt = new Date().toISOString();
    manifest.durationMs = Date.parse(manifest.completedAt) - Date.parse(manifest.startedAt);
    manifest.exitCode = result.exitCode ?? null;
    manifest.ok = !!result.ok;
    if (result.stdout) manifest.stdoutHash = hash(result.stdout);
    if (result.stderr) manifest.stderrHash = hash(result.stderr);
    this._persist(manifest);
    return manifest;
  }

  get(runId) {
    return this.runs.get(runId) || null;
  }

  _persist(manifest) {
    const dir = path.join(this.rootDir, manifest.runId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
  }
}

module.exports = { RunRegistry, hash };
