// Slice UI-P10-a (Phase D Round UI-P, 2026-05-04) — route contract
// for live browser visual verification.
//
// Mirrors the four routes the dashboard server resolves for `GET /`
// (see server.js indexRenderer + product-shell-routing.test.js):
//
//   /              → product shell (default; UI-P0 made this the
//                    landing page after UI Reference Port)
//   /?mode=pro     → product shell with pro-mode default (UI-P7)
//   /?mode=simple  → product shell with simple-mode default
//   /?mode=legacy  → preserved legacy DOM with UI-P8 deprecation
//                    banner (operator escape hatch, no EOL)
//
// `pathname` is the URL path the capture script appends to the base
// URL. `mode` is the resolved shell mode for filename / metadata.
// `viewportSelector` is an optional body-attribute the capture script
// can wait for before screenshot — keeps captures from racing the
// initial paint.
//
// Frozen so the CI artifact comparison contract is stable across
// runs. Adding a route is an explicit baseline-refresh decision.

"use strict";

const ROUTES = Object.freeze([
  Object.freeze({
    id: "product-default",
    pathname: "/",
    mode: "default",
    label: "Product shell (default landing)",
    waitForSelector: "#product-shell-root",
  }),
  Object.freeze({
    id: "product-pro",
    pathname: "/?mode=pro",
    mode: "pro",
    label: "Product shell — pro mode",
    waitForSelector: "#product-shell-root",
  }),
  Object.freeze({
    id: "product-simple",
    pathname: "/?mode=simple",
    mode: "simple",
    label: "Product shell — simple mode",
    waitForSelector: "#product-shell-root",
  }),
  Object.freeze({
    id: "legacy",
    pathname: "/?mode=legacy",
    mode: "legacy",
    label: "Legacy view + UI-P8 banner",
    waitForSelector: "#harness-legacy-banner",
  }),
]);

module.exports = { ROUTES };
