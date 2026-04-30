// Slice UI-H7-e (Phase D / Phase E1.5, 2026-04-30) — operator-friendly
// Korean error message mapping for review-session client errors.
//
// Pins:
//   - public_sector_local_executor_disabled → 공공기관 모드 안내
//   - invalid_state / invalid_input / session_not_found / service_unavailable
//     / network_error all map to Korean operator messages
//   - Unknown error code → raw message + code (still actionable)
//   - null / undefined input → safe fallback
//   - Mapping is pure (no DOM, no store)

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const layout = require("../../public/js/monitor/layout.js");
const { _formatReviewError } = layout;

// ── public_sector_local_executor_disabled ────────────────────────

test("UI-H7-e: public-sector 409 → 공공기관 모드 friendly message", () => {
  const err = Object.assign(new Error("Public-sector posture..."), {
    code: "public_sector_local_executor_disabled", status: 409,
  });
  const msg = _formatReviewError(err);
  assert.match(msg, /공공기관 모드/);
  assert.match(msg, /로컬 Claude 실행/);
  // Friendly message — no raw HTTP code or English error string
  assert.equal(msg.includes("public_sector_local_executor_disabled"), false);
  assert.equal(msg.includes("Public-sector posture"), false);
});

// ── invalid_state / invalid_input / session_not_found ────────────

test("UI-H7-e: invalid_state 409 → 세션 상태 안내", () => {
  const err = { code: "invalid_state", message: "wrong state", status: 409 };
  const msg = _formatReviewError(err);
  assert.match(msg, /세션 상태/);
});

test("UI-H7-e: invalid_input 400 → 입력 값 안내", () => {
  const err = { code: "invalid_input", message: "bad", status: 400 };
  const msg = _formatReviewError(err);
  assert.match(msg, /입력 값/);
});

test("UI-H7-e: review_session_invalid_input 400 → friendly Korean", () => {
  const err = { code: "review_session_invalid_input", status: 400 };
  const msg = _formatReviewError(err);
  assert.match(msg, /입력 값/);
});

test("UI-H7-e: review_session_input_too_long → 8KB 안내", () => {
  const err = { code: "review_session_input_too_long", status: 400 };
  const msg = _formatReviewError(err);
  assert.match(msg, /너무 깁니다/);
  assert.match(msg, /8KB/);
});

test("UI-H7-e: session_not_found 404 → 세션을 찾을 수 없습니다", () => {
  const err = { code: "session_not_found", status: 404 };
  const msg = _formatReviewError(err);
  assert.match(msg, /세션을 찾을 수 없습니다/);
});

// ── service availability / network ───────────────────────────────

test("UI-H7-e: service_unavailable 503 → 서비스 응답 안내", () => {
  const err = { code: "service_unavailable", status: 503 };
  const msg = _formatReviewError(err);
  assert.match(msg, /서비스가 응답하지 않습니다/);
});

test("UI-H7-e: review_session_manager_unavailable → same message family", () => {
  const err = { code: "review_session_manager_unavailable", status: 503 };
  const msg = _formatReviewError(err);
  assert.match(msg, /서비스가 응답하지 않습니다/);
});

test("UI-H7-e: network_error → 네트워크 오류 안내", () => {
  const err = { code: "network_error", status: 0 };
  const msg = _formatReviewError(err);
  assert.match(msg, /네트워크 오류/);
  assert.match(msg, /연결 상태/);
});

// ── server-side / fallback ───────────────────────────────────────

test("UI-H7-e: server_error 500+ → 관리자 안내", () => {
  const err = { code: "server_error", status: 500 };
  const msg = _formatReviewError(err);
  assert.match(msg, /서버 내부 오류/);
});

test("UI-H7-e: review_session_error fallthrough → friendly Korean", () => {
  const err = { code: "review_session_error", status: 500 };
  const msg = _formatReviewError(err);
  assert.match(msg, /Review relay 작업이 실패/);
});

test("UI-H7-e: unknown error code → raw msg + code (still actionable)", () => {
  const err = { code: "weird_unique_code", message: "Something odd happened" };
  const msg = _formatReviewError(err);
  assert.match(msg, /Something odd happened/);
  assert.match(msg, /weird_unique_code/);
});

test("UI-H7-e: unknown code without message → fallback string + code", () => {
  const err = { code: "weird_unique_code" };
  const msg = _formatReviewError(err);
  assert.match(msg, /weird_unique_code/);
});

// ── null / undefined defense ─────────────────────────────────────

test("UI-H7-e: null err → safe fallback", () => {
  const msg = _formatReviewError(null);
  assert.match(msg, /알 수 없는 오류/);
});

test("UI-H7-e: undefined err → safe fallback", () => {
  const msg = _formatReviewError(undefined);
  assert.match(msg, /알 수 없는 오류/);
});

test("UI-H7-e: err without code AND without message → fallback", () => {
  const msg = _formatReviewError({});
  // {} defaults to code "review_session_error" via the ? : in the
  // mapping function, which maps to a friendly Korean fallback.
  assert.match(msg, /Review relay 작업이 실패/);
});

// ── purity ────────────────────────────────────────────────────────

test("UI-H7-e: _formatReviewError is pure (no DOM, no global mutation)", () => {
  // Smoke: function should be callable in a Node-only env.
  const result1 = _formatReviewError({ code: "network_error" });
  const result2 = _formatReviewError({ code: "network_error" });
  assert.equal(result1, result2);
  assert.equal(typeof result1, "string");
});
