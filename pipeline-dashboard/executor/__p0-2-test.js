// P0-2 unit tests — path-guard (resolveInside / isInside / realpathInside)
//
// Run: node executor/__p0-2-test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { isInside, resolveInside, realpathInside } = require("./path-guard");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ok  " + name);
  } catch (err) {
    failed++;
    console.error("  FAIL  " + name + "\n        " + err.message);
  }
}

function section(name) {
  console.log("\n[" + name + "]");
}

// Temp workspace we fully control
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p02-"));
fs.mkdirSync(path.join(tmpRoot, "safe"));
fs.mkdirSync(path.join(tmpRoot, "safe", "nested"));
fs.writeFileSync(path.join(tmpRoot, "safe", "allowed.md"), "ok");
fs.writeFileSync(path.join(tmpRoot, "safe", "nested", "deep.md"), "ok");

const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p02-outside-"));
fs.writeFileSync(path.join(outsideRoot, "secret.md"), "secret");

// ─── isInside ──────────────────────────────────────────────────────────
section("isInside");

test("root itself counted as inside", () => {
  assert.strictEqual(isInside(tmpRoot, tmpRoot), true);
});
test("direct child", () => {
  assert.strictEqual(isInside(tmpRoot, path.join(tmpRoot, "safe")), true);
});
test("nested descendant", () => {
  assert.strictEqual(
    isInside(tmpRoot, path.join(tmpRoot, "safe", "nested", "deep.md")),
    true
  );
});
test("parent not inside child", () => {
  assert.strictEqual(isInside(path.join(tmpRoot, "safe"), tmpRoot), false);
});
test("sibling tmpdir not inside", () => {
  assert.strictEqual(isInside(tmpRoot, outsideRoot), false);
});
test("..-traversal string not inside", () => {
  const traversal = path.join(tmpRoot, "safe", "..", "..", "etc");
  assert.strictEqual(isInside(tmpRoot, traversal), false);
});
test("prefix-confusion: /tmp/foo vs /tmp/foobar", () => {
  const a = path.join(tmpRoot, "safe");
  const b = path.join(tmpRoot, "safely"); // starts-with but different dir
  assert.strictEqual(isInside(a, b), false);
});

// ─── resolveInside ─────────────────────────────────────────────────────
section("resolveInside");

test("valid segment resolves", () => {
  const r = resolveInside(tmpRoot, "safe", "allowed.md");
  assert.strictEqual(r, path.resolve(tmpRoot, "safe", "allowed.md"));
});
test("`.` segment resolves to root", () => {
  const r = resolveInside(tmpRoot, ".");
  assert.strictEqual(r, path.resolve(tmpRoot));
});
test(".. traversal throws EPATHESCAPE", () => {
  try {
    resolveInside(tmpRoot, "..", "escape.txt");
    throw new Error("expected throw");
  } catch (e) {
    assert.strictEqual(e.code, "EPATHESCAPE");
  }
});
test("absolute segment outside root throws", () => {
  try {
    resolveInside(tmpRoot, outsideRoot);
    throw new Error("expected throw");
  } catch (e) {
    assert.strictEqual(e.code, "EPATHESCAPE");
  }
});
test("absolute segment inside root is fine", () => {
  const inner = path.join(tmpRoot, "safe", "allowed.md");
  const r = resolveInside(tmpRoot, inner);
  assert.strictEqual(r, inner);
});
test("multi-segment traversal throws", () => {
  try {
    resolveInside(tmpRoot, "safe", "..", "..", "outside");
    throw new Error("expected throw");
  } catch (e) {
    assert.strictEqual(e.code, "EPATHESCAPE");
  }
});

// ─── realpathInside ────────────────────────────────────────────────────
section("realpathInside");

test("existing file inside root returns its realpath", () => {
  const p = path.join(tmpRoot, "safe", "allowed.md");
  const r = realpathInside(tmpRoot, p);
  assert.ok(r && fs.existsSync(r), "realpath resolved and exists");
  assert.strictEqual(isInside(tmpRoot, r), true);
});
test("nonexistent file returns null (ENOENT swallowed)", () => {
  const r = realpathInside(tmpRoot, path.join(tmpRoot, "safe", "missing.md"));
  assert.strictEqual(r, null);
});
test("absolute path outside root throws EPATHESCAPE", () => {
  try {
    realpathInside(tmpRoot, path.join(outsideRoot, "secret.md"));
    throw new Error("expected throw");
  } catch (e) {
    assert.strictEqual(e.code, "EPATHESCAPE");
  }
});
test(".. traversal resolves and is rejected", () => {
  try {
    realpathInside(tmpRoot, path.join(tmpRoot, "safe", "..", "..", ".."));
    throw new Error("expected throw");
  } catch (e) {
    assert.strictEqual(e.code, "EPATHESCAPE");
  }
});

// Symlink escape — only runs where symlinks are actually allowed
// (Linux/Mac always; Windows needs admin or developer mode).
(function symlinkEscape() {
  let symlinkWorks = false;
  const linkPath = path.join(tmpRoot, "safe", "escape-link");
  try {
    fs.symlinkSync(outsideRoot, linkPath, "dir");
    symlinkWorks = true;
  } catch (_) {
    // symlink not permitted on this host — skip cleanly
  }
  if (!symlinkWorks) {
    console.log("  skip  symlink escape (not permitted on this host)");
    return;
  }
  test("symlink to outside root is rejected by realpathInside", () => {
    try {
      realpathInside(tmpRoot, path.join(linkPath, "secret.md"));
      throw new Error("expected throw");
    } catch (e) {
      assert.strictEqual(e.code, "EPATHESCAPE");
    }
  });
})();

// ─── Cleanup ───────────────────────────────────────────────────────────
fs.rmSync(tmpRoot, { recursive: true, force: true });
fs.rmSync(outsideRoot, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
