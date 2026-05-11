# Live Browser Accessibility Verification — 운영자 Runbook

> **Slice**: UI-P12 (Phase D Round UI-P, 2026-05-04)
>
> **목적**: UI-P10/P11 인프라 위에 axe-core (WCAG 2.0/2.1 A+AA, ~50 rules) + 2개 orchestrator 전용 custom rule을 얹어, 4 routes × 4 viewports = 16 cells 전체에서 접근성 회귀를 자동 검출. 공공기관 / 사내망 / 정부 조달 시나리오의 의무 항목.
>
> **이 도구가 잡는 것**:
> - axe-core: ARIA roles + labels, keyboard fundamentals, button-name, link-name, image-alt, frame-title, duplicate-id, html-has-lang, etc.
> - Custom: `<html lang>` 속성이 활성 i18n locale과 일치 / `.skip-link`이 focus 시 시각 변경
>
> **이 도구가 잡지 못하는 것**: 시각 polish (색상, 폰트), 기능 wiring (UI-P13), 모바일-only 인터랙션 (touch 제스처), 동적 컨텐츠 추가 후의 a11y 회귀 (정적 첫-paint 평가만)

---

## 1. 사전조건

UI-P10/P11과 동일:

1. Node 24+
2. `pipeline-dashboard`에서 `npm ci` 완료 (axe-core 자동 포함)
3. **chromium 설치 완료** (UI-P10/P11에서 이미 했다면 재사용)

---

## 2. 첫 실행

```bash
cd pipeline-dashboard

# UI-P10/P11에서 했다면 skip 가능
npm run visual:install-browsers

# UI-P12 표준 a11y 평가
npm run visual:a11y-live
```

**무엇이 일어나는가**:
1. 서버 in-process 부트 (port 4799)
2. chromium 실행 + 16 cells 순차 평가
3. 각 cell마다:
   - axe-core 소스를 page.addScriptTag 로 주입
   - axe.run() WCAG 2.0/2.1 A+AA tag 적용
   - lang-matches-locale + skip-link-focus-visible 평가
4. `docs/reports/<YYYY-MM-DD>-ui-p12-a11y/` 디렉토리에 manifest.json 작성
5. 콘솔에 per-cell + per-violation 출력
6. exit 0 (모두 통과) / 1 (실패) / 2 (config error)

---

## 3. 적용되는 rule 카탈로그

### 3.1 axe-core (WCAG 2.0/2.1 A+AA)

axe tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` — 약 50개 rule. 주요 카테고리:

| 카테고리 | 예시 rule |
|---|---|
| ARIA | aria-valid-attr, aria-required-attr, aria-roles |
| Forms | label, input-button-name, autocomplete-valid |
| Buttons / Links | button-name, link-name |
| Images | image-alt, role-img-alt |
| Tables | th-has-data-cells, scope-attr-valid |
| Landmarks | landmark-banner-is-top-level, landmark-main-is-top-level |
| Keyboard | tabindex, focus-order-semantics |
| Document | document-title, html-has-lang, html-lang-valid |
| Duplicate | duplicate-id, duplicate-id-active |

**기본 비활성**:
- `color-contrast` — 디자인 토큰이 UI-P arc에서 진화 중. UI polish round에서 별도로 활성화. 운영자가 즉시 켜고 싶으면 `--disable-rule` 반대 (현재 기본 비활성, 즉 활성하려면 코드 수정 필요).

**legacy route 전용 추가 비활성**:
- `region`, `landmark-one-main`, `landmark-unique` — legacy DOM이 landmark 구조를 안 따름. UI-P0 결정으로 escape hatch 유지.

**검출된 violation의 verdict**:
- `critical` / `serious` impact → cell **FAIL**
- `moderate` / `minor` impact → 경고로 기록만, cell verdict 영향 없음

→ 점진적 도입 정책. 향후 라운드에서 strict 모드 추가 가능.

### 3.2 Custom rules (2개)

| ID | 검사 |
|---|---|
| `lang-matches-locale` | `<html lang>`이 `HarnessI18n.getLang()` (또는 data-locale shell attribute) 값과 일치. KO ↔ EN toggle 시 SR 발음 정확성. en-US ↔ en simplification 처리. |
| `skip-link-focus-visible` | `.skip-link` 첫 Tab 시 focus 받음 + 시각 상태 변경 (position / opacity / transform / size 4-axis 중 하나 이상 변화). 키보드-only 사용자의 escape hatch. |

Custom rule 실패 → cell verdict **FAIL** (axe와 별개, 즉시 실패).

---

## 4. 옵션

```bash
node scripts/visual-a11y-live.js --help
```

| 플래그 | 설명 | 기본값 |
|---|---|---|
| `--port <n>` | 서버 포트 | 4799 |
| `--out-dir <path>` | 출력 디렉토리 | `docs/reports/<date>-ui-p12-a11y/` |
| `--label <text>` | label suffix | (없음) |
| `--disable-rule <id>` | 추가로 비활성할 axe rule (반복 가능) | (없음) |
| `--quiet` | per-cell 진행 출력 억제 | 출력 |
| `--json` | manifest를 stdout으로 | 안함 |

### 4.1 권장 시나리오

**일반 a11y 점검**:
```bash
npm run visual:a11y-live
```

**공공기관 감사 evidence 산출**:
```bash
node scripts/visual-a11y-live.js --label "public-sector-audit-2026-05-04"
```

**일부 noisy rule 임시 비활성** (조사용):
```bash
node scripts/visual-a11y-live.js --disable-rule region --disable-rule duplicate-id
```

**CI/scripting**:
```bash
node scripts/visual-a11y-live.js --quiet --json > a11y-result.json
```

---

## 5. Manifest 스키마 (orchestrator-visual-a11y/v1)

```json
{
  "schema": "orchestrator-visual-a11y/v1",
  "capturedAt": "2026-05-04T08:00:00.000Z",
  "base": "http://127.0.0.1:4799",
  "browser": { "name": "chromium", "version": "131.0.6778.69" },
  "axe": {
    "name": "axe-core",
    "version": "4.11.4",
    "tags": ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]
  },
  "customRulesetVersion": 2,
  "customRuleIds": ["lang-matches-locale", "skip-link-focus-visible"],
  "totalElapsedMs": 8421,
  "cells": [
    {
      "routeId": "product-default",
      "viewportId": "desktop-1366",
      "axeViolations": [
        {
          "id": "label",
          "impact": "critical",
          "help": "Form elements must have labels",
          "helpUrl": "https://dequeuniversity.com/...",
          "nodes": [/* axe element snippets */]
        }
      ],
      "customResults": [
        { "id": "lang-matches-locale", "ok": true, "skipped": false, "detail": {...} }
      ],
      "summary": {
        "ok": false,
        "axe": {
          "totalViolations": 1,
          "failingImpactsHit": 1,
          "bucket": { "critical": 1, "serious": 0, "moderate": 0, "minor": 0, "other": 0 }
        },
        "custom": { "total": 2, "passed": 2, "failed": 0, "skipped": 0 }
      },
      "totalMs": 612,
      "ok": false,
      "failed": false
    }
  ],
  "summary": {
    "totalCells": 16,
    "cellsAllPassed": 14,
    "cellsWithFailures": 2,
    "cellsWithErrors": 0,
    "totalAxeViolations": 8,
    "totalAxeFailingImpacts": 2,
    "totalCustomFailed": 0
  }
}
```

**핵심 필드**:
- `summary.cellsAllPassed = 16` ↔ 모든 cell 완전 통과
- `summary.cellsWithFailures > 0` ↔ critical/serious axe 또는 custom 실패
- `summary.totalAxeFailingImpacts` ↔ critical+serious 총합
- `summary.totalCustomFailed` ↔ custom 실패 총합
- `axe.tags + axe.version + customRulesetVersion` ↔ 평가 시점 catalog 스냅샷 (rule 변경 시 재평가 가능)

---

## 6. 트러블슈팅

### 6.1 모든 cell에서 `landmark-*` FAIL (legacy 제외)

원인: 새 panel이 `<header>` / `<main>` / `<footer>` / `<nav>` / `<aside>` 같은 landmark 안에 mount 안됨.

해결:
- 신규 panel을 `<section role="region" aria-label="...">` 안에 mount
- 또는 product shell의 region container에 `data-region` 외에 ARIA `role` 추가

### 6.2 모든 cell에서 `button-name` FAIL

원인: button에 텍스트도 없고 aria-label도 없음 (icon-only 버튼).

해결:
```html
<button aria-label="설정 열기" data-i18n="common.openSettings">⚙️</button>
```

### 6.3 `lang-matches-locale` FAIL

원인:
- `HarnessI18n.setLang(next)`이 `<html lang>` 안 업데이트
- 또는 init 후 lang attribute가 default "ko"로 stuck

해결:
- `public/js/i18n.js`의 setLang에서 `document.documentElement.lang = next` 명시
- product-shell-init.js에서 첫 mount 시 현재 locale로 lang 설정

### 6.4 `skip-link-focus-visible` FAIL

원인:
- `.skip-link`이 항상 보임 (baseline 상태가 이미 visible) → focus 시 변화 없음
- 또는 `.skip-link:focus` CSS rule이 빠져 있어 focus 시 시각 변화 없음

해결:
- Pattern: `.skip-link { position: absolute; top: -9999px; } .skip-link:focus { top: 0; ... }`
- 이미 적용됐는데 fail이면 `:focus`가 다른 selector로 override됐는지 확인

### 6.5 모든 cell ERR

서버 부트 자체 실패 — `npm run start`로 별도 부트 시도해서 진단.

### 6.6 BROWSER_NOT_INSTALLED

UI-P10/P11과 동일 — `npm run visual:install-browsers`.

---

## 7. 산출물 commit 정책

- ✅ `manifest.json`: **항상 commit** (line-friendly diff로 a11y 회귀 추적)
- ❌ 임시 cell screenshot (UI-P11과 달리 P12는 PNG 안 만듦, axe report만)

PR 첨부 패턴:
```markdown
## Accessibility (UI-P12)

Run: docs/reports/2026-05-04-ui-p12-a11y-pr-1234/

| Metric | Value |
|---|---|
| Cells passed | 14/16 |
| axe critical+serious | 2 |
| Custom failures | 0 |
| Wall time | 8.4s |

Failing rules:
- product-default × desktop-1366 :: `label` [critical]
- product-pro × mobile-390 :: `button-name` [serious]

manifest: [manifest.json](.../manifest.json)
```

---

## 8. CI 통합

P12-d에서 `.github/workflows/visual-a11y-live.yml` workflow_dispatch만 추가 (UI-P10/P11과 동일 정책). PR-gating 시점은 fused workflow가 도입될 별도 라운드.

---

## 9. 공공기관 / 정부 조달 컨텍스트

**왜 cap movement 트리거**:

이 라운드가 점수 cap을 움직이는 이유는, 공공기관 + 정부 조달에서 **a11y는 조달 진입 자체의 조건**이기 때문. 다음 시나리오에서 직접 평가됨:

- 한국 행정안전부 「전자정부 사용자 환경 개발 가이드라인」 § 접근성
- 미국 Section 508 (Federal acquisition)
- EU EN 301 549 (web accessibility regulation)

→ axe-core WCAG 2.1 AA + orchestrator-specific custom (lang/skip-link)는 이 모든 표준의 핵심 부분집합. 이번 라운드 통과 시 정부 조달 evidence trail의 시작점이 잡힘.

---

## 10. 후속 라운드 연결

| 다음 라운드 | UI-P12가 제공하는 것 |
|---|---|
| UI-P13 Dead Button | 같은 chromium orchestrator — click + axe 결합 가능 |
| UI-Doc-Gov | a11y manifest 형식 + commit 정책 |
| UI-FirstRun | first-run UI도 같은 a11y 평가 받아야 |

---

## 11. 변경 이력

- **2026-05-04**: 초판 (UI-P12-c 슬라이스 일부)
