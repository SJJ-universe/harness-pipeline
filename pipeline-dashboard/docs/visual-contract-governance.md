# Visual Contract Governance

> **Slice**: UI-Doc-Gov (Phase D Round UI-P, 2026-05-04)
>
> **목적**: Phase 2 UI Reference Port + UI-P9~P13 라운드를 통해 도입된 **5개 visual contract type**을 한 곳에서 관리한다. 각 contract가 무엇을 보장하는지, 언제 baseline을 갱신해도 되는지, PR diff에서 무엇을 봐야 하는지, 어떤 anti-pattern을 피해야 하는지 정착시킨다.

---

## 1. 6개 Contract Family — 한 눈에

| # | Contract | npm 명령 | Manifest schema | PR gate? | 기본 동작 |
|:---:|---|---|---|:---:|---|
| 1 | **Structural snapshot** (UI-P9) | `npm run visual:check` | `tests/visual/baseline-product-shell.json` | ✅ **CI gate** | drift 발견 시 CI fail. baseline은 source-of-truth. |
| 2 | **Live capture** (UI-P10) | `npm run visual:capture-live` | `harness-visual-live/v1` | ❌ manual | 4 routes × 4 viewports = 16 PNG evidence |
| 3 | **Responsive + text-fit** (UI-P11) | `npm run visual:assert-live` | `harness-visual-assert/v1` | ❌ manual | 6 frozen rules × 16 cells, pass/fail |
| 4 | **Accessibility** (UI-P12) | `npm run visual:a11y-live` | `harness-visual-a11y/v1` | ❌ manual | axe WCAG 2.0/2.1 A+AA + 2 custom × 16 cells |
| 5 | **Button integrity** (UI-P13) | `npm run visual:button-live` | `harness-visual-button/v1` | ❌ manual | 13 buttons × 4 routes (1 viewport) |
| 6 | **Fused live** (UI-Fuse) | `npm run visual:fused-live` | `harness-visual-fused/v1` (top-level summary) + per-tool subdirs | ❌ manual | 4개 contract 모두 단일 boot + 단일 chromium install 아래 순차 실행. 단일 artifact + 단일 summary.json. |

**핵심 분기점**:
- Contract 1 (UI-P9)은 **"structural baseline = the contract"**. 변경 시 의도적 baseline 갱신 + commit 알고 있어야 한다.
- Contract 2-5는 **"manifest = a snapshot of behavior"**. 운영자가 ad-hoc 실행, 결과를 PR description에 첨부하거나 commit 안 해도 된다. CI는 자동 gating 안 함.
- Contract 6 (UI-Fuse)는 **2-5의 orchestrator**. 새 schema 도입이 아니라 4개 manifest를 단일 directory로 묶고 top-level summary.json만 추가. PR-gating 진입 후보지만 §6.2 4 entry conditions 충족 전까지 manual.

---

## 2. Contract 1 — Structural Snapshot (UI-P9) Governance

### 2.1 무엇을 보장하는가

`tests/visual/baseline-product-shell.json` 안에 동결된 다음 구조:
- HTML mount IDs (`#product-shell-root`, `#harness-legacy-banner`, ...)
- CSS class compile counts (`.prod-shell`, `.bd-tab`, etc.)
- Design tokens (`--prod-*` custom properties from `style.product.css`)
- Script load order (legacy의 `js/legacy-banner.js` 등)
- Per-panel region/card/slot vocabulary (`data-region`, `data-card`, `data-card-slot`, ...)

이 구조 중 하나라도 baseline과 다르면 `tests/unit/visual.contract.test.js`가 fail.

### 2.2 baseline 갱신은 언제 OK인가

✅ **OK** (의도적 변경):
- 새 panel을 추가했고, 그 panel의 `data-region` 또는 `data-card-slot` vocabulary가 baseline에 추가됨
- design token 1개를 새로 정의 (예: `--prod-accent-warning`)
- script load order를 의도적으로 reorder
- legacy banner CSS class 추가

❌ **NOT OK** (회귀 / 사고):
- baseline만 갱신하고 코드 변경이 없는 PR (= "왜 baseline이 바뀌었지?" 미스터리)
- baseline 갱신 = 코드 변경의 **사이드 이펙트**여야지, 코드 변경의 **목적**이면 안 됨
- mount ID가 사라졌는데 baseline에서도 지움 → 어떤 panel이 깨졌는지 PR review에서 안 보임

### 2.3 PR review 체크리스트

`baseline-product-shell.json`이 PR diff에 보이면:

1. **항상 코드 변경과 함께** 봐야 한다. baseline-only PR = 의심
2. baseline에서 **무엇이 추가됐는가**: 새 panel? 새 design token? 새 mount?
3. baseline에서 **무엇이 빠졌는가**: 의도된 제거인가, 회귀인가?
4. baseline diff 라인 수가 **코드 변경과 대략 비례**해야 한다. 코드는 30줄, baseline은 500줄? 의심
5. PR description에 "intentional baseline refresh because [reason]" 명시 권장

### 2.4 Operator escape hatch

```bash
cd pipeline-dashboard
npm run visual:update    # write current state → baseline
npm run visual:check     # exit 0 (or "STALE" message + exit 1)
git diff tests/visual/baseline-product-shell.json
```

→ JSON 라인-친화적 diff로 PR review 가능. 변경 의도가 명확하면 commit, 아니면 코드 회귀를 먼저 fix.

### 2.5 CI 동작

`visual:check` step이 `.github/workflows/ci.yml`에 박혀 있어서 모든 PR push에 실행. STALE이면 PR merge 차단. **회피 X** — 의도적 baseline 갱신은 같은 PR에 commit으로 처리.

---

## 3. Contract 2-5 — Operator-Runnable Evidence Governance

### 3.1 공통 정책

모든 4개 (capture/assert/a11y/button) 공통:

- **PR push에서 자동 실행 X** — chromium ~150MB 다운로드 비용 회피
- 각각 manual workflow_dispatch (.github/workflows/visual-{capture,assert,a11y,button}-live.yml) 만 있음
- 운영자가 ad-hoc trigger (GitHub Actions UI 또는 로컬 `npm run visual:*-live`)
- exit 0/1/2 — gate-able하지만 PR-block 정책은 deferred

### 3.2 manifest commit 정책 — per contract

| Contract | 권장 commit 정책 |
|---|---|
| **Live capture** (P10) | PR마다 commit 안 함 (PNG 16개 × 100~300KB = ~3MB). UI 큰 변경 PR에는 PR description에 첨부 권장. 정기 점검 (월 1회) commit 가능 |
| **Responsive assert** (P11) | manifest 항상 commit 가능 (line-friendly diff). 회귀 발생 시 `--screenshot-failures` PNG 추가 첨부 |
| **A11y** (P12) | 항상 commit. 공공기관 evidence 누적용. PR description에 cells passed/violations 요약 |
| **Button** (P13) | 항상 commit. button catalog 변경 PR에는 필수 |

### 3.3 manifest stability — "다르게 보이지만 OK"

Contract 2-5 manifest의 다음 필드는 **runtime variance** — diff에 떠도 정상:

- `capturedAt` (timestamp)
- `totalElapsedMs`, `totalMs`, `navMs`, `paintMs`
- PNG `bytes` (chromium version 변화로 ±수십 byte 변동)
- `browser.version` (chromium 갱신 시)

다음 필드는 **stability anchor** — diff가 의미 있음:

- `summary.cellsAllPassed`, `summary.cellsWithFailures` (regression 직접 신호)
- `cells[].results[].id` 추가/제거 (catalog 변경)
- `cells[].results[].ok` 변화 (한 cell의 verdict가 뒤집힘)
- `summary.totalAxeFailingImpacts`, `summary.totalCustomFailed` (a11y 회귀)

### 3.4 baseline-style comparison은 미지원

Contract 2-5는 manifest를 baseline과 비교하지 않음 — 각 run은 독립 snapshot.

향후 라운드 후보:
- "역대 manifest를 git에서 grep해서 cellsAllPassed가 떨어진 시점 찾기" 같은 트래젝토리 도구
- baseline-mode (특정 manifest를 source-of-truth로 박고, 후속 manifest와 diff)

### 3.5 catalog frozen-list 변경 정책

Contract 3, 4, 5 (assert/a11y/button)은 **frozen catalog** 사용:
- `scripts/visual-live/assertions.js` (6 rules)
- `scripts/visual-live/a11y-rules.js` (axe tags + 2 custom)
- `scripts/visual-live/button-catalog.js` (13 buttons)

frozen-list에 추가/제거하는 PR은:

1. catalog source 파일 commit
2. 같은 PR에 `tests/unit/visual-live.{assertions,a11y-rules,button-catalog}.test.js` 갱신
3. `summary.totalButtonsApplicable` 같은 카운트도 변경됨 — manifest re-run + commit 권장
4. PR description에 "catalog change: added X, removed Y, reason..." 명시

---

## 4. Anti-patterns

### 4.1 Anti-pattern: baseline-refresh-only PR

```diff
- "panelMount": "#product-shell-root"
+ "panelMount": "#new-mount-id"
```

코드 변경 0, baseline만 변경. **거의 항상 회귀**. PR review에서 즉시 reject + 코드 변경의 부재 확인.

### 4.2 Anti-pattern: "capture-live PNG가 다르니 baseline도 갱신"

Capture-live의 PNG는 contract가 아님 (evidence-only). baseline 갱신과 무관. 시각 회귀처럼 보여도 P11 assert / P12 a11y / P13 button manifest를 먼저 봐야 한다.

### 4.3 Anti-pattern: manifest를 commit 안 하고 PR description에만 인용

```markdown
## Visual evidence
"All 16 cells passed" — trust me bro.
```

운영자/리뷰어가 검증 못 함. manifest 첨부 또는 commit 필수.

### 4.4 Anti-pattern: catalog frozen-list 우회

```js
// 'region' 룰이 자주 깨져서 비활성:
const A11Y_AXE_DISABLED_RULES_ALL = [..., 'region'];
```

frozen-list 변경은 항상 PR review를 거쳐야 하고, 비활성 사유는 source 주석 + commit message에 명시. 임시 비활성은 `--disable-rule` env / CLI flag 사용 (frozen-list 건드리지 말 것).

### 4.5 Anti-pattern: "아 그냥 visual:update 돌리고 commit하면 되겠지"

baseline 갱신 자체가 의도된 변경의 **결과**여야 한다. 갱신을 PR의 **수단**으로 쓰면 회귀를 가린다.

올바른 절차:
1. 코드 변경
2. `npm run visual:check` → STALE 확인
3. 변경이 의도된 것인지 코드 diff로 확인
4. 의도됐으면 `npm run visual:update` → baseline 갱신
5. baseline diff 한 번 더 확인
6. 코드 + baseline 같은 commit 또는 명시적 connecting commit

---

## 5. Decision Tree — 어느 도구를 언제 써야 하는가

```
새 PR 작성 중
  ↓
"UI 바꿨나?"
  ├─ 아니오 → 그냥 push (CI에서 visual:check 자동)
  └─ 예 → ↓

"어떤 종류의 변경?"
  ├─ structure (mount ID / panel set / token / class) → visual:update + 코드 같이 commit
  ├─ layout (responsive 깨짐 의심) → visual:assert-live (manifest 첨부)
  ├─ a11y (ARIA / 키보드 / 색상) → visual:a11y-live (manifest 첨부)
  ├─ button wiring (handler 추가/변경) → visual:button-live (manifest 첨부)
  └─ 시각 polish (의도된 색/폰트/간격) → visual:capture-live (PNG 첨부)
  ↓
push → CI runs visual:check (구조만 자동)
  ↓
PR reviewer → manifest 또는 PNG 첨부 확인
```

---

## 6. CI Policy — 현 상태와 미래

### 6.1 현 상태 (2026-05-04 기준)

- `ci.yml`에 `visual:check` step만 박혀 있음 (Contract 1 PR gate)
- Contract 2-5는 별도 workflow_dispatch 워크플로 (4개)

### 6.2 미래 — Fused workflow 후보

Contract 2-5를 PR-gating할 시점은 다음 조건이 충족됐을 때:

1. **Stable baselines for assert/a11y/button manifests** — "어떤 cell이 항상 fail하는지" 알려져 있어야 false positive 없음
2. **chromium 캐시 안정** — npm-ci 후 chromium 다운로드를 cache hit로 회피 가능
3. **Total wall time ≤ 5 분** — capture (10초) + assert (5초) + a11y (10초) + button (5초) + chromium install (cache hit 시 ~5초) ≈ 35초 + 4 × 30초 (각 워크플로 spin-up) ≈ 3분
4. **Operator UX**: PR-fail 시 어디서 fail했는지 클리어한 message

조건 충족 시 별도 라운드 (예: `UI-Fuse`)에서 fused workflow + PR-gating 도입.

### 6.3 manual-dispatch 정책 그대로 유지

위 조건 충족 전까지는 4개 워크플로 모두 manual-dispatch만. 운영자가 명시적 trigger.

---

## 7. 현재 catalog versions (2026-05-04 기준)

| Catalog | Version | 마지막 변경 라운드 |
|---|:---:|---|
| Visual contract baseline | 1 | UI-P9 (2026-04-30) |
| Responsive assertions | 6 rules | UI-P11-a (2026-05-04) |
| A11y axe tags | 4 (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`) | UI-P12-a (2026-05-04) |
| A11y custom rules | 2 (`lang-matches-locale`, `skip-link-focus-visible`) | UI-P12-a (2026-05-04) |
| Button catalog | 13 entries | UI-P13-a (2026-05-04) |
| Fused tools registry | 4 (`capture`, `assert`, `a11y`, `button`) | UI-Fuse-b (2026-05-04) |
| First-run states | 6 (`no-profile`, `no-active-profile`, `public-sector-incomplete`, `provider-missing`, `provider-not-authenticated`, `ready`) | UI-FirstRun-a (2026-05-04) |
| First-run CTAs | 9 (`create-profile`, `open-setup-wizard`, `open-settings-profiles`, `open-public-sector-setup`, `test-claude`, `test-codex`, `reopen-setup-for-providers`, `auth-claude`, `auth-codex`) | UI-FirstRun-a (2026-05-04) |

새 catalog version 도입 시 이 표 갱신.

---

## 8. 후속 라운드 연결

| 다음 라운드 | UI-Doc-Gov가 제공하는 것 |
|---|---|
| UI-FirstRun | 5개 contract의 commit 정책 + first-run UX 변화의 manifest 영향 |
| UI-Fuse (가설) | fused workflow 도입 시 §6.2 조건 체크 + 정책 통합 |
| Phase E SMART rounds | 새 UI 패널 추가 시 visual contract 갱신 절차 |

---

## 9. 변경 이력

- **2026-05-04**: 초판 (UI-Doc-Gov 슬라이스). UI-P9~P13 라운드를 통합 governance.
