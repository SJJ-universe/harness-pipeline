#!/usr/bin/env node
// P1-2 — Live verification runner.
//
// Runs every `executor/__*-live-verify.js` script. These scripts POST to
// a running dashboard on 127.0.0.1:4200 and will fail if the server isn't
// up. Invoke with `npm run test:live` after restarting the dashboard.
//
// Probes /api/version first so a down dashboard produces a clear error
// rather than burying the failure in each individual script.

const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const HOST = process.env.HARNESS_HOST || "127.0.0.1";
const PORT = Number(process.env.HARNESS_PORT || 4200);

function ping() {
  return new Promise((resolve) => {
    const req = http.request(
      { host: HOST, port: PORT, path: "/api/version", method: "GET", timeout: 2000 },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf-8") })
        );
      }
    );
    req.on("error", (err) => resolve({ status: 0, error: err.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 0, error: "timeout" });
    });
    req.end();
  });
}

function discover() {
  const dir = path.join(ROOT, "executor");
  return fs
    .readdirSync(dir)
    .filter((n) => /^__.*-live-verify\.js$/.test(n))
    .sort()
    .map((n) => path.join(dir, n));
}

function runOne(file) {
  const rel = path.relative(ROOT, file);
  process.stdout.write(`\n=== ${rel} ===\n`);
  const started = Date.now();
  const r = spawnSync(process.execPath, [file], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  return {
    file: rel,
    ok: r.status === 0,
    code: r.status,
    signal: r.signal || null,
    ms: Date.now() - started,
  };
}

(async function main() {
  const probe = await ping();
  if (probe.status !== 200) {
    console.error(
      `dashboard not reachable at http://${HOST}:${PORT}/api/version — ${
        probe.error || "status=" + probe.status
      }`
    );
    console.error("start the dashboard first: npm start");
    process.exit(2);
  }
  try {
    const info = JSON.parse(probe.body);
    console.log(`dashboard up: commit=${info.commitSha?.slice(0, 8)} pid=${info.pid}`);
  } catch (_) {
    console.log("dashboard up (version body not JSON)");
  }

  const files = discover();
  if (files.length === 0) {
    console.error("no live-verify scripts matched");
    process.exit(2);
  }
  console.log(`running ${files.length} live-verify script(s)`);
  const results = files.map(runOne);
  const failed = results.filter((r) => !r.ok);
  console.log("\n── Summary ──");
  for (const r of results) {
    const tag = r.ok ? "PASS" : "FAIL";
    const sig = r.signal ? ` signal=${r.signal}` : "";
    console.log(`  ${tag}  ${r.file}  (${r.ms}ms, exit=${r.code}${sig})`);
  }
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length > 0 ? 1 : 0);
})();
