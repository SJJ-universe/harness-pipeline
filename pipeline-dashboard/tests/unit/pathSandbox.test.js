const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { resolveInsideRoot } = require("../../src/security/pathSandbox");

test("resolveInsideRoot resolves relative paths inside the root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-root-"));
  const file = path.join(root, "a.txt");
  fs.writeFileSync(file, "ok");

  assert.equal(resolveInsideRoot("a.txt", root, { mustExist: true }), fs.realpathSync.native(file));
});

test("resolveInsideRoot rejects traversal outside the root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-root-"));
  const outside = path.join(os.tmpdir(), "harness-outside.txt");
  fs.writeFileSync(outside, "nope");

  assert.throws(
    () => resolveInsideRoot(outside, root, { mustExist: true }),
    /escapes harness root/
  );
});
