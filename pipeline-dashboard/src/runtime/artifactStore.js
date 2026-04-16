// ArtifactStore — stores and retrieves named artifacts per run.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function shortHash(content) {
  return crypto.createHash("sha256").update(String(content)).digest("hex").slice(0, 8);
}

class ArtifactStore {
  constructor({ rootDir }) {
    this.rootDir = rootDir;
  }

  store(runId, artifactKey, content) {
    const dir = path.join(this.rootDir, runId, "artifacts");
    fs.mkdirSync(dir, { recursive: true });
    const hash = shortHash(content);
    const safeName = String(artifactKey).replace(/[^a-z0-9_-]/gi, "_");
    const filePath = path.join(dir, `${safeName}-${hash}`);
    fs.writeFileSync(filePath, String(content), "utf-8");
    return { path: filePath, hash, size: Buffer.byteLength(String(content)) };
  }

  retrieve(runId, artifactKey) {
    const dir = path.join(this.rootDir, runId, "artifacts");
    if (!fs.existsSync(dir)) return null;
    const safeName = String(artifactKey).replace(/[^a-z0-9_-]/gi, "_");
    try {
      const files = fs.readdirSync(dir).filter((f) => f.startsWith(safeName + "-"));
      if (files.length === 0) return null;
      // Return latest (by filename sort — includes hash, not timestamp)
      const latest = files.sort().pop();
      return fs.readFileSync(path.join(dir, latest), "utf-8");
    } catch (_) {
      return null;
    }
  }
}

module.exports = { ArtifactStore };
