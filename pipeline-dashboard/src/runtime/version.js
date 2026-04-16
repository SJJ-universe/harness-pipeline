const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function sha256(value) {
  return crypto.createHash("sha256").update(value || "").digest("hex");
}

function fileHash(filePath) {
  try {
    return sha256(fs.readFileSync(filePath));
  } catch (_) {
    return null;
  }
}

function gitSha(repoRoot) {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (_) {
    return "unknown";
  }
}

function createVersionInfo({ repoRoot, appRoot, bootTime, mode = "local" }) {
  const templatePath = path.join(appRoot, "pipeline-templates.json");
  // Policy hash: prefer JSON policy file, fall back to JS source files
  const policyJsonPath = path.join(appRoot, "policies", "default-policy.json");
  let policyHash;
  if (fs.existsSync(policyJsonPath)) {
    policyHash = fileHash(policyJsonPath);
  } else {
    const policyFiles = [
      path.join(appRoot, "src", "policy", "phasePolicy.js"),
      path.join(appRoot, "src", "policy", "dangerGate.js"),
    ];
    policyHash = sha256(policyFiles.map((p) => fileHash(p) || "").join(":"));
  }
  return {
    gitSha: gitSha(repoRoot),
    bootTime,
    nodeVersion: process.version,
    templateHash: fileHash(templatePath),
    policyHash,
    repoRoot,
    mode,
  };
}

module.exports = {
  createVersionInfo,
  fileHash,
  gitSha,
};
