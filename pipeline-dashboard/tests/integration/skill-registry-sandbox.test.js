// Slice S2 (Phase 3-S, 2026-04-27) — skill-registry getSkillContent guard.
//
// getSkillContent reads `~/.claude/skills/<id>/SKILL.md` from disk. Before
// this slice it relied on a manual `path.startsWith(root + sep)` check.
// We replaced that with `pathSandbox.resolveInsideRoot` so the same
// containment + symlink semantics used by /api/context/load apply here.
// These tests prove (a) legitimate slug ids resolve, (b) every traversal
// shape returns null without throwing, (c) symlink-out is rejected, and
// (d) source-level wiring stays consistent (regex still in place +
// pathSandbox imported).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Point HOME (POSIX) and USERPROFILE (Windows) at a temp dir BEFORE
// requiring the registry so SKILLS_DIR captures the test fixture path.
//
// IMPORTANT: SKILLS_DIR is computed at module load and Node's `node:test`
// shares the require cache across test files in one process. If an earlier
// test required skill-registry first, SKILLS_DIR is already locked to
// whatever HOME was then. We invalidate the cache slot before requiring so
// our env override takes effect deterministically.
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "harness-sk-home-"));
process.env.HOME = TMP_HOME;
process.env.USERPROFILE = TMP_HOME;
const SKILLS_DIR = path.join(TMP_HOME, ".claude", "skills");
fs.mkdirSync(SKILLS_DIR, { recursive: true });

// Seed valid skill fixtures.
function seed(id, body) {
  const dir = path.join(SKILLS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), body, "utf-8");
}
seed("good-one", "# good-one\nbody");
seed("dotted.id", "# dotted\nbody");
seed("under_score", "# u\nbody");

const skillRegistryPath = require.resolve("../../skill-registry");
delete require.cache[skillRegistryPath];
const { getSkillContent } = require(skillRegistryPath);

test("getSkillContent returns body for legitimate slug ids", () => {
  assert.match(getSkillContent("good-one"), /# good-one/);
  assert.match(getSkillContent("dotted.id"), /# dotted/);
  assert.match(getSkillContent("under_score"), /# u/);
});

test("getSkillContent returns null for unknown but well-formed id", () => {
  assert.equal(getSkillContent("nonexistent-skill"), null);
});

// ── traversal / path-significant chars rejected at the regex layer ─────

const REGEX_REJECTED = [
  "../etc",
  "..\\windows",
  "good-one/../bad",
  "good-one/SKILL.md",       // explicit subpath
  "good-one\\..",
  "../../../etc/passwd",
  "absolute/with/slash",
  "name with space",
  "name'quote",
  "name`bt",
  "name|pipe",
  "name\x00null",
  "",
];

for (const id of REGEX_REJECTED) {
  test(`getSkillContent rejects path-significant id at regex: ${JSON.stringify(id)}`, () => {
    assert.equal(getSkillContent(id), null);
  });
}

test("getSkillContent rejects non-string id", () => {
  assert.equal(getSkillContent(null), null);
  assert.equal(getSkillContent(undefined), null);
  assert.equal(getSkillContent(42), null);
  assert.equal(getSkillContent({}), null);
});

// ── pathSandbox layer: even if regex were bypassed, symlink-out fails ─

test("getSkillContent rejects a skill dir that is a symlink to outside SKILLS_DIR", () => {
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-outside-skills-"));
  const outsideSkill = path.join(outsideDir, "SKILL.md");
  fs.writeFileSync(outsideSkill, "# leaked", "utf-8");
  const linkedSkillDir = path.join(SKILLS_DIR, "leakto-outside");
  try {
    fs.symlinkSync(outsideDir, linkedSkillDir, "dir");
  } catch (err) {
    if (err && (err.code === "EPERM" || err.code === "ENOSYS")) return; // Win w/o devmode
    throw err;
  }
  // Regex passes ("leakto-outside" is alphanumeric) but pathSandbox should
  // resolve the realpath outside SKILLS_DIR and bounce it.
  const out = getSkillContent("leakto-outside");
  assert.equal(out, null, "symlink-resolved path outside SKILLS_DIR must be rejected");
});

// ── source-level regression anchors ─────────────────────────────────────

test("skill-registry.js imports pathSandbox + keeps the slug regex", () => {
  const SRC = fs.readFileSync(path.join(__dirname, "../../skill-registry.js"), "utf-8");
  assert.match(
    SRC,
    /require\(["']\.\/src\/security\/pathSandbox["']\)/,
    "must import pathSandbox via project-relative path"
  );
  assert.match(
    SRC,
    /resolveInsideRoot\s*\(/,
    "must call resolveInsideRoot inside getSkillContent"
  );
  assert.match(
    SRC,
    /\/\^\[a-zA-Z0-9\._-\]\+\$\//,
    "slug regex still required as the first defense layer"
  );
  assert.match(SRC, /Slice S2/, "carry the slice tag in the source for traceability");
});
