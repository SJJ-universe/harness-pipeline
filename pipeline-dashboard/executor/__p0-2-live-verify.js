// P0-2 live verification — sandbox enforcement on the running dashboard.
// Targets a dashboard at 127.0.0.1:4200 and confirms that traversal
// attempts against /api/context/load, /api/context/discover, and
// /api/skills/:id are blocked, while legitimate in-sandbox requests succeed.
//
// Run: node executor/__p0-2-live-verify.js

const http = require("http");

const HOST = "127.0.0.1";
const PORT = 4200;

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        host: HOST,
        port: PORT,
        path,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(data),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: HOST, port: PORT, path, method: "GET" },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString("utf-8"),
          })
        );
      }
    );
    req.on("error", reject);
    req.end();
  });
}

(async () => {
  const fails = [];
  const osRoot = process.platform === "win32" ? "C:/Users/SJ/.ssh/id_rsa" : "/etc/passwd";

  // ── 1: /api/context/load blocks absolute path outside workspace ──
  {
    const r = await post("/api/context/load", { filePath: osRoot });
    console.log(`[1] load outside-workspace → status=${r.status}`);
    if (r.status !== 403 && r.status !== 404) {
      fails.push(`[1] expected 403/404 for ${osRoot}, got ${r.status} body=${r.body}`);
    }
    if (r.status === 200) {
      fails.push(`[1] FATAL: arbitrary file read returned 200`);
    }
  }

  // ── 2: /api/context/load blocks ..-traversal escape ──
  {
    const r = await post("/api/context/load", {
      filePath: "C:/Users/SJ/workspace/pipeline-dashboard/../../.ssh/id_rsa",
    });
    console.log(`[2] load traversal → status=${r.status}`);
    if (r.status !== 403 && r.status !== 404) {
      fails.push(`[2] expected 403/404, got ${r.status}`);
    }
  }

  // ── 3: /api/context/load allows in-workspace file ──
  {
    const r = await post("/api/context/load", {
      filePath: "C:/Users/SJ/workspace/pipeline-dashboard/package.json",
    });
    console.log(`[3] load in-workspace package.json → status=${r.status}`);
    if (r.status !== 200) {
      fails.push(`[3] in-workspace file should load, got ${r.status} body=${r.body.slice(0, 120)}`);
    } else if (!/pipeline-dashboard/.test(r.body)) {
      fails.push(`[3] response body missing expected marker: ${r.body.slice(0, 120)}`);
    }
  }

  // ── 4: /api/context/discover blocks projectRoot outside workspace ──
  {
    const r = await post("/api/context/discover", { projectRoot: "C:/Users/SJ" });
    console.log(`[4] discover outside-workspace → status=${r.status}`);
    if (r.status !== 403) {
      fails.push(`[4] expected 403, got ${r.status} body=${r.body.slice(0, 120)}`);
    }
  }

  // ── 5: /api/context/discover allows default (workspace root) ──
  {
    const r = await post("/api/context/discover", {});
    console.log(`[5] discover default → status=${r.status}`);
    if (r.status !== 200) {
      fails.push(`[5] default discover should work, got ${r.status}`);
    }
  }

  // ── 6: /api/skills/:id rejects traversal via skillId ──
  {
    const r = await get("/api/skills/" + encodeURIComponent("../../etc/passwd"));
    console.log(`[6] skills traversal → status=${r.status}`);
    if (r.status !== 404) {
      fails.push(`[6] expected 404 (silent reject), got ${r.status} body=${r.body.slice(0, 120)}`);
    }
  }

  // ── 7: /api/skills/:id legitimate skill works ──
  {
    const r = await get("/api/skills/" + encodeURIComponent("adversarial-reviewer"));
    console.log(`[7] skills legit id → status=${r.status}`);
    if (r.status !== 200) {
      fails.push(`[7] legit skill should load, got ${r.status}`);
    }
  }

  if (fails.length === 0) {
    console.log("\nALL PASS — sandbox enforced on /api/context/* and /api/skills/:id");
    process.exit(0);
  } else {
    console.error("\nFAIL:");
    for (const f of fails) console.error("  - " + f);
    process.exit(1);
  }
})().catch((err) => {
  console.error("live-verify error:", err);
  process.exit(2);
});
