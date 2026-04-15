// P2-2 — Docs split: README + role header on each HARNESS-*.md
//
// Goal: the three existing harness docs serve distinct audiences, but
// the role distinction is buried inside 400–800 line files. This test
// enforces a minimal contract that keeps that distinction visible:
//
//   1. pipeline-dashboard/README.md exists and works as the one-page
//      entry point (install + run + test + doc map).
//   2. Each of the three HARNESS-*.md files declares an `Audience:`
//      line in its top-of-file metadata so a reader can decide in five
//      seconds whether they're in the right file.
//   3. README.md links to all three by filename and to npm scripts so
//      a new contributor can run `npm run setup && npm start` without
//      reading the 2000-line docs first.
//
// Run: node executor/__p2-2-test.js

const fs = require("fs");
const path = require("path");

const DASH = path.resolve(__dirname, "..");
const README = path.join(DASH, "README.md");

const DOCS = [
  {
    file: "HARNESS-ENGINEERING-GUIDE.md",
    audience: /Audience:\s*.*(newcomer|theory|개념|이론|신규)/i,
  },
  {
    file: "HARNESS-GUIDE.md",
    audience: /Audience:\s*.*(user|install|run|사용자|운영|실행)/i,
  },
  {
    file: "HARNESS-DESIGN.md",
    audience: /Audience:\s*.*(engineer|architect|implementation|구현|내부|엔지니어)/i,
  },
];

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ok  " + name);
  } catch (e) {
    failed++;
    console.error("  FAIL  " + name + "\n        " + (e.stack || e.message));
  }
}

console.log("[P2-2 docs split]");

test("README.md exists", () => {
  if (!fs.existsSync(README)) {
    throw new Error("pipeline-dashboard/README.md missing");
  }
});

test("README.md has install / run / test commands", () => {
  const txt = fs.readFileSync(README, "utf-8");
  for (const cmd of ["npm run setup", "npm start", "npm test"]) {
    if (!txt.includes(cmd)) {
      throw new Error("README missing command: " + cmd);
    }
  }
});

test("README.md links to all three HARNESS-*.md files", () => {
  const txt = fs.readFileSync(README, "utf-8");
  for (const { file } of DOCS) {
    if (!txt.includes(file)) {
      throw new Error("README missing link to " + file);
    }
  }
});

test("README.md documents key env vars", () => {
  const txt = fs.readFileSync(README, "utf-8");
  for (const v of ["HARNESS_PORT", "HARNESS_TOKEN", "HARNESS_WATCHER_MODE"]) {
    if (!txt.includes(v)) {
      throw new Error("README missing env var reference: " + v);
    }
  }
});

for (const { file, audience } of DOCS) {
  test(`${file} declares an Audience: header near the top`, () => {
    const p = path.join(DASH, file);
    if (!fs.existsSync(p)) {
      throw new Error(file + " missing");
    }
    const head = fs
      .readFileSync(p, "utf-8")
      .split("\n")
      .slice(0, 20)
      .join("\n");
    const line = head.split("\n").find((l) => /Audience:/.test(l));
    if (!line) {
      throw new Error(
        file +
          " has no 'Audience:' line in first 20 lines — readers can't tell what this doc is for"
      );
    }
    if (!audience.test(line)) {
      throw new Error(
        file + " audience line does not match expected role: " + JSON.stringify(line)
      );
    }
  });
}

test("README.md points at _workspace/ result convention", () => {
  const txt = fs.readFileSync(README, "utf-8");
  if (!txt.includes("_workspace")) {
    throw new Error("README should mention _workspace/ (Codex trigger result storage)");
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
