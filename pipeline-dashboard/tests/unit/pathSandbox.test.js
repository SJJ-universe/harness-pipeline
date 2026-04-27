const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  resolveInsideRoot,
  isInsideRoot,
  normalizeRoot,
  PathSandboxError,
} = require("../../src/security/pathSandbox");

// ── happy path / containment ────────────────────────────────────────────

test("resolveInsideRoot resolves relative paths inside the root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-root-"));
  const file = path.join(root, "a.txt");
  fs.writeFileSync(file, "ok");

  assert.equal(resolveInsideRoot("a.txt", root, { mustExist: true }), fs.realpathSync.native(file));
});

test("resolveInsideRoot allows nested subdirectory paths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-root-"));
  const sub = path.join(root, "deep", "dir");
  fs.mkdirSync(sub, { recursive: true });
  const file = path.join(sub, "file.md");
  fs.writeFileSync(file, "x");
  const got = resolveInsideRoot("deep/dir/file.md", root, { mustExist: true });
  assert.equal(got, fs.realpathSync.native(file));
});

test("resolveInsideRoot allows the root itself", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-root-"));
  const got = resolveInsideRoot(".", root);
  assert.equal(got, fs.realpathSync.native(root));
});

// ── escape rejection ────────────────────────────────────────────────────

test("resolveInsideRoot rejects traversal outside the root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-root-"));
  const outside = path.join(os.tmpdir(), "harness-outside.txt");
  fs.writeFileSync(outside, "nope");
  assert.throws(
    () => resolveInsideRoot(outside, root, { mustExist: true }),
    /escapes harness root/
  );
});

test("resolveInsideRoot rejects ../ traversal even if file does not exist", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-root-"));
  // resolves to one level above root → outside
  assert.throws(
    () => resolveInsideRoot("../escape.txt", root),
    /PATH_OUTSIDE_ROOT|escapes harness root/
  );
});

test("resolveInsideRoot rejects deep ../../../ traversal", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-root-"));
  assert.throws(
    () => resolveInsideRoot("../../../etc/passwd", root),
    /escapes harness root/
  );
});

// ── input validation ────────────────────────────────────────────────────

test("resolveInsideRoot rejects empty / non-string input", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-root-"));
  assert.throws(() => resolveInsideRoot("", root), /BAD_PATH|non-empty string/);
  assert.throws(() => resolveInsideRoot(null, root), /BAD_PATH|non-empty string/);
  assert.throws(() => resolveInsideRoot(undefined, root), /BAD_PATH|non-empty string/);
  assert.throws(() => resolveInsideRoot(42, root), /BAD_PATH|non-empty string/);
});

test("normalizeRoot rejects empty / non-string root", () => {
  assert.throws(() => normalizeRoot(""), /BAD_ROOT|root must be a string/);
  assert.throws(() => normalizeRoot(null), /BAD_ROOT|root must be a string/);
  assert.throws(() => normalizeRoot(42), /BAD_ROOT|root must be a string/);
});

test("PathSandboxError is the error type with code attached", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-root-"));
  try {
    resolveInsideRoot("../escape", root);
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof PathSandboxError);
    assert.equal(err.name, "PathSandboxError");
    assert.equal(err.code, "PATH_OUTSIDE_ROOT");
  }
});

// ── mustExist semantics ─────────────────────────────────────────────────

test("mustExist=false allows future paths inside root (parent must exist)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-root-"));
  const got = resolveInsideRoot("not-yet-created.json", root);
  assert.equal(got, path.join(fs.realpathSync.native(root), "not-yet-created.json"));
});

test("mustExist=true throws PATH_NOT_FOUND when target is missing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-root-"));
  try {
    resolveInsideRoot("missing.txt", root, { mustExist: true });
    assert.fail("should have thrown");
  } catch (err) {
    assert.equal(err.code, "PATH_NOT_FOUND");
  }
});

// ── isInsideRoot wrapper ────────────────────────────────────────────────

test("isInsideRoot returns true / false instead of throwing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-root-"));
  fs.writeFileSync(path.join(root, "ok.txt"), "");
  assert.equal(isInsideRoot("ok.txt", root), true);
  assert.equal(isInsideRoot("../escape", root), false);
});

// ── symlink safety ──────────────────────────────────────────────────────

test("resolveInsideRoot follows a symlink that stays inside root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-root-"));
  const target = path.join(root, "target.txt");
  fs.writeFileSync(target, "ok");
  const link = path.join(root, "link.txt");
  try {
    fs.symlinkSync(target, link);
  } catch (err) {
    if (err && (err.code === "EPERM" || err.code === "ENOSYS")) {
      // Windows w/o developer mode — skip this case.
      return;
    }
    throw err;
  }
  const got = resolveInsideRoot("link.txt", root, { mustExist: true });
  assert.equal(got, fs.realpathSync.native(target));
});

test("resolveInsideRoot rejects a symlink that escapes via realpath", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-root-"));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-outside-"));
  const outsideFile = path.join(outsideDir, "secret.txt");
  fs.writeFileSync(outsideFile, "leaked");
  const link = path.join(root, "leak");
  try {
    fs.symlinkSync(outsideFile, link);
  } catch (err) {
    if (err && (err.code === "EPERM" || err.code === "ENOSYS")) return;
    throw err;
  }
  assert.throws(
    () => resolveInsideRoot("leak", root, { mustExist: true }),
    /escapes harness root/
  );
});

// ── Slice S2: Windows case-insensitive belt-and-suspenders ─────────────

test("Windows: assertInsideRoot accepts case-mismatched but identical path", () => {
  if (process.platform !== "win32") return; // POSIX is exact-case → skip
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-root-"));
  fs.writeFileSync(path.join(root, "x.txt"), "ok");
  // Same root, but lowercased — emulates a caller that resolved through a
  // different code path that lowercased the drive letter.
  const lowered = root.charAt(0).toLowerCase() + root.slice(1);
  // Going via path.join keeps the actual file lookup case-sensitive on
  // disk (NTFS is CI), but pathSandbox should still treat it as inside.
  assert.doesNotThrow(() => resolveInsideRoot("x.txt", lowered, { mustExist: true }));
});

// ── Slice S2: Phase 2.5 per-run checkpoint paths must pass ─────────────

test("per-run checkpoint paths (.harness/runs/{runId}/checkpoint.json) are inside root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-root-"));
  const runDir = path.join(root, ".harness", "runs", "session-abc");
  fs.mkdirSync(runDir, { recursive: true });
  const ckpt = path.join(runDir, "checkpoint.json");
  fs.writeFileSync(ckpt, "{}");
  const got = resolveInsideRoot(".harness/runs/session-abc/checkpoint.json", root, {
    mustExist: true,
  });
  assert.equal(got, fs.realpathSync.native(ckpt));
});
