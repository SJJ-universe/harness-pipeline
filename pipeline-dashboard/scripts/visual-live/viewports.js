// Slice UI-P10-a (Phase D Round UI-P, 2026-05-04) — viewport contract
// for live browser visual verification.
//
// Each viewport simulates a real screen size operators / 일반 사용자
// commonly run the harness dashboard on. The list is intentionally
// small (4) so the 4-route × 4-viewport matrix stays at 16 captures —
// large enough to surface real-world responsive issues, small enough
// that a CI artifact upload stays under reasonable size.
//
//   1366×768   — most-common laptop @ 100% scaling (운영자 노트북)
//   1920×1080  — common desktop / external monitor (운영실 모니터)
//   390×844    — iPhone 13/14 portrait (모바일 후속 기능 대비)
//   768×1024   — iPad portrait (태블릿 사용자)
//
// `deviceScaleFactor` mirrors what Chromium/Playwright reports for
// the matching device. `isMobile` triggers touch-event emulation in
// Playwright. Both fields are required by the contract (UI-P11
// responsive round will use them to assert text-fit + tap-target
// minimums).
//
// Frozen on purpose — the CI artifact comparison contract relies on
// the same 4 viewports landing in the same order every run. Changing
// the list is an explicit baseline-refresh decision, not a casual
// commit.

"use strict";

const VIEWPORTS = Object.freeze([
  Object.freeze({
    id: "desktop-1366",
    label: "Laptop 1366×768",
    width: 1366,
    height: 768,
    deviceScaleFactor: 1,
    isMobile: false,
  }),
  Object.freeze({
    id: "desktop-1920",
    label: "Desktop 1920×1080",
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    isMobile: false,
  }),
  Object.freeze({
    id: "mobile-390",
    label: "Mobile 390×844 (iPhone 13/14)",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    isMobile: true,
  }),
  Object.freeze({
    id: "tablet-768",
    label: "Tablet 768×1024 (iPad portrait)",
    width: 768,
    height: 1024,
    deviceScaleFactor: 2,
    isMobile: true,
  }),
]);

module.exports = { VIEWPORTS };
