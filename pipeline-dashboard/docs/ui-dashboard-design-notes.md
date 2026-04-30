# UI Dashboard Design Notes

> Status: **UI-H0 — design tokens locked in `public/css/harness-shell.css`**.
> Updated: 2026-04-30.
> Cross-refs: [UI-H Hybrid Redesign Plan](./ui-h-redesign-plan.md),
> [Scorecard](./scorecard.md).

This is the operator-facing design contract for the SJ Harness
Dashboard's monitor shell. The full token list lives in
`public/css/harness-shell.css`; this doc explains the policy
contract every panel + future round must honor.

---

## 1. Token vocabulary

All design tokens are CSS custom properties prefixed `--hsh-*`
(harness-shell). Categories:

| Category | Examples | Purpose |
|---|---|---|
| Color (background) | `--hsh-bg-base`, `--hsh-bg-shell`, `--hsh-bg-card`, `--hsh-bg-rail`, `--hsh-bg-elev` | Background layers from page → shell → card → rail → elevated card |
| Color (text) | `--hsh-text`, `--hsh-text-dim`, `--hsh-text-mute`, `--hsh-text-faint` | Four-tier text contrast |
| Color (accent) | `--hsh-bronze`, `--hsh-codex-blue` | Claude / primary CTA / harness gate vs Codex / Verifier |
| Color (semantic) | `--hsh-green-pass`, `--hsh-red-danger`, `--hsh-orange`, `--hsh-yellow`, `--hsh-purple` | Verify pass / critical / high / medium / subagent |
| Color (soft) | `*-soft` and `*-faint` variants | Background fill at 5-18% alpha |
| Typography | `--hsh-font-body`, `--hsh-font-mono`, `--hsh-font-serif` | System-font stacks (no Google Fonts) |
| Type scale | `--hsh-fs-xs/sm/md/base/lg/xl/display` | 9 / 10 / 11 / 13 / 14 / 17 / 22 px |
| Density | `--hsh-radius`, `--hsh-radius-md`, `--hsh-radius-pill`, `--hsh-space-1..6` | Compact dashboard density (3-4 px radius, 4-24 px spacing) |
| Motion | `--hsh-anim-pulse`, `--hsh-anim-slide`, `--hsh-anim-caret`, `--hsh-anim-rear-callout`, `--hsh-dur-fast/base/slow`, `--hsh-ease-snap`, `--hsh-ease-out` | Pulsing dots, sliding progress, blinking caret, harness gate callout |

Backwards-compatible fallbacks: existing CSS uses
`var(--bg-card, #161b22)` style with hex fallbacks. Those fallbacks
remain so a panel rendering before harness-shell.css loads (or
after a stylesheet error) still has a sane visual. Tokens are
ADDITIVE; consumers opt in.

---

## 2. Theme policy

**Dark only for now.** The mockup at `Downloads/web page/sj-harness-
dashboard/` was designed for dark; light theme is a follow-up
round.

When light theme arrives, it'll re-declare the same token names
under `[data-theme="light"]` on `:root` — every panel that uses
`var(--hsh-text)` automatically switches.

---

## 3. Reduced-motion contract

Two triggers freeze every animation token:

1. Operator's OS-level `prefers-reduced-motion: reduce` media
   query.
2. `data-posture="public-sector"` attribute on
   `document.documentElement` (set by UI-H5 when
   `HARNESS_DEPLOYMENT_PROFILE=public-sector`).

Either trigger causes:

- `--hsh-anim-pulse`, `--hsh-anim-slide`, `--hsh-anim-caret`,
  `--hsh-anim-rear-callout` → `none`.
- `--hsh-dur-fast/base/slow` → `0s`.

Effect: Harness Track horse stops at the current lane. Progress
strips freeze. Caret stops blinking. Pill dots become static.

The static markers and lane labels remain visible — operators
on reduced-motion still see "horse is at lane 4 of 7", just
without the gallop animation.

---

## 4. Public-sector visual policy

Per UI Plan.txt §"공공기관 모드":

> 공공기관 모드에서는 말 애니메이션을 더 차분한 "policy gate
> timeline"으로 바꿀 수 있게 reduced motion/public-sector
> visual mode 옵션을 둡니다.

Public-sector posture invokes:

1. **Reduced-motion** (token-driven, see §3 above).
2. **Policy-gate timeline** (UI-H2 + UI-H5 — Harness Track
   renders gates as static markers with policy-tier color tags
   instead of the gallop+rear sequence).
3. **Sandbox stream tab** in the dual console (UI-H3 + UI-H5 —
   the operator sees the sandbox runner output, NOT a local
   PTY; local Bash refused by the review-relay backend).
4. **No local Bash terminal** — UI Plan §"채택하지 않을 것"
   explicitly forbids this in public-sector mode.
5. **Bash/Edit/Write hooks ALWAYS through approval card** —
   GOV-APPROVAL-0 enforces this at the manager layer; UI-H5
   verifies via integration test that the public-sector path
   never bypasses.

---

## 5. Typography hosting

**No Google Fonts.** No external font CDN. The mockup imports
Pretendard / JetBrains Mono / Fraunces from
`fonts.googleapis.com`; we explicitly DON'T adopt that.

Production stack (in `--hsh-font-*`):

```
body:  system-ui, -apple-system, "Segoe UI", "Apple SD Gothic Neo",
       "Noto Sans KR", "Malgun Gothic", sans-serif
mono:  ui-monospace, "Cascadia Code", "Consolas", "Menlo",
       "Liberation Mono", monospace
serif: Georgia, "Apple SD Gothic Neo", "Noto Serif KR", serif
```

If an operator wants Pretendard or JetBrains Mono, they self-host:
drop the woff2 file in their fonts folder + add an `@font-face`
declaration. The harness doesn't bundle them.

Platform variance is accepted — Mac users see San Francisco,
Windows users see Segoe UI, Linux users see whatever their
distro picks. Korean text falls back through the Apple SD Gothic
Neo / Noto Sans KR / Malgun Gothic chain so every platform shows
a Korean-aware face.

---

## 6. Density + spacing

Compact dashboard. Cards are 12-14 px padding, 3-4 px radius,
hairline 0.5 px borders. The mockup's spacing is preserved
verbatim.

Operators on small viewports (< 1280 px wide) get a degraded
experience for the first cut — responsive layout is a follow-up
round (UI-H plan §7 "Out of scope").

---

## 7. Animation budget

Every animation token can be triggered by ≤ 1 element at a time
in a typical operator view. The Harness Track is the heaviest
animator (one running horse) — RAF-based, freezes when the tab
is hidden via Page Visibility API (UI-H2 implementation
contract).

CPU budget: total animation cost should stay below 1% of an
average operator workstation under steady-state. Any violation
moves the offender to reduced-motion-by-default.

---

## 8. Adoption pattern

When a panel adopts the new tokens:

```css
.my-panel {
  background: var(--hsh-bg-card, #101115);   /* fallback to old hex */
  color: var(--hsh-text, #E8E6E1);
  border: var(--hsh-bw-hairline) solid var(--hsh-border);
  padding: var(--hsh-space-3) var(--hsh-space-4);
  border-radius: var(--hsh-radius-md);
  font-family: var(--hsh-font-body);
}
```

Or use the utility classes:

```html
<div class="hsh-card">
  <h3 class="hsh-card-title">발견 사항 · Findings</h3>
  ...
</div>
```

Utility classes (`.hsh-card`, `.hsh-card-title`, `.hsh-pill*`,
`.hsh-mono`, `.hsh-text-*`) consume tokens internally — panels
that use them automatically pick up theme + reduced-motion
overrides.

---

## 9. What this round does NOT change

- Existing `style.monitor.css` still uses its own `var(--bg-card,
  #161b22)` style references. No mass rewrite — UI-H0 ADDS the
  new token vocabulary without modifying existing rules.
- Existing panels (`global-bar`, `run-tree`, `run-summary`,
  `agent-tree`, `inspector`, `timeline`, `bottom-dock`,
  `settings-accounts`, `approval-card`) keep their styles
  exactly as they shipped. They opt in to `--hsh-*` only when a
  later UI-H sub-round refactors them.
- The legacy `app.js` view (mode === "legacy") uses none of the
  new tokens. It renders identically to today.

---

## 10. Sources

- `C:\Users\SJ\Downloads\web page\UI Plan.txt` — UI policy
  directive
- `C:\Users\SJ\Downloads\web page\sj-harness-dashboard\` —
  React mockup (color values + density + animation patterns
  extracted)
- `docs/ui-h-redesign-plan.md` — round structure
- `docs/scorecard.md` — UI feedback loop cap context
