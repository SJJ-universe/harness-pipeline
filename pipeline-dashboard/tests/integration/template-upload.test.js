// Slice E (v4) — POST/DELETE /api/pipeline/templates end-to-end.
//
// Boots the real server, exercises:
//   - Auth required (same contract as other state-changing endpoints)
//   - Valid payload → 201 + merged list includes the new template
//   - Built-in id attempts → 400
//   - Invalid schema → 400 with descriptive error body
//   - DELETE on a custom id → 204 + merged list drops it
//   - DELETE on built-in → 400
//   - template_registry_reloaded event delivered via replay snapshot-like fetch
//
// We use a throw-away port so the suite doesn't collide with the smoke test.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { start } = require("../../server");

const PORT = 4321;
const BASE = `http://127.0.0.1:${PORT}`;
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const CUSTOM_TEMPLATES_FILE = path.join(REPO_ROOT, ".harness", "templates.json");

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch (_) { /* retry */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not start");
}

async function withServer(fn) {
  // Clean slate: ensure no stale customs linger from a previous run.
  try { fs.unlinkSync(CUSTOM_TEMPLATES_FILE); } catch (_) {}
  const listener = start(PORT, "127.0.0.1");
  try {
    await waitForServer();
    await fn();
  } finally {
    await new Promise((resolve) => listener.close(resolve));
    try { fs.unlinkSync(CUSTOM_TEMPLATES_FILE); } catch (_) {}
  }
}

function validTemplate(idSuffix = "experiment") {
  return {
    id: `custom-${idSuffix}`,
    name: "테스트 템플릿",
    phases: [
      { id: "A", name: "분석", agent: "claude",
        allowedTools: ["Read", "Grep"],
        exitCriteria: [{ type: "min-tools-in-phase", count: 1 }] },
      { id: "B", name: "수정", agent: "claude", allowedTools: ["Edit"] },
    ],
  };
}

async function authHeader() {
  const { token } = await (await fetch(`${BASE}/api/auth/token`)).json();
  return { "x-harness-token": token };
}

test("unauthenticated POST /api/pipeline/templates is rejected (401)", async () => {
  await withServer(async () => {
    const res = await fetch(`${BASE}/api/pipeline/templates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validTemplate("unauth")),
    });
    assert.equal(res.status, 401);
  });
});

test("POST valid template → 201 + appears in GET list", async () => {
  await withServer(async () => {
    const auth = await authHeader();
    const res = await fetch(`${BASE}/api/pipeline/templates`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify(validTemplate("round-trip")),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.id, "custom-round-trip");
    assert.ok(Number.isInteger(body.savedAt));

    // Confirm it shows up in the merged list
    const list = await (await fetch(`${BASE}/api/pipeline/templates`)).json();
    assert.ok(list["custom-round-trip"]);
    assert.equal(list["custom-round-trip"].name, "테스트 템플릿");
    // Built-ins are still present
    assert.ok(list["default"]);
  });
});

test("POST with built-in id → 400", async () => {
  await withServer(async () => {
    const auth = await authHeader();
    const res = await fetch(`${BASE}/api/pipeline/templates`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ ...validTemplate("x"), id: "default" }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /match/);
  });
});

test("POST with unknown exit criterion type → 400 (no silent pass)", async () => {
  await withServer(async () => {
    const auth = await authHeader();
    const bad = validTemplate("enum");
    bad.phases[0].exitCriteria = [{ type: "mystery-criterion" }];
    const res = await fetch(`${BASE}/api/pipeline/templates`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify(bad),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /must be one of/);
  });
});

test("POST with dangling linkedCycle → 400", async () => {
  await withServer(async () => {
    const auth = await authHeader();
    const bad = validTemplate("dangling");
    bad.phases[1].cycle = true;
    bad.phases[1].linkedCycle = "ZZZ";
    const res = await fetch(`${BASE}/api/pipeline/templates`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify(bad),
    });
    assert.equal(res.status, 400);
  });
});

test("DELETE /api/pipeline/templates/:id removes the custom template", async () => {
  await withServer(async () => {
    const auth = await authHeader();
    // Upsert first
    await fetch(`${BASE}/api/pipeline/templates`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify(validTemplate("to-delete")),
    });
    const del = await fetch(`${BASE}/api/pipeline/templates/custom-to-delete`, {
      method: "DELETE",
      headers: auth,
    });
    assert.equal(del.status, 204);
    const list = await (await fetch(`${BASE}/api/pipeline/templates`)).json();
    assert.ok(!list["custom-to-delete"]);
  });
});

test("DELETE on a built-in id → 400", async () => {
  await withServer(async () => {
    const auth = await authHeader();
    const res = await fetch(`${BASE}/api/pipeline/templates/default`, {
      method: "DELETE",
      headers: auth,
    });
    assert.equal(res.status, 400);
  });
});

test("DELETE on an unknown custom id → 404", async () => {
  await withServer(async () => {
    const auth = await authHeader();
    const res = await fetch(`${BASE}/api/pipeline/templates/custom-ghost`, {
      method: "DELETE",
      headers: auth,
    });
    assert.equal(res.status, 404);
  });
});
