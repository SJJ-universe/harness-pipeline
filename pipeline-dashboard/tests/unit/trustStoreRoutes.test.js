// Slice TRUST-STORE-0-c/f (Phase E Round 2, 2026-04-30) — trust store routes.
// Pins: list/add/update/delete + posture-aware 2-step delete + private-key
// rejection at request body level + audit emission for every code path.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const express = require("express");
const http = require("node:http");

const { createTrustStore } = require("../../src/runtime/trustStore");
const { createTrustStoreRoutes, ROUTE_AUDIT_VERBS } = require("../../src/routes/trustStoreRoutes");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "trust-routes-test-"));
}

function genKey() {
  const { publicKey } = crypto.generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" });
  return {
    der,
    b64: der.toString("base64"),
    keyId: crypto.createHash("sha256").update(der).digest("hex").slice(0, 16),
  };
}

// Stand up a tiny express app with the routes mounted; return base URL +
// audit log + close fn. Each test gets its own port and tmp dir.
async function makeServer({ posture, confirmTtlMs } = {}) {
  const dir = tmpDir();
  const auditLog = [];
  const trustStore = createTrustStore({
    filePath: path.join(dir, "ts.json"),
    ledger: {
      append(runId, entry) { auditLog.push({ runId, ...entry }); },
    },
  });
  const deploymentProfile = posture === "public-sector"
    ? { publicSector: true } : { publicSector: false };
  const app = express();
  app.use("/api", createTrustStoreRoutes({
    trustStore,
    audit(verb, data) { auditLog.push({ runId: "system", type: verb, data }); },
    deploymentProfile,
    confirmTtlMs: confirmTtlMs || undefined,
  }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  return {
    base: `http://127.0.0.1:${port}`,
    auditLog,
    trustStore,
    close: () => new Promise((r) => server.close(r)),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

async function jsonReq(url, opts = {}) {
  const res = await fetch(url, opts);
  let body = null;
  try { body = await res.json(); } catch (_) { /* defensive */ }
  return { status: res.status, body };
}

// ── GET /api/trust-store ───────────────────────────────────────────

test("trustStoreRoutes: GET /api/trust-store returns empty list initially", async () => {
  const srv = await makeServer({ posture: "standard" });
  try {
    const { status, body } = await jsonReq(`${srv.base}/api/trust-store`);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(body.keys, []);
    assert.equal(body.posture, "standard");
    assert.equal(body.requireSignedManifest, false);
    assert.equal(body.keyCount, 0);
  } finally {
    await srv.close(); srv.cleanup();
  }
});

test("trustStoreRoutes: GET reports public-sector posture + requireSignedManifest", async () => {
  const srv = await makeServer({ posture: "public-sector" });
  try {
    const { body } = await jsonReq(`${srv.base}/api/trust-store`);
    assert.equal(body.posture, "public-sector");
    assert.equal(body.requireSignedManifest, true);
  } finally {
    await srv.close(); srv.cleanup();
  }
});

// ── POST /api/trust-store/keys ─────────────────────────────────────

test("trustStoreRoutes: POST /keys 201 on valid public key", async () => {
  const srv = await makeServer({ posture: "standard" });
  try {
    const k = genKey();
    const { status, body } = await jsonReq(`${srv.base}/api/trust-store/keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKeyDerBase64: k.b64, label: "Release 2026" }),
    });
    assert.equal(status, 201);
    assert.equal(body.ok, true);
    assert.equal(body.key.keyId, k.keyId);
    assert.equal(body.key.label, "Release 2026");
    // List now contains the key
    const { body: listBody } = await jsonReq(`${srv.base}/api/trust-store`);
    assert.equal(listBody.keyCount, 1);
    // Audit chain has the runtime's add verb
    assert.ok(srv.auditLog.some((e) => e.type === "trust_store_key_added"));
  } finally {
    await srv.close(); srv.cleanup();
  }
});

test("trustStoreRoutes: POST /keys 409 on duplicate keyId", async () => {
  const srv = await makeServer({ posture: "standard" });
  try {
    const k = genKey();
    await jsonReq(`${srv.base}/api/trust-store/keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKeyDerBase64: k.b64 }),
    });
    const { status, body } = await jsonReq(`${srv.base}/api/trust-store/keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKeyDerBase64: k.b64 }),
    });
    assert.equal(status, 409);
    assert.equal(body.error, "duplicate_key_id");
    assert.equal(body.keyId, k.keyId);
  } finally {
    await srv.close(); srv.cleanup();
  }
});

test("trustStoreRoutes: POST /keys 400 on private-key marker (route-level)", async () => {
  const srv = await makeServer({ posture: "standard" });
  try {
    // The route-level body scan catches this BEFORE runtime add.
    // Even fields not named publicKeyDerBase64 are scanned.
    const { status, body } = await jsonReq(`${srv.base}/api/trust-store/keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        publicKeyDerBase64: "MCowBQ...",
        label: "-----BEGIN OPENSSH PRIVATE KEY-----",
      }),
    });
    assert.equal(status, 400);
    assert.equal(body.error, "private_key_rejected");
    // Defense-in-depth audit fires
    assert.ok(srv.auditLog.some((e) => e.type === "trust_store_private_key_rejected"));
  } finally {
    await srv.close(); srv.cleanup();
  }
});

test("trustStoreRoutes: POST /keys 400 on invalid public key", async () => {
  const srv = await makeServer({ posture: "standard" });
  try {
    const { status, body } = await jsonReq(`${srv.base}/api/trust-store/keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKeyDerBase64: "not-base64-or-correct-len" }),
    });
    assert.equal(status, 400);
    assert.equal(body.error, "invalid_public_key");
  } finally {
    await srv.close(); srv.cleanup();
  }
});

// ── PATCH /api/trust-store/keys/:keyId ─────────────────────────────

test("trustStoreRoutes: PATCH updates label (no key replacement)", async () => {
  const srv = await makeServer({ posture: "standard" });
  try {
    const k = genKey();
    await jsonReq(`${srv.base}/api/trust-store/keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKeyDerBase64: k.b64, label: "before" }),
    });
    const { status, body } = await jsonReq(
      `${srv.base}/api/trust-store/keys/${k.keyId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: "after" }),
      },
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.key.label, "after");
    assert.equal(body.key.keyId, k.keyId);
  } finally {
    await srv.close(); srv.cleanup();
  }
});

test("trustStoreRoutes: PATCH 404 on unknown keyId", async () => {
  const srv = await makeServer({ posture: "standard" });
  try {
    const { status, body } = await jsonReq(
      `${srv.base}/api/trust-store/keys/0000000000000000`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: "x" }),
      },
    );
    assert.equal(status, 404);
    assert.equal(body.error, "key_not_found");
  } finally {
    await srv.close(); srv.cleanup();
  }
});

// ── DELETE /api/trust-store/keys/:keyId — standard posture ─────────

test("trustStoreRoutes: DELETE standard posture removes immediately", async () => {
  const srv = await makeServer({ posture: "standard" });
  try {
    const k = genKey();
    await jsonReq(`${srv.base}/api/trust-store/keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKeyDerBase64: k.b64 }),
    });
    const { status, body } = await jsonReq(
      `${srv.base}/api/trust-store/keys/${k.keyId}`,
      { method: "DELETE" },
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.removed, k.keyId);
    // Runtime audit fired
    assert.ok(srv.auditLog.some((e) => e.type === "trust_store_key_removed"));
    // Key gone
    const { body: listBody } = await jsonReq(`${srv.base}/api/trust-store`);
    assert.equal(listBody.keyCount, 0);
  } finally {
    await srv.close(); srv.cleanup();
  }
});

test("trustStoreRoutes: DELETE 404 when keyId not in store", async () => {
  const srv = await makeServer({ posture: "standard" });
  try {
    const { status, body } = await jsonReq(
      `${srv.base}/api/trust-store/keys/0123456789abcdef`,
      { method: "DELETE" },
    );
    assert.equal(status, 404);
    assert.equal(body.error, "key_not_found");
  } finally {
    await srv.close(); srv.cleanup();
  }
});

// ── DELETE /api/trust-store/keys/:keyId — public-sector 2-step ─────

test("trustStoreRoutes: DELETE public-sector returns 409 + confirm token", async () => {
  const srv = await makeServer({ posture: "public-sector" });
  try {
    const k = genKey();
    await jsonReq(`${srv.base}/api/trust-store/keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKeyDerBase64: k.b64 }),
    });
    const { status, body } = await jsonReq(
      `${srv.base}/api/trust-store/keys/${k.keyId}`,
      { method: "DELETE" },
    );
    assert.equal(status, 409);
    assert.equal(body.error, "confirm_required");
    assert.match(body.confirmToken || "", /^[0-9a-f]{32}$/);
    assert.equal(body.keyId, k.keyId);
    // Key still in store — first step is non-destructive
    const { body: listBody } = await jsonReq(`${srv.base}/api/trust-store`);
    assert.equal(listBody.keyCount, 1);
    // delete_requested audit verb fires
    assert.ok(srv.auditLog.some((e) => e.type === ROUTE_AUDIT_VERBS.delete_requested));
  } finally {
    await srv.close(); srv.cleanup();
  }
});

test("trustStoreRoutes: POST /confirm with valid token actually deletes", async () => {
  const srv = await makeServer({ posture: "public-sector" });
  try {
    const k = genKey();
    await jsonReq(`${srv.base}/api/trust-store/keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKeyDerBase64: k.b64 }),
    });
    const { body: first } = await jsonReq(
      `${srv.base}/api/trust-store/keys/${k.keyId}`,
      { method: "DELETE" },
    );
    const { status, body } = await jsonReq(
      `${srv.base}/api/trust-store/keys/${k.keyId}/confirm`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmToken: first.confirmToken }),
      },
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.ok(srv.auditLog.some((e) => e.type === ROUTE_AUDIT_VERBS.delete_confirmed));
    // Key now gone
    const { body: listBody } = await jsonReq(`${srv.base}/api/trust-store`);
    assert.equal(listBody.keyCount, 0);
  } finally {
    await srv.close(); srv.cleanup();
  }
});

test("trustStoreRoutes: POST /confirm 400 on token mismatch", async () => {
  const srv = await makeServer({ posture: "public-sector" });
  try {
    const k1 = genKey();
    const k2 = genKey();
    await jsonReq(`${srv.base}/api/trust-store/keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKeyDerBase64: k1.b64 }),
    });
    await jsonReq(`${srv.base}/api/trust-store/keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKeyDerBase64: k2.b64 }),
    });
    // Get token for k1
    const { body: first } = await jsonReq(
      `${srv.base}/api/trust-store/keys/${k1.keyId}`,
      { method: "DELETE" },
    );
    // Try to delete k2 with k1's token
    const { status, body } = await jsonReq(
      `${srv.base}/api/trust-store/keys/${k2.keyId}/confirm`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmToken: first.confirmToken }),
      },
    );
    assert.equal(status, 400);
    assert.equal(body.error, "confirm_token_mismatch");
    // Token consumed (one-shot) — k1 also can't delete with it
    const { status: s2 } = await jsonReq(
      `${srv.base}/api/trust-store/keys/${k1.keyId}/confirm`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmToken: first.confirmToken }),
      },
    );
    assert.equal(s2, 400);
  } finally {
    await srv.close(); srv.cleanup();
  }
});

test("trustStoreRoutes: POST /confirm 400 on expired token", async () => {
  // 1ms TTL — by the time the second request fires, the token has lapsed.
  const srv = await makeServer({ posture: "public-sector", confirmTtlMs: 1 });
  try {
    const k = genKey();
    await jsonReq(`${srv.base}/api/trust-store/keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKeyDerBase64: k.b64 }),
    });
    const { body: first } = await jsonReq(
      `${srv.base}/api/trust-store/keys/${k.keyId}`,
      { method: "DELETE" },
    );
    await new Promise((r) => setTimeout(r, 30));
    const { status, body } = await jsonReq(
      `${srv.base}/api/trust-store/keys/${k.keyId}/confirm`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmToken: first.confirmToken }),
      },
    );
    assert.equal(status, 400);
    // Either invalid (gc'd) or expired — both are acceptable; the
    // operator-facing result is "token won't work, try again".
    assert.match(body.error, /confirm_token_(invalid|expired)/);
  } finally {
    await srv.close(); srv.cleanup();
  }
});

test("trustStoreRoutes: POST /confirm 405 in standard posture", async () => {
  const srv = await makeServer({ posture: "standard" });
  try {
    const { status, body } = await jsonReq(
      `${srv.base}/api/trust-store/keys/abc/confirm`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmToken: "anything" }),
      },
    );
    assert.equal(status, 405);
    assert.equal(body.error, "confirm_not_required");
  } finally {
    await srv.close(); srv.cleanup();
  }
});

test("trustStoreRoutes: POST /confirm 400 on missing token", async () => {
  const srv = await makeServer({ posture: "public-sector" });
  try {
    const { status, body } = await jsonReq(
      `${srv.base}/api/trust-store/keys/abc/confirm`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    assert.equal(status, 400);
    assert.equal(body.error, "confirm_token_missing");
  } finally {
    await srv.close(); srv.cleanup();
  }
});

// ── Stub fallback ───────────────────────────────────────────────────

test("trustStoreRoutes: 503 when trustStore is null (unwired)", async () => {
  const app = express();
  app.use("/api", createTrustStoreRoutes({ trustStore: null }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    const { status, body } = await jsonReq(`http://127.0.0.1:${port}/api/trust-store`);
    assert.equal(status, 503);
    assert.equal(body.error, "trust_store_not_wired");
  } finally {
    await new Promise((r) => server.close(r));
  }
});
