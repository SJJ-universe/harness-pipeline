# Live Browser Responsive + Text Fit Assertions — 운영자 Runbook

> **Slice**: UI-P11 (Phase D Round UI-P, 2026-05-04)
>
> **목적**: UI-P10 evidence capture가 PNG로 보여주기만 하는 것을, **자동 pass/fail 판정**으로 격상한다. 4 routes × 4 viewports = 16 cells × 6 rules로 헤더 버튼 텍스트 잘림, dual terminals overflow, monitor grid 카드 겹침, pipeline rail 라벨 잘림, 페이지 가로 overflow, 모바일 tap target 최소 사이즈를 검사한다.
>
> **이 도구가 잡는 것**: 측정 가능한 layout/text 회귀 — `scrollWidth > clientWidth`, `boundingRect width < 44`, `rect intersection`, page-level overflow
>
> **이 도구가 잡지 못하는 것**: 시각 polish (색상, 폰트), 접근성 (UI-P12), button wiring (UI-P13), animation 타이밍

---

## 1. 사전조건

UI-P10과 동일:

1. Node 24+
2. `pipeline-dashboard`에서 `npm ci` 완료
3. 운영 시스템: Windows / macOS / Linux (Playwright 지원)
4. **chromium 설치 완료** (UI-P10에서 이미 `npm run visual:install-browsers` 했다면 재사용)

---

## 2. 첫 실행

```bash
cd pipeline-dashboard

# UI-P10에서 이미 했다면 skip 가능
npm run visual:install-browsers

# UI-P11 표준 assertion 실행
npm run visual:assert-live
```

**무엇이 일어나는가**:
1. 서버를 in-process로 부트 (port 4799)
2. chromium 실행 + 16 cells 순차 평가
3. 각 cell마다 6 assertion 실행 (legacy route는 일부 skip)
4. `docs/reports/<YYYY-MM-DD>-ui-p11-assert/` 디렉토리 생성
5. `manifest.json` 작성 (per-cell results + summary)
6. 콘솔에 per-cell + per-rule pass/fail 출력
7. exit 0 (모두 통과) / 1 (실패 있음) / 2 (config error)

---

## 3. Assertion 카탈로그 (6 rules)

| ID | 검사 | 적용 viewport | 적용 route |
|---|---|---|---|
| `no-horizontal-page-overflow` | `documentElement.scrollWidth ≤ clientWidth + 1` | 모든 viewport | 모든 route (legacy 포함) |
| `header-buttons-text-fit` | `[data-region="header"] button` 텍스트 잘림 없음 | 모든 viewport | non-legacy |
| `header-buttons-min-tap-target` | header 버튼 ≥ 44×44 px (WCAG 2.5.5) | 모바일 viewport만 | non-legacy |
| `dual-terminals-fit-container` | `[data-region="dual-terminals"]` overflow 없음 + visible | 모든 viewport | non-legacy |
| `monitor-grid-cards-no-overlap` | monitor-grid `[data-card]` 들이 서로 안 겹침 | 모든 viewport | non-legacy |
| `pipeline-rail-lane-labels-fit` | pipeline rail 단계 title 잘림 없음 | 모든 viewport | non-legacy |

**1px sub-pixel tolerance**: 고-DPR 디스플레이에서 0.5px 차이가 실제 overflow가 아닌 경우가 있어 모든 비교에서 ≤ 1px slop 허용.

**Mobile + non-legacy 한정 tap-target**: 데스크톱은 hover affordance + 정밀 마우스가 있어 44×44 강제하지 않음. Legacy는 다른 markup이라 적용 안 함.

---

## 4. 옵션

```bash
node scripts/visual-assert-live.js --help
```

| 플래그 | 설명 | 기본값 |
|---|---|---|
| `--port <n>` | 서버 포트 | 4799 |
| `--out-dir <path>` | 출력 디렉토리 | `docs/reports/<date>-ui-p11-assert/` |
| `--label <text>` | label suffix | (없음) |
| `--screenshot-failures` | assertion 실패한 cell의 full-page PNG 저장 | 안함 |
| `--quiet` | per-cell 진행 출력 억제 | 출력 |
| `--json` | manifest를 stdout으로 | 안함 |

### 4.1 권장 시나리오

**일반 정기 점검** (assertion만, debug 없음):
```bash
npm run visual:assert-live
```

**회귀 발견 후 디버깅** (실패 cell PNG 저장):
```bash
node scripts/visual-assert-live.js --screenshot-failures --label "debug-2026-05-04"
```

**CI 파이프라인 호출** (조용 + JSON):
```bash
node scripts/visual-assert-live.js --quiet --json > assert-result.json
echo "exit: $?"
```

---

## 5. Manifest 스키마

```json
{
  "schema": "harness-visual-assert/v1",
  "capturedAt": "2026-05-04T08:00:00.000Z",
  "base": "http://127.0.0.1:4799",
  "browser": { "name": "chromium", "version": "131.0.6778.69" },
  "rulesetVersion": 6,
  "rulesetIds": ["no-horizontal-page-overflow", "header-buttons-text-fit", ...],
  "totalElapsedMs": 5421,
  "cells": [
    {
      "routeId": "product-default",
      "viewportId": "desktop-1366",
      "results": [
        {
          "id": "no-horizontal-page-overflow",
          "label": "Page must not exceed viewport width",
          "ok": true,
          "detail": { "scrollWidth": 1366, "clientWidth": 1366, "overflow": 0 },
          "failures": null
        },
        ...
      ],
      "summary": { "applicable": 5, "passed": 5, "failed": 0, "skipped": 1 },
      "totalMs": 312,
      "ok": true,
      "failed": false,
      "screenshotPath": null
    }
  ],
  "summary": {
    "totalCells": 16,
    "cellsAllPassed": 16,
    "cellsWithFailures": 0,
    "cellsWithErrors": 0,
    "totalAssertionsApplicable": 84,
    "totalAssertionsPassed": 84,
    "totalAssertionsFailed": 0,
    "totalAssertionsSkipped": 12
  }
}
```

**핵심 필드**:
- `summary.totalCells = 16` (4 × 4 매트릭스)
- `summary.cellsAllPassed = 16` ↔ 모든 assertion 통과
- `summary.cellsWithFailures > 0` ↔ 일부 cell에서 assertion 실패
- `summary.cellsWithErrors > 0` ↔ 일부 cell에서 navigation/render fault
- `rulesetVersion + rulesetIds` ↔ 평가 시점 catalog 스냅샷 (catalog 변경 시 manifest 재평가 가능)

---

## 6. 트러블슈팅

### 6.1 모든 cell에서 `header-buttons-text-fit` FAIL

원인 가능성:
- 새 i18n 문자열이 너무 김 (예: 영어가 한국어보다 더 긴 단어)
- 새 버튼이 `[data-region="header"]` 안에 추가됐는데 CSS 스타일 누락

해결:
1. `--screenshot-failures`로 실패 PNG 확인
2. `manifest.json`의 `failures[].text` + `overflow` 값 확인
3. `public/style.product.css`의 헤더 버튼 너비 / 패딩 / 폰트 사이즈 조정
4. 또는 i18n 문자열 단축

### 6.2 모바일 viewport에서 `header-buttons-min-tap-target` FAIL

원인: 모바일에서 헤더 버튼이 44×44 미만.

해결:
- `style.product.css`에 모바일 미디어 쿼리로 버튼 min-width/min-height 추가:
  ```css
  @media (max-width: 768px) {
    .ph-header button {
      min-width: 44px;
      min-height: 44px;
    }
  }
  ```

### 6.3 `monitor-grid-cards-no-overlap` FAIL

원인: 카드 그리드 layout이 viewport에서 wrap 못해 overlap.

해결:
- CSS Grid `grid-template-columns: repeat(auto-fit, minmax(...))` 같은 패턴
- 또는 viewport-specific media query

### 6.4 BROWSER_NOT_INSTALLED

UI-P10과 동일 — `npm run visual:install-browsers` 실행.

### 6.5 모든 cell ERR (`failed: true`)

서버 부트 자체 실패 — `npm run start`로 별도 부트 시도해서 진단.

---

## 7. 산출물 commit 정책

UI-P11은 UI-P10과 다르게 **assertion 결과**가 명확하므로 commit 정책이 다름:

- ✅ `manifest.json`: **항상 commit** (line-friendly diff로 회귀 추적 가능)
- ✅ 실패 cell PNG (`__failed.png`): **회귀 발생 시에만 commit** (PR description에 첨부)
- ❌ 통과한 cell PNG: commit 안 함 (UI-P10이 그 역할)
- ❌ 임시 디렉토리: commit 안 함

PR에 첨부 패턴:
```markdown
## Visual assertions (UI-P11)

Run: docs/reports/2026-05-04-ui-p11-assert-pr-1234/

| Metric | Value |
|---|---|
| Cells passed | 16/16 |
| Assertions passed | 84/84 (12 skipped) |
| Wall time | 5.4s |

manifest: [manifest.json](.../manifest.json)
```

---

## 8. CI 통합

P11-d에서 `.github/workflows/visual-assert-live.yml` workflow_dispatch만 추가 (PR push 자동 실행 X — UI-P10과 동일 정책).

PR-gating 시점: UI-P12 (a11y) 마감 후 fused workflow로 진입.

---

## 9. 후속 라운드 연결

| 다음 라운드 | UI-P11이 제공하는 것 |
|---|---|
| UI-P12 Accessibility | 같은 chromium harness + assertions catalog 패턴 — axe-core scan 추가 |
| UI-P13 Dead Button | 같은 server-boot + page.evaluate 패턴 — click + verify 추가 |

---

## 10. 변경 이력

- **2026-05-04**: 초판 (UI-P11-c 슬라이스 일부)
