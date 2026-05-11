// Slice D0-a (Phase E1 productization, 2026-04-28) — launcherManifest tests.
//
// Pins the schema contract that the orchestrator-start launcher depends on.
// A careless future loosening (e.g. accepting http:// URLs, mixed-case
// hex) would degrade the trust posture without the test failing — these
// tests catch it.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const {
  REQUIRED_FIELDS,
  VERSION_RE,
  SHA256_HEX_LEN,
  validateManifestSchema,
  sha256OfFile,
  timingSafeHexEqual,
  verifySha256,
  compareSemver,
  checkRuntimeVersion,
} = require("../../src/runtime/launcherManifest");

const VALID_MANIFEST = Object.freeze({
  version: "1.1.0",
  publishedAt: "2026-05-15T09:00:00Z",
  url: "https://github.com/SJJ-universe/orchestrator-pipeline/releases/download/v1.1.0/orchestrator-pipeline-1.1.0.zip",
  sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  minNodeVersion: "24.0.0",
});

// ── schema validation ─────────────────────────────────────────────

test("D0-a: validateManifestSchema accepts a well-formed manifest", () => {
  const r = validateManifestSchema(VALID_MANIFEST);
  assert.equal(r.ok, true);
  assert.deepEqual(r.manifest, VALID_MANIFEST);
});

test("D0-a: validateManifestSchema rejects non-object input", () => {
  for (const bad of [null, undefined, "string", 123, []]) {
    const r = validateManifestSchema(bad);
    assert.equal(r.ok, false);
    assert.match(r.errors[0], /not a JSON object/);
  }
});

test("D0-a: validateManifestSchema reports every missing required field at once", () => {
  const r = validateManifestSchema({});
  assert.equal(r.ok, false);
  // Every REQUIRED_FIELDS entry should appear in errors.
  for (const f of REQUIRED_FIELDS) {
    assert.ok(
      r.errors.some((e) => e.includes(`"${f}"`)),
      `expected error for missing field ${f}`,
    );
  }
});

test("D0-a: validateManifestSchema rejects http:// URL (https mandatory)", () => {
  const m = { ...VALID_MANIFEST, url: "http://example.com/release.zip" };
  const r = validateManifestSchema(m);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /https:\/\//.test(e)));
});

// TRUST-STORE-E2E-EVIDENCE follow-up (2026-05-05): the same env that
// relaxes the fetch-URL validation also relaxes the manifest BODY's
// url field check. Without the env set, the strict https:// rule
// applies (covered above). With the env set, file:// / http:// URLs
// in the manifest body are accepted. Production posture (env unset)
// MUST keep rejecting.

test("TRUST-STORE-E2E-EVIDENCE: ORCHESTRATOR_ALLOW_INSECURE_MANIFEST_URL=1 relaxes manifest-body url check", () => {
  const original = process.env.ORCHESTRATOR_ALLOW_INSECURE_MANIFEST_URL;
  try {
    process.env.ORCHESTRATOR_ALLOW_INSECURE_MANIFEST_URL = "1";
    const m = { ...VALID_MANIFEST, url: "file:///C:/tmp/release.zip" };
    const r = validateManifestSchema(m);
    assert.equal(r.ok, true,
      "with env=1 the file:// URL is acceptable (operator opted in)");
    // ok: true responses don't carry an `errors` field — that's only
    // present on rejection. Assert the rejection-side shape isn't
    // there (catches a future regression where ok=true yet errors
    // are still attached).
    assert.equal(r.errors, undefined,
      "ok:true response must not carry an errors[] array");
    assert.ok(r.manifest, "ok:true response must include the validated manifest");
  } finally {
    if (original === undefined) {
      delete process.env.ORCHESTRATOR_ALLOW_INSECURE_MANIFEST_URL;
    } else {
      process.env.ORCHESTRATOR_ALLOW_INSECURE_MANIFEST_URL = original;
    }
  }
});

test("TRUST-STORE-E2E-EVIDENCE: env unset or != '1' keeps file:// rejected (production posture)", () => {
  const original = process.env.ORCHESTRATOR_ALLOW_INSECURE_MANIFEST_URL;
  try {
    delete process.env.ORCHESTRATOR_ALLOW_INSECURE_MANIFEST_URL;
    const m = { ...VALID_MANIFEST, url: "file:///C:/tmp/release.zip" };
    const r = validateManifestSchema(m);
    assert.equal(r.ok, false,
      "without env the file:// URL must still be rejected");
    assert.ok(r.errors.some((e) => /https:\/\//.test(e)));

    // Even an explicit "0" value must NOT relax — the env contract
    // is "1 = relax", anything else = strict.
    process.env.ORCHESTRATOR_ALLOW_INSECURE_MANIFEST_URL = "0";
    const r2 = validateManifestSchema(m);
    assert.equal(r2.ok, false,
      "env='0' must keep strict mode (only '1' relaxes)");
  } finally {
    if (original === undefined) {
      delete process.env.ORCHESTRATOR_ALLOW_INSECURE_MANIFEST_URL;
    } else {
      process.env.ORCHESTRATOR_ALLOW_INSECURE_MANIFEST_URL = original;
    }
  }
});

test("D0-a: validateManifestSchema rejects wrong sha256 length", () => {
  const m = { ...VALID_MANIFEST, sha256: "abc123" }; // too short
  const r = validateManifestSchema(m);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /sha256.*hex/.test(e)));
});

test("D0-a: validateManifestSchema rejects mixed-case sha256", () => {
  // Force an uppercase-A in there. The validator rejects mixed-case to
  // keep comparison logic dead-simple (no toLowerCase race conditions).
  const sha = "0123456789ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef";
  const m = { ...VALID_MANIFEST, sha256: sha };
  const r = validateManifestSchema(m);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /lowercase hex/.test(e)));
});

test("D0-a: validateManifestSchema rejects malformed semver in version", () => {
  const m = { ...VALID_MANIFEST, version: "1.x" };
  const r = validateManifestSchema(m);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /semver/.test(e)));
});

test("D0-a: validateManifestSchema accepts pre-release semver (1.2.3-rc.1)", () => {
  const m = { ...VALID_MANIFEST, version: "1.2.3-rc.1" };
  const r = validateManifestSchema(m);
  assert.equal(r.ok, true);
});

test("D0-a: validateManifestSchema rejects unparseable publishedAt", () => {
  const m = { ...VALID_MANIFEST, publishedAt: "definitely-not-a-date" };
  const r = validateManifestSchema(m);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /publishedAt/.test(e)));
});

test("D0-a: REQUIRED_FIELDS list is the documented set (regression guard)", () => {
  // If someone adds a field to validate without updating REQUIRED_FIELDS,
  // the launcher won't enforce it. Pin the contract.
  assert.deepEqual(
    [...REQUIRED_FIELDS].sort(),
    ["version", "url", "sha256", "publishedAt", "minNodeVersion"].sort(),
  );
});

// ── SHA256 helpers ────────────────────────────────────────────────

test("D0-a: sha256OfFile produces the canonical lowercase-hex digest", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-test-"));
  try {
    const f = path.join(dir, "fixture.bin");
    const content = Buffer.from("the quick brown fox jumps over the lazy dog");
    fs.writeFileSync(f, content);
    const actual = sha256OfFile(f);
    const expected = crypto.createHash("sha256").update(content).digest("hex");
    assert.equal(actual, expected);
    assert.equal(actual.length, SHA256_HEX_LEN);
    assert.match(actual, /^[0-9a-f]+$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("D0-a: sha256OfFile handles large files in 64KB chunks (no OOM)", () => {
  // Synthesize a multi-MB file to exercise the streaming loop. The
  // launcher will hash ~70MB release zips so the chunked path matters.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-test-"));
  try {
    const f = path.join(dir, "big.bin");
    const chunk = Buffer.alloc(256 * 1024, "X"); // 256KB
    const fd = fs.openSync(f, "w");
    for (let i = 0; i < 8; i += 1) fs.writeSync(fd, chunk); // 2MB total
    fs.closeSync(fd);
    const actual = sha256OfFile(f);
    assert.equal(actual.length, SHA256_HEX_LEN);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("D0-a: timingSafeHexEqual matches identical hex of equal length", () => {
  const a = "abcdef1234567890";
  assert.equal(timingSafeHexEqual(a, a), true);
});

test("D0-a: timingSafeHexEqual rejects mismatched hex", () => {
  assert.equal(timingSafeHexEqual("aaaa", "bbbb"), false);
});

test("D0-a: timingSafeHexEqual rejects unequal-length inputs", () => {
  assert.equal(timingSafeHexEqual("ab", "abcd"), false);
});

test("D0-a: timingSafeHexEqual rejects non-string / null", () => {
  assert.equal(timingSafeHexEqual(null, null), false);
  assert.equal(timingSafeHexEqual("ab", undefined), false);
  assert.equal(timingSafeHexEqual(123, "ab"), false);
});

test("D0-a: verifySha256 returns ok=true for matching file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-test-"));
  try {
    const f = path.join(dir, "match.bin");
    fs.writeFileSync(f, "hello");
    const expected = crypto.createHash("sha256").update("hello").digest("hex");
    const r = verifySha256(f, expected);
    assert.equal(r.ok, true);
    assert.equal(r.actual, expected);
    assert.equal(r.expected, expected);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("D0-a: verifySha256 returns ok=false + both digests on mismatch", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-test-"));
  try {
    const f = path.join(dir, "mismatch.bin");
    fs.writeFileSync(f, "hello");
    const wrong = "0".repeat(SHA256_HEX_LEN);
    const r = verifySha256(f, wrong);
    assert.equal(r.ok, false);
    assert.notEqual(r.actual, r.expected);
    assert.equal(r.expected, wrong);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("D0-a: verifySha256 normalizes uppercase expected to lowercase before compare", () => {
  // Defense in depth — though manifest validation rejects uppercase,
  // the verify helper itself should still match if a caller passes
  // uppercase by accident.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-test-"));
  try {
    const f = path.join(dir, "case.bin");
    fs.writeFileSync(f, "case-test");
    const expected = crypto.createHash("sha256").update("case-test").digest("hex").toUpperCase();
    const r = verifySha256(f, expected);
    assert.equal(r.ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── semver compare ────────────────────────────────────────────────

test("D0-a: compareSemver orders major / minor / patch correctly", () => {
  assert.equal(compareSemver("1.0.0", "2.0.0"), -1);
  assert.equal(compareSemver("2.0.0", "1.0.0"), 1);
  assert.equal(compareSemver("1.2.0", "1.3.0"), -1);
  assert.equal(compareSemver("1.2.5", "1.2.4"), 1);
  assert.equal(compareSemver("1.2.3", "1.2.3"), 0);
});

test("D0-a: compareSemver treats pre-release as smaller than release", () => {
  // Conservative: 1.2.3-rc.1 < 1.2.3 (release wins). Matches semver spec
  // intent for our minNodeVersion check.
  assert.equal(compareSemver("1.2.3-rc.1", "1.2.3"), -1);
  assert.equal(compareSemver("1.2.3", "1.2.3-rc.1"), 1);
});

test("D0-a: compareSemver rejects non-semver inputs", () => {
  assert.throws(() => compareSemver("1.x", "1.0.0"), /invalid/);
  assert.throws(() => compareSemver("1.0.0", "abc"), /invalid/);
  assert.throws(() => compareSemver(null, "1.0.0"), /requires/);
});

test("D0-a: checkRuntimeVersion accepts v-prefixed runtime version (Node convention)", () => {
  const r = checkRuntimeVersion("v24.0.1", VALID_MANIFEST);
  assert.equal(r.ok, true);
});

test("D0-a: checkRuntimeVersion rejects below minNodeVersion", () => {
  const r = checkRuntimeVersion("v22.0.0", VALID_MANIFEST);
  assert.equal(r.ok, false);
  assert.match(r.reason, /22\.0\.0.*24\.0\.0/);
});

test("D0-a: checkRuntimeVersion rejects malformed runtime version", () => {
  const r = checkRuntimeVersion("definitely-not-a-version", VALID_MANIFEST);
  assert.equal(r.ok, false);
});

test("D0-a: checkRuntimeVersion accepts equal version (boundary)", () => {
  const r = checkRuntimeVersion("v24.0.0", VALID_MANIFEST);
  assert.equal(r.ok, true);
});

// ── manifest example file matches schema ─────────────────────────

test("D0-a: scripts/launcher/manifest.json.example passes validateManifestSchema", () => {
  // The shipped example is the operator's reference. If it ever drifts
  // out of sync with the schema, an operator who copies it would get
  // confusing runtime errors. Anchor.
  const examplePath = path.resolve(__dirname, "../../scripts/launcher/manifest.json.example");
  const raw = JSON.parse(fs.readFileSync(examplePath, "utf-8"));
  // Strip the _comment field — it's documentation, not part of the
  // schema. Shipped manifests can include it for human readers.
  const { _comment, ...rest } = raw;
  const r = validateManifestSchema(rest);
  assert.equal(r.ok, true, `manifest.json.example validation errors: ${JSON.stringify(r.errors)}`);
});
