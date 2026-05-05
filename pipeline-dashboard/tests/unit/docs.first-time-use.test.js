// Slice END-USER-DEPLOY-POLISH (Phase 2 v2 follow-up, 2026-05-05) —
// structural test for docs/runbooks/first-time-use.md (Korean-primary
// first-time-use guide for non-technical end users) + bilingual
// surface verification on harness-start.bat.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RUNBOOK = path.resolve(REPO_ROOT, "docs", "runbooks", "first-time-use.md");
const BAT = path.resolve(REPO_ROOT, "harness-start.bat");

function read(p) { return fs.readFileSync(p, "utf-8"); }

// ── Runbook file invariants ─────────────────────────────────

test("END-USER-DEPLOY-POLISH: first-time-use.md exists + non-empty", () => {
  assert.ok(fs.existsSync(RUNBOOK));
  const s = fs.statSync(RUNBOOK);
  assert.ok(s.size > 4000,
    `expected ≥ 4000 bytes, got ${s.size}`);
});

test("END-USER-DEPLOY-POLISH: H1 includes Korean + English", () => {
  const text = read(RUNBOOK);
  assert.match(text, /^# Runbook — 처음 사용 안내 \(First-Time Use Guide\)/m,
    "H1 must include Korean primary + English subtitle");
});

test("END-USER-DEPLOY-POLISH: tagged with slice END-USER-DEPLOY-POLISH", () => {
  assert.match(read(RUNBOOK),
    /Slice END-USER-DEPLOY-POLISH \(Phase 2 v2 follow-up, 2026-05-05\)/);
});

// ── Required sections ───────────────────────────────────────

const SECTIONS = [
  ["§1", "이 도구가 무엇인가요"],
  ["§2", "설치 전 필요한 것"],
  ["§3", "처음 실행"],
  ["§4", "화면이 열리지 않을 때"],
  ["§5", "Claude / Codex 연결하기"],
  ["§6", "첫 작업 시작하기"],
  ["§7", "안전장치 이해하기"],
  ["§8", "도움이 필요할 때"],
  ["§9", "다음 단계"],
  ["§10", "References"],
];

for (const [num, name] of SECTIONS) {
  test(`END-USER-DEPLOY-POLISH: ${num} section "${name}" present`, () => {
    const text = read(RUNBOOK);
    const re = new RegExp(`## ${num} ${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`);
    assert.match(text, re,
      `${num} ${name} must exist`);
  });
}

// ── Korean-primary content invariants ───────────────────────

test("END-USER-DEPLOY-POLISH: §1 explains in Korean what the tool is", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("## §1");
  const seg = text.slice(idx, text.indexOf("## §2", idx));
  // Must contain the core Korean explanation phrase
  assert.match(seg, /AI 코딩 도구를 안전하게 감독하는 대시보드/,
    "§1 must give the one-sentence Korean explanation");
  // Must clarify Harness is NOT a replacement for Claude/Codex
  assert.match(seg, /대체하지 않습니다/);
});

test("END-USER-DEPLOY-POLISH: §2 lists prerequisites with Korean labels", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("## §2");
  const seg = text.slice(idx, text.indexOf("## §3", idx));
  assert.match(seg, /Node\.js 24/);
  assert.match(seg, /필수/);
  assert.match(seg, /권장/);
  // Crucial: the password-not-asked clarification must be here.
  // The text appears inside a blockquote that may wrap, so allow
  // whitespace AND blockquote-continuation markers between words.
  assert.match(seg, /비밀번호를 받지[\s>]+않습니다/,
    "§2 must clarify that Harness does not collect provider passwords");
});

test("END-USER-DEPLOY-POLISH: §3 walks through extract → double-click → browser", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("## §3");
  const seg = text.slice(idx, text.indexOf("## §4", idx));
  assert.match(seg, /더블클릭/, "§3 must mention 더블클릭 (double-click)");
  assert.match(seg, /harness-start\.bat/, "§3 must name the launcher");
  assert.match(seg, /127\.0\.0\.1:4201/, "§3 must show the dashboard URL");
});

test("END-USER-DEPLOY-POLISH: §4 troubleshooting includes 4 common failure cases", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("## §4");
  const seg = text.slice(idx, text.indexOf("## §5", idx));
  // 4 numbered subsections §4.1 - §4.4
  for (const n of ["4.1", "4.2", "4.3", "4.4"]) {
    assert.match(seg, new RegExp(`### §${n.replace(".", "\\.")}`),
      `§4 must include §${n}`);
  }
  // Specific failures named
  assert.match(seg, /Node\.js not found on PATH/,
    "§4.1 must reference the actual error string");
  assert.match(seg, /server did not respond within 10s/,
    "§4.2 must reference the actual timeout error");
  assert.match(seg, /SmartScreen/,
    "§4.4 must address the Windows SmartScreen prompt");
});

test("END-USER-DEPLOY-POLISH: §5 distinguishes Claude vs Codex with the password caveat", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("## §5");
  const seg = text.slice(idx, text.indexOf("## §6", idx));
  assert.match(seg, /claude --version/);
  assert.match(seg, /codex --version/);
  assert.match(seg, /Anthropic|OpenAI/);
  assert.match(seg, /비밀번호를 묻지 않습니다/,
    "§5 must reiterate that Harness never asks for passwords");
});

test("END-USER-DEPLOY-POLISH: §6 explains the approval card UX", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("## §6");
  const seg = text.slice(idx, text.indexOf("## §7", idx));
  assert.match(seg, /승인 카드|승인 카드 \(Approval Card\)/);
  assert.match(seg, /30초/, "§6 must mention the 30-second timeout");
  assert.match(seg, /허용/);
  assert.match(seg, /거부/);
});

test("END-USER-DEPLOY-POLISH: §7 explains safety guards as features not bugs", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("## §7");
  const seg = text.slice(idx, text.indexOf("## §8", idx));
  assert.match(seg, /오류가 아닙니다/,
    "§7 must reframe blocks as safety features, not errors");
  assert.match(seg, /PII|개인정보/);
});

// ── Cross-references ───────────────────────────────────────

test("END-USER-DEPLOY-POLISH: links to operator-guide.md", () => {
  assert.match(read(RUNBOOK), /\.\.\/operator-guide\.md/);
});

test("END-USER-DEPLOY-POLISH: links to deployment-readiness.md (sibling runbook)", () => {
  assert.match(read(RUNBOOK), /deployment-readiness\.md/);
});

test("END-USER-DEPLOY-POLISH: runbooks/README.md lists first-time-use.md", () => {
  const idx = path.resolve(REPO_ROOT, "docs", "runbooks", "README.md");
  const text = read(idx);
  assert.match(text, /first-time-use\.md/,
    "runbooks/README.md must list first-time-use.md");
  // Must include the 일반 사용자 audience tag in §2
  const sec2 = text.slice(text.indexOf("## §2"), text.indexOf("## §3"));
  assert.match(sec2, /일반 사용자/,
    "§2 row must tag first-time-use.md as targeted at 일반 사용자");
});

// ── Bilingual harness-start.bat surface ─────────────────────

test("END-USER-DEPLOY-POLISH: harness-start.bat has Korean fallback for Node-missing error", () => {
  const text = read(BAT);
  assert.match(text, /Node\.js가 설치되어 있지 않습니다/,
    "Node-missing error must include the Korean explanation");
});

test("END-USER-DEPLOY-POLISH: harness-start.bat has Korean fallback for boot timeout", () => {
  const text = read(BAT);
  assert.match(text, /서버가 10초 안에 응답하지 않았습니다/,
    "boot-timeout error must include the Korean explanation");
  assert.match(text, /first-time-use\.md/,
    "boot-timeout error must point operators at the first-time-use runbook");
});

test("END-USER-DEPLOY-POLISH: harness-start.bat closes with bilingual completion banner", () => {
  const text = read(BAT);
  assert.match(text, /시작 완료/,
    "completion banner must include Korean affirmation");
  assert.match(text, /처음 사용자.*first-time-use/,
    "completion banner must point first-time users at the runbook");
});

// ── docs/runbooks/README.md renumbering left §3+ intact ─────
// (Paranoid: verify the family that §2 displaced is still present.)

test("END-USER-DEPLOY-POLISH: §3 Live-verify family still intact in runbooks index", () => {
  const idx = path.resolve(REPO_ROOT, "docs", "runbooks", "README.md");
  const text = read(idx);
  assert.match(text, /## §3 Live-verify family/,
    "§3 must still be Live-verify family after END-USER-DEPLOY-POLISH addition");
});
