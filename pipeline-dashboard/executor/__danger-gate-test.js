// T9 verification harness — danger-gate module (tool-scoped isDangerous)
//
// Run: node executor/__danger-gate-test.js
//
// rev2 M8 failing-first: this file runs BEFORE danger-gate.js exists.

const assert = require("assert");

let mod;
try {
  mod = require("./danger-gate");
} catch (e) {
  console.error("danger-gate module not found — EXPECTED on failing-first run");
  console.error(e.message);
  process.exit(1);
}
const { isDangerous } = mod;

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err: err.message });
    console.error(`FAIL  ${name}`);
    console.error(`      ${err.message}`);
  }
}

// ── V-T9-1 POSITIVE: these must all return a non-null danger reason ──

test("V-T9-1a: rm -rf / → blocked", () => {
  assert.ok(isDangerous("Bash", { command: "rm -rf /" }));
});
test("V-T9-1b: rm -fr tmp → blocked (flag order doesn't matter)", () => {
  assert.ok(isDangerous("Bash", { command: "rm -fr tmp" }));
});
test("V-T9-1c: rm -Rf dir → blocked", () => {
  assert.ok(isDangerous("Bash", { command: "rm -Rf dir" }));
});
test("V-T9-1d: git push --force-with-lease → blocked", () => {
  assert.ok(isDangerous("Bash", { command: "git push origin main --force-with-lease" }));
});
test("V-T9-1e: git push -f → blocked", () => {
  assert.ok(isDangerous("Bash", { command: "git push origin main -f" }));
});
test("V-T9-1f: git push --force → blocked", () => {
  assert.ok(isDangerous("Bash", { command: "git push --force origin main" }));
});
test("V-T9-1g: git reset --hard HEAD → blocked", () => {
  assert.ok(isDangerous("Bash", { command: "git reset --hard HEAD" }));
});
test("V-T9-1h: Remove-Item -Recurse . → blocked (PowerShell)", () => {
  assert.ok(isDangerous("Bash", { command: "Remove-Item -Recurse ." }));
});
test("V-T9-1i: Write .env → blocked", () => {
  assert.ok(isDangerous("Write", { file_path: "/some/dir/.env" }));
});
test("V-T9-1j: Edit .env.local → blocked", () => {
  assert.ok(isDangerous("Edit", { file_path: "apps/web/.env.local" }));
});
test("V-T9-1k: Write credentials.json → blocked", () => {
  assert.ok(isDangerous("Write", { file_path: "secrets/credentials.json" }));
});

// ── V-T9-2 NEGATIVE: these must all return null ──

test("V-T9-2a: git reset HEAD~1 → allowed (not --hard)", () => {
  assert.strictEqual(isDangerous("Bash", { command: "git reset HEAD~1" }), null);
});
test("V-T9-2b: git status → allowed", () => {
  assert.strictEqual(isDangerous("Bash", { command: "git status" }), null);
});
test("V-T9-2c: rm file.tmp (no flags) → allowed", () => {
  assert.strictEqual(isDangerous("Bash", { command: "rm file.tmp" }), null);
});
test("V-T9-2d: rm -f single.txt → allowed (no recursive)", () => {
  assert.strictEqual(isDangerous("Bash", { command: "rm -f single.txt" }), null);
});
test("V-T9-2e: Edit .claude/agents/foo.md → allowed (harness self-tuning)", () => {
  assert.strictEqual(isDangerous("Edit", { file_path: ".claude/agents/foo.md" }), null);
});
test("V-T9-2f: Write .claude/skills/bar/SKILL.md → allowed", () => {
  assert.strictEqual(isDangerous("Write", { file_path: ".claude/skills/bar/SKILL.md" }), null);
});
test("V-T9-2g: Read .env → allowed (Read tool, not Write/Edit)", () => {
  assert.strictEqual(isDangerous("Read", { file_path: ".env" }), null);
});
test("V-T9-2h: Bash on .env → allowed (not Write/Edit scope)", () => {
  assert.strictEqual(isDangerous("Bash", { command: "cat .env" }), null);
});
test("V-T9-2i: git push origin main → allowed (no --force)", () => {
  assert.strictEqual(isDangerous("Bash", { command: "git push origin main" }), null);
});
test("V-T9-2j: Remove-Item single.txt → allowed (no -Recurse)", () => {
  assert.strictEqual(isDangerous("Bash", { command: "Remove-Item single.txt" }), null);
});
test("V-T9-2k: Write .env.example → allowed (template, no secrets)", () => {
  assert.strictEqual(isDangerous("Write", { file_path: "pipeline-dashboard/.env.example" }), null);
});
test("V-T9-2l: Write .env.sample → allowed", () => {
  assert.strictEqual(isDangerous("Write", { file_path: ".env.sample" }), null);
});
test("V-T9-2m: Write .env.template → allowed", () => {
  assert.strictEqual(isDangerous("Edit", { file_path: "apps/.env.template" }), null);
});
test("V-T9-2n: Write .env.production → STILL blocked (not a template)", () => {
  assert.ok(isDangerous("Write", { file_path: ".env.production" }));
});

// ── Defensive: unknown tool, empty input, etc. ──

test("V-T9-3a: unknown tool → null", () => {
  assert.strictEqual(isDangerous("Glob", { pattern: "*.js" }), null);
});
test("V-T9-3b: missing input → null (no throw)", () => {
  assert.strictEqual(isDangerous("Bash", undefined), null);
});
test("V-T9-3c: empty command → null", () => {
  assert.strictEqual(isDangerous("Bash", { command: "" }), null);
});
test("V-T9-3d: isDangerous returns reason STRING on match (for logging)", () => {
  const r = isDangerous("Bash", { command: "rm -rf /" });
  assert.strictEqual(typeof r, "string");
  assert.ok(r.length > 0);
});

const failed = results.filter((r) => !r.ok).length;
const total = results.length;
console.log(`\n${total - failed}/${total} passed`);
process.exit(failed === 0 ? 0 : 1);
