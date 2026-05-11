# UI-FirstRun "지금 해야 할 일" — Round Closeout

> **Slice**: UI-FirstRun (Phase D Round UI-P, 2026-05-04)
>
> **Round goal**: Phase 2 UI 마감 라운드. 운영자가 처음 대시보드를 켰을 때 "무엇을 해야 하는가"를 정직하게 알려주는 next-action-card를 simple shell에 마운트. 빈 화면 대신 "아직 연결 전이라 대기 중" 상태를 분류 + 구체적 CTA로 안내.
>
> **Round verdict**: GO — classifier (FirstRun-a) + store slice + panel (FirstRun-b) + simple-shell mount + i18n + settings wiring (FirstRun-c) + closeout (FirstRun-d) all landed and unit-green.

---

## 1. What landed

### 1.1 FirstRun-a — Classifier (commit `be2e169`)

| File | Role |
|---|---|
| `public/js/runtime/firstRunClassifier.js` | Pure UMD classifier (Node + 브라우저) — `classifyFirstRun(accountStatus)` returns `{state, ctas, meta}` |
| `tests/unit/firstRunClassifier.test.js` | 30 stub-injection tests |

**6 frozen states (priority order)**:
1. `no-profile` — count=0
2. `no-active-profile` — count>0, !activeId, standard posture
3. `public-sector-incomplete` — !activeId AND publicSector (supersedes #2)
4. `provider-missing` — active profile + providerStatus.{claude,codex}.installed=false
5. `provider-not-authenticated` — installed=true && authenticated=false
6. `ready` — default (active profile, no checked failure)

**9 frozen CTAs**: create-profile / open-setup-wizard / open-settings-profiles / open-public-sector-setup / test-claude / test-codex / reopen-setup-for-providers / auth-claude / auth-codex

`STATE_CTAS` per-state CTA recommendation array maps each state to its primary + secondary actions in priority order.

### 1.2 FirstRun-b — Store slice + panel (commit `31ac3c6`)

| File | Role |
|---|---|
| `public/js/monitor/store.js` | `setProviderStatus(input)` action + providerStatus slice in accountStatus |
| `public/js/monitor/panels/next-action-card.js` | UMD panel rendering 6 states with CTA wiring (~280 LOC) |
| `tests/unit/monitor.store.providerStatus.test.js` | 12 store slice tests |
| `tests/unit/monitor.next-action-card.test.js` | 16 panel render + interaction tests |

**providerStatus slice semantics**:
- Panel-set, NOT polled by `/api/server/info` legacy-bridge — no surprise token cost on first paint
- Partial input merges (operator who only tests Claude doesn't wipe Codex's last-known status)
- setAccountStatus partial input PRESERVES providerStatus (legacy-bridge polling shouldn't clobber)
- Snapshot defensively shallow-copies (caller mutation can't bleed into store)

**Panel features**:
- `data-card="next-action"` mount + `data-state="{state-id}"` attribute
- `data-posture="public-sector"` flipped when posture is public-sector (CSS hook)
- Honest framing: READY state with no providerStatus shows "연결 상태는 아직 확인되지 않았습니다" hint + offers Test CTAs
- CTAs fire `onCta(ctaId, meta)` callback — caller knows HOW to act
- Lifecycle: `destroy()` unsubs from store + removes element

### 1.3 FirstRun-c — Simple-shell + i18n + settings wiring (commit `d90443c`)

| File | Role |
|---|---|
| `public/js/runtime/firstRunClassifier.js` | UMD wrapper (Node require + window.HarnessFirstRunClassifier) |
| `public/js/monitor/shells/simple-shell.js` | Mount next-action-card in `.ss-first-run-mount` between welcome-overlay + 4-card grid + 4 fallback CTA dispatchers |
| `public/js/monitor/panels/settings-accounts.js` | testProfile() mirrors probe-provider verdict → store.setProviderStatus |
| `public/js/i18n/{ko,en}.js` | 24 firstRun.* keys with placeholder substitution |
| `public/index.legacy.html` | New script tags BEFORE simple-shell.js |
| `tests/visual/baseline-product-shell.json` | Updated for 2 new script entries |
| `tests/unit/monitor.simple-shell.firstRun.test.js` | 11 integration tests |

**Simple-shell CTA dispatch contract**:
- `onFirstRunCta(ctaId, meta)` is the primary dispatcher when wired
- Fallback dispatch when caller didn't wire onFirstRunCta:
  - `open-setup-wizard` / `reopen-setup-for-providers` / `create-profile` → `onOpenSetupWizard()`
  - `open-settings-profiles` / `open-public-sector-setup` → `onOpenSettings()`
  - `test-claude` / `test-codex` → `onTestProvider("claude" | "codex")`
  - `auth-claude` / `auth-codex` → `onAuthProvider("claude" | "codex")`
- Unknown CTA + no fallback → silent no-op (operator at least sees the next-action message)
- Thrown handler in fallback dispatch does NOT crash the shell

**Settings → store wiring** is the link that closes the "untested" verdict:
- Operator clicks "Test Claude" in D3 settings modal → POST /api/setup/probe-provider tier1+2 → response stored in panel-local cache (existing) AND store.providerStatus (new)
- Next-action-card re-renders → state drops from "ready (untested)" → ready / provider-missing / provider-not-authenticated based on probe verdict

### 1.4 FirstRun-d — This closeout + scorecard refresh

`docs/scorecard.md` adds new closure marker after the UI-P13 + UI-Doc-Gov closure marker:

```
**━━━ UI-FirstRun closed at 120/126 (2026-05-04) ━━━**
```

Phase 2 UI Reference Port arc fully closed. Roadmap forward: UI-Fuse → SMART-0..SMART-5 + SKILL-PACK-0.

---

## 2. Verification

### 2.1 Test counts (pre-round → post-round)

| Suite | Pre FirstRun | Post FirstRun | Δ |
|---|---:|---:|---:|
| Unit | 2702 | 2771 | +69 (30 + 28 + 11) |
| Integration | 457 | 457 | 0 |
| Smoke | 80 | 80 | 0 |
| Live readiness | 18/18 | 18/18 | 0 |

### 2.2 Visual baseline updated

`tests/visual/baseline-product-shell.json` `indexLegacyHtml.scripts` array gains 2 entries:
- `js/runtime/firstRunClassifier.js`
- `js/monitor/panels/next-action-card.js`

Per `docs/visual-contract-governance.md` §2.2 this is an intentional additive change — script load order is part of the contract, but new scripts are routine. Baseline refresh + code change in the same PR.

### 2.3 Backwards-compat invariants preserved

- UI-P9 visual contract gate — green after baseline refresh
- UI-H8 welcome-overlay — unaffected; still mounts above next-action-card
- D3 settings-accounts panel-local test cache — preserved; store mirroring is additive
- All 4 simple-shell cards (now-doing / pending-approvals / recent-results / connection-status) — unaffected
- Existing `npm run visual:*-live` rounds (UI-P10/P11/P12/P13) — unaffected; new panel is in their selector vocabulary

---

## 3. Score impact

| Stage | Score |
|---|:---:|
| Entry (UI-Doc-Gov closed) | 120/126 |
| +FirstRun-a (classifier) | 120/126 |
| +FirstRun-b (store + panel) | 120/126 |
| +FirstRun-c (integration) | 120/126 |
| +FirstRun-d (closeout) | **120/126** (UX completeness, no cap movement) |

UI-FirstRun is **operator-trust foundation**, NOT a new defense layer. Cap movement is deferred to:
- Future SMART rounds (decision context / recommendations / hard gates) — Safety + Pipeline orchestration cap candidates
- Future fused workflow (UI-Fuse) — potential Operator-trust dimension cap if we add one

What this round changes operationally: a first-run operator sees concrete next steps instead of an empty grid. The "도구를 처음 켠 사람이 무엇을 해야 하는지 바로 아는가" gate is now closed.

---

## 4. Round artifacts

| Path | Type |
|---|---|
| `public/js/runtime/firstRunClassifier.js` | source — UMD classifier (renamed from src/runtime/) |
| `public/js/monitor/panels/next-action-card.js` | source — 6-state panel UMD |
| `public/js/monitor/store.js` (modified) | source — providerStatus slice + setProviderStatus action |
| `public/js/monitor/shells/simple-shell.js` (modified) | source — next-action-card mount + 4 fallback dispatchers |
| `public/js/monitor/panels/settings-accounts.js` (modified) | source — testProfile mirrors probe to store |
| `public/js/i18n/{ko,en}.js` (modified) | source — 24 firstRun.* keys |
| `public/index.legacy.html` (modified) | source — 2 new script tags |
| `tests/visual/baseline-product-shell.json` (modified) | baseline — 2 script additions |
| `tests/unit/firstRunClassifier.test.js` | test (30) |
| `tests/unit/monitor.store.providerStatus.test.js` | test (12) |
| `tests/unit/monitor.next-action-card.test.js` | test (16) |
| `tests/unit/monitor.simple-shell.firstRun.test.js` | test (11) |
| `docs/reports/2026-05-04-ui-first-run-eval.md` | docs — this closeout |

---

## 5. Known limitations + follow-ups

### 5.1 UI-FirstRun round itself
- providerStatus slice is panel-set (operator clicks Test). Future rounds could add server-side last-known-good caching so first paint shows latest probe state without a click.
- Public-sector-incomplete state currently fires only when `!activeId && publicSector`. More granular detection (sandbox workspace not configured / acknowledgments not given) requires server-side `/api/server/info` extension to expose agency-fields-completeness.
- next-action-card has NO CSS file yet — relies on default browser styling. UI polish round can add `.nac-*` classes to `style.product.css` for proper visual treatment.
- product-shell-init.js (the modern shell init script for index.html) does NOT yet wire the next-action-card. Currently only index.legacy.html (where simple-shell mounts) gets the panel. Production shell inclusion is a future polish.

### 5.2 Out-of-scope (later rounds)
- **UI-Fuse** — fused workflow + PR-gating for capture/assert/a11y/button manifests. Conditions documented in governance §6.2.
- **SMART-0..SMART-5 + SKILL-PACK-0** — Plan §S Part S 본격 시작. SMART-0 decision context can extend the classifier with broader operator-state inputs.
- **UI-Onboarding-Tour** — interactive tour after first profile creation (not just static card).
- **Setup wizard CLI integration** — `orchestrator-start.bat` could spawn setup-wizard.{ps1,sh} on first launch when accountStatus shows no profile.

---

## 6. Sign-off

- ✅ All 4 sub-slices (FirstRun-a/b/c/d) land in this round
- ✅ 69 new unit tests, 0 regression (existing 17 simple-shell + 17 settings-accounts + 52 store + 4 i18n parity tests all pass)
- ✅ next-action-card mounts in simple shell with 5-state classification + 9 documented CTAs
- ✅ Settings-accounts probe-provider results mirror to store, closing the untested-verdict gap
- ✅ KO/EN i18n parity verified (24 new keys × 2 locales)
- ✅ Visual contract baseline refreshed for 2 new script entries (intentional additive change)
- ✅ Score 120/126 unchanged (UX completeness foundation; cap movement deferred to SMART arc)

**Phase 2 UI Reference Port arc fully closed**: UI-P0 (sign-off) → UI-P1~P9 (port + structural gate) → UI-P10~P13 (live capture/assert/a11y/button) → UI-Doc-Gov (governance) → **UI-FirstRun (this round, no-profile UX)**.

**Next round candidate**: UI-Fuse — combine the 4 manual visual-* workflows into a single PR-gating workflow once the conditions in `docs/visual-contract-governance.md` §6.2 are met. Or jump to SMART-0 for decision context foundation.

---

## 7. Reproduction

```bash
cd pipeline-dashboard

# Open the simple shell with NO profile (first-run state):
# Browser → http://localhost:4201/?monitor=1
# (also requires localStorage.harnessMonitor = "1" or accountStatus to show count=0)

# Run the classifier in node REPL:
node -e "
  const { classifyFirstRun, FIRST_RUN_STATES } = require('./public/js/runtime/firstRunClassifier');
  console.log('Empty:', classifyFirstRun(null).state);
  console.log('Active+ready:', classifyFirstRun({
    profile: { count: 1, activeId: 'personal' }
  }).state);
  console.log('Public-sector incomplete:', classifyFirstRun({
    profile: { count: 1, activeId: null },
    deployment: { publicSector: true }
  }).state);
"

# Verify all 4 test files:
node --test tests/unit/firstRunClassifier.test.js \
                   tests/unit/monitor.store.providerStatus.test.js \
                   tests/unit/monitor.next-action-card.test.js \
                   tests/unit/monitor.simple-shell.firstRun.test.js
```
