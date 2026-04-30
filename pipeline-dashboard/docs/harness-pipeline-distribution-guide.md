# Harness Pipeline 배포용 통합 가이드

> 배포 문서 초안. 이 문서는 Markdown 원본으로 관리하고, 배포 시 PDF로 변환해 함께 제공할 수 있다.
>
> 기준 상태: `118 / 124`, Public-sector readiness `5 / 5`
>
> 대상 독자: 일반 사용자, 기관 운영자, 개발자, 보안 담당자, 감사 담당자

---

## 목차

1. 문서의 목적
2. 한 줄 설명
3. 이 도구가 만들어진 이유
4. 이 도구가 필요한 사람
5. 이 도구가 해결하는 문제
6. 전체 기능 요약
7. 일반 사용자용 사용 흐름
8. 개발자용 사용 흐름
9. 공공기관 및 사내망 사용 흐름
10. 주요 화면과 UI 모드
11. Claude와 Codex 협업 기능
12. 승인 카드와 위험 작업 통제
13. 개인정보 탐지와 마스킹
14. 감사 기록과 증거 봉투
15. 배포 패키지와 실행 방식
16. 서명된 manifest와 오프라인 검증
17. 시스템 구성 요소
18. 보안 설계 원칙
19. 공공기관용 보안 모델
20. 운영자 체크리스트
21. 개발자 체크리스트
22. 감사관 체크리스트
23. 자주 묻는 질문
24. 현재 제한사항과 후속 작업
25. 용어 사전
26. 부록: 주요 명령어

---

## 1. 문서의 목적

이 문서는 Harness Pipeline을 처음 접하는 사람도 도구의 목적, 기능, 사용법, 보안 구조, 배포 방식, 감사 절차를 이해할 수 있도록 만든 통합 가이드다.

이 문서는 두 종류의 독자를 동시에 고려한다.

- 일반 사용자: AI에게 일을 맡기고 결과를 확인하고 싶은 사람
- 개발자 및 운영자: Claude Code, Codex, 원격 runner, 감사 로그, 보안 정책, 배포 절차를 이해해야 하는 사람

따라서 앞부분은 쉬운 설명으로 시작하고, 뒤로 갈수록 보안, 배포, 운영, 개발자용 세부 정보로 들어간다.

---

## 2. 한 줄 설명

Harness Pipeline은 Claude Code와 Codex 같은 AI 개발 도구를 한 화면에서 실행, 관찰, 검토, 승인, 기록할 수 있게 해주는 AI 작업 관제 대시보드다.

더 쉽게 말하면 다음과 같다.

> AI에게 일을 맡길 때, 지금 무엇을 하는지 보이고, 위험한 행동은 멈춰 세우고, 다른 AI에게 검토를 맡기고, 모든 과정을 기록으로 남겨주는 안전한 작업 대시보드다.

---

## 3. 이 도구가 만들어진 이유

Claude Code나 Codex 같은 AI CLI 도구는 강력하다. 개발자는 터미널에서 AI에게 파일 수정, 코드 작성, 테스트 실행, 오류 분석을 맡길 수 있다.

하지만 작업이 커질수록 다음 문제가 생긴다.

- AI가 지금 무엇을 하고 있는지 한눈에 보기 어렵다.
- 여러 터미널 로그를 사람이 직접 따라가야 한다.
- 파일 수정이나 명령 실행 같은 위험 작업이 눈에 잘 띄지 않는다.
- Claude가 만든 결과를 Codex에게 검토시키는 흐름이 수동적이다.
- 작업이 끝난 뒤 왜 그런 결정이 내려졌는지 설명하기 어렵다.
- 개인정보가 포함된 데이터가 AI에게 전달될 위험이 있다.
- 공공기관이나 회사 내부망에서는 감사 기록과 실행 통제가 필요하다.

Harness Pipeline은 이런 문제를 해결하기 위해 만들어졌다.

핵심 목표는 AI 모델 자체를 바꾸는 것이 아니다. AI가 하는 일을 사람이 이해하고 통제할 수 있도록 운영 구조를 만드는 것이다.

---

## 4. 이 도구가 필요한 사람

### 4.1 일반 사용자

AI에게 작업을 맡기고 싶지만 터미널 사용이 익숙하지 않은 사람에게 필요하다.

예를 들어 다음 상황에 적합하다.

- AI가 지금 무엇을 하는지 화면으로 보고 싶다.
- 승인해야 할 작업만 직접 확인하고 싶다.
- 결과가 제대로 나왔는지 다시 확인하고 싶다.
- 복잡한 명령어 없이 배치파일로 실행하고 싶다.

### 4.2 개발자

Claude Code나 Codex를 이미 쓰고 있지만, 더 큰 작업을 안전하게 운영하고 싶은 개발자에게 필요하다.

예를 들어 다음 상황에 적합하다.

- Claude가 구현하고 Codex가 비평하는 흐름을 만들고 싶다.
- AI가 실행한 작업과 로그를 한 곳에서 보고 싶다.
- 위험한 파일 수정이나 명령 실행은 승인 후 진행하고 싶다.
- 여러 run의 결과를 비교하고 추적하고 싶다.

### 4.3 기관 운영자

조직이나 기관 내부에서 AI 개발 도구를 배포하고 관리해야 하는 사람에게 필요하다.

예를 들어 다음 상황에 적합하다.

- 사용자의 Claude/Codex 계정을 프로필 단위로 관리해야 한다.
- 내부망 또는 공공기관 환경에서 로컬 실행을 제한해야 한다.
- 배포 파일의 무결성과 서명을 검증해야 한다.
- 감사 담당자에게 작업 증거를 제출해야 한다.

### 4.4 보안 및 감사 담당자

AI가 어떤 데이터를 봤고, 어떤 작업을 했고, 무엇이 차단되었는지 확인해야 하는 사람에게 필요하다.

예를 들어 다음 상황에 적합하다.

- 개인정보 탐지 기록을 확인해야 한다.
- 승인/거부 이력을 확인해야 한다.
- 특정 run의 증거 봉투를 오프라인에서 검증해야 한다.
- 배포 manifest의 서명을 검증해야 한다.

---

## 5. 이 도구가 해결하는 문제

### 5.1 보이지 않는 AI 작업을 보이게 한다

CLI만 사용할 때는 AI가 출력하는 로그를 사람이 직접 읽어야 한다. Harness Pipeline은 작업 상태를 카드, 트랙, 콘솔, run viewer로 보여준다.

### 5.2 위험한 작업을 승인 절차로 묶는다

Bash, Write, Edit 같은 작업은 시스템에 영향을 줄 수 있다. Harness Pipeline은 이런 작업을 승인 카드로 멈춰 세우고, 사용자가 허용해야 진행하도록 만든다.

### 5.3 한 AI의 결과를 다른 AI가 검토하게 한다

Claude가 작성한 계획이나 결과를 Codex에게 비평시키고, 그 비평을 다시 Claude에게 넘기는 review relay를 제공한다.

### 5.4 개인정보와 기관 보안 요구를 반영한다

주민등록번호, 전화번호, 이메일, 카드번호, 사업자등록번호, 운전면허번호, 여권번호 등 한국 환경에서 자주 문제가 되는 개인정보 패턴을 탐지하고 마스킹한다.

### 5.5 감사 가능한 기록을 남긴다

실행, 승인, 거부, 차단, 개인정보 탐지, 원격 hook, review session, 배포 검증 등의 이벤트를 감사 가능한 형태로 남긴다.

---

## 6. 전체 기능 요약

### 6.1 실행 및 배포

- Windows: `harness-start.bat`
- macOS/Linux: `harness-start.sh`
- release zip 기반 실행
- manifest 기반 설치
- SHA256 무결성 검증
- Ed25519 manifest 서명 검증 기능
- offline trust-store 기반 검증

### 6.2 사용자 인터페이스

- Simple UI: 일반 사용자용 카드 중심 화면
- Advanced UI: 개발자용 상세 모니터링 화면
- Legacy mode: 기존 화면 우회
- Harness Track: 작업 단계를 시각적으로 표시
- Dual Agent Console: Claude와 Codex 흐름을 나란히 표시
- Run Viewer: 최근 결과, 리뷰, 승인, 감사 기록을 확인

### 6.3 AI 협업

- Claude 작업 흐름 표시
- Codex 비평 흐름 표시
- review session 생성
- Codex에게 비평 요청
- Codex follow-up 질문
- Claude hand-back
- review session archive

### 6.4 계정 및 프로필

- Claude/Codex 프로필 관리
- active profile 선택
- 계정 테스트
- 공공기관용 profile policy
- credential store 분리

### 6.5 보안과 통제

- write-tool 승인 카드
- PII inline scan
- PII deep file scan
- public-sector mode
- sandbox-only execution
- local executor block
- audit sanitizer
- signed evidence ledger

### 6.6 감사와 증거

- per-run audit read API
- run viewer 감사 섹션
- auditor evidence bundle export
- HMAC-SHA256 sealed JSON envelope
- offline verifier CLI

---

## 7. 일반 사용자용 사용 흐름

### 7.1 처음 실행

1. 배포받은 폴더를 연다.
2. Windows에서는 `harness-start.bat`를 실행한다.
3. macOS/Linux에서는 `harness-start.sh`를 실행한다.
4. 브라우저가 자동으로 열린다.
5. 처음 실행이면 welcome/setup 안내를 따른다.

### 7.2 프로필 설정

1. Claude 또는 Codex 계정을 연결한다.
2. 개인용 또는 기관용 프로필을 만든다.
3. 연결 상태를 테스트한다.
4. active profile을 선택한다.

### 7.3 AI 작업 시작

1. Simple UI에서 현재 상태를 확인한다.
2. Claude에게 작업을 맡긴다.
3. 중요한 결과는 Codex에게 검토시킨다.
4. 위험한 작업은 승인 카드에서 확인한다.
5. 최근 결과 카드에서 작업 결과를 다시 본다.

### 7.4 결과 확인

1. 최근 결과를 클릭한다.
2. Run Viewer에서 실행 요약을 본다.
3. Review 섹션에서 Claude/Codex 검토 흐름을 본다.
4. Approval 섹션에서 승인/거부 이력을 본다.
5. Audit 섹션에서 중요한 보안 이벤트를 확인한다.

---

## 8. 개발자용 사용 흐름

### 8.1 개발자에게 이 도구가 주는 가치

Harness Pipeline은 Claude Code나 Codex CLI를 대체하지 않는다. 두 도구를 더 안전하고 체계적으로 운영하기 위한 상위 레이어다.

개발자는 다음 효과를 얻는다.

- Claude와 Codex의 역할 분리
- 구현과 비평의 반복 루프
- run 단위 상태 추적
- 승인 게이트와 감사 로그
- profile 기반 계정 분리
- 원격 runner와 sandbox 기반 확장

### 8.2 추천 작업 패턴

1. Claude에게 구현 또는 수정 계획을 맡긴다.
2. Codex에게 보안, 정확성, 회귀 위험을 비평하게 한다.
3. 필요한 경우 Claude에게 Codex 비평을 반영하게 한다.
4. 테스트와 검증 결과를 run viewer에서 확인한다.
5. 위험 작업은 approval card로 승인한다.
6. 중요한 작업은 evidence bundle로 보관한다.

### 8.3 개발자용 UI

Advanced UI는 다음 정보를 제공한다.

- run tree
- run summary
- agent tree
- dual agent console
- audit event stream
- approval card
- settings/account panel
- review session stream

---

## 9. 공공기관 및 사내망 사용 흐름

### 9.1 공공기관 모드의 목적

공공기관 모드는 AI가 로컬 PC나 내부 데이터를 임의로 다루지 못하게 하기 위한 정책 모드다.

핵심은 다음과 같다.

- 로컬 executor 차단
- sandbox workspace 요구
- 개인정보 탐지 필수
- write-tool 승인 필수
- 감사 기록 보존
- 서명된 배포물 검증

### 9.2 기관 운영자 첫 설정

1. 기관이 승인한 배포 패키지를 준비한다.
2. manifest 서명을 검증한다.
3. 내부 배포 채널로 사용자에게 전달한다.
4. public-sector profile을 만든다.
5. sandbox runner 또는 기관 승인 작업 공간을 연결한다.
6. PII scanner와 evidence export 기능을 확인한다.

### 9.3 공공기관 모드에서 차단되는 대표 행동

- public-sector 정책에서 금지된 local Claude 실행
- sandbox workspace가 아닌 프로필 실행
- 개인정보가 포함된 prompt dispatch
- 승인되지 않은 Bash/Write/Edit 작업
- 서명 검증되지 않은 배포물 사용

---

## 10. 주요 화면과 UI 모드

### 10.1 Simple UI

일반 사용자용 화면이다. 핵심 정보만 카드로 보여준다.

주요 카드:

- 지금 AI가 하는 일
- 승인 필요
- 최근 결과
- 연결 상태
- 보안 상태

### 10.2 Advanced UI

개발자와 운영자용 화면이다. 더 많은 정보를 보여준다.

주요 영역:

- 작업 흐름
- run 상세
- agent 상태
- Claude/Codex 콘솔
- 감사 로그
- 승인 카드

### 10.3 Harness Track

Harness Track은 작업 단계를 시각적으로 보여준다. 애니메이션은 실제 작업 상태에 연결되어 있으며, 진행 상황을 임의로 꾸며내지 않는다.

대표 단계:

- Plan
- Critique
- Revise
- Re-check
- Execute
- Verify
- Done

### 10.4 Run Viewer

최근 결과를 클릭하면 열리는 상세 화면이다.

섹션:

- 실행 요약
- 리뷰 세션
- 승인 이력
- 감사 로그

---

## 11. Claude와 Codex 협업 기능

### 11.1 Review Relay란 무엇인가

Review Relay는 Claude와 Codex를 단순히 동시에 띄우는 기능이 아니다.

Claude가 만든 계획이나 결과를 Codex에게 비평시키고, 그 비평을 다시 Claude에게 넘겨 수정하도록 만드는 협업 흐름이다.

### 11.2 기본 흐름

1. 운영자가 review session을 시작한다.
2. Claude의 계획이나 결과를 Codex에게 보낸다.
3. Codex가 비평한다.
4. 운영자가 Codex에게 추가 질문을 할 수 있다.
5. 운영자가 비평을 Claude에게 넘긴다.
6. Claude가 수정 작업을 수행한다.
7. 위험 작업이 있으면 승인 카드가 뜬다.

### 11.3 왜 유용한가

한 모델이 놓치는 문제를 다른 모델이 잡을 수 있다.

예를 들어:

- Claude는 구현을 빠르게 진행한다.
- Codex는 변경의 위험, 누락된 테스트, 보안 문제를 비평한다.
- 운영자는 승인 카드와 감사 기록으로 전체 흐름을 통제한다.

---

## 12. 승인 카드와 위험 작업 통제

### 12.1 승인 카드가 필요한 이유

AI가 파일을 수정하거나 명령을 실행하는 것은 강력하지만 위험하다. 잘못된 명령은 파일을 삭제하거나, 보안 정보를 노출하거나, 시스템 상태를 바꿀 수 있다.

Harness Pipeline은 이런 작업을 승인 카드로 멈춰 세운다.

### 12.2 승인 대상

대표적으로 다음 도구가 승인 대상이다.

- Bash
- Write
- Edit

### 12.3 승인 카드에 표시되는 정보

- 요청한 도구
- 요청한 작업 요약
- 대상 run
- PII 탐지 결과
- 요청 시각
- 허용 버튼
- 거부 버튼

### 12.4 기본 정책

- 승인 전 실행 금지
- 시간 초과 시 기본 거부
- 승인 범위는 exact tool + args hash 기준
- public-sector 모드에서는 더 엄격한 fail-closed 정책 적용

---

## 13. 개인정보 탐지와 마스킹

### 13.1 탐지 목적

AI에게 개인정보가 포함된 데이터를 보내면 조직과 기관에 큰 위험이 된다. Harness Pipeline은 prompt dispatch 전과 file import 경계에서 개인정보를 탐지한다.

### 13.2 탐지 대상 예시

- 주민등록번호
- 전화번호
- 이메일
- 신용카드 번호
- 사업자등록번호
- 운전면허번호
- 여권번호

### 13.3 Inline Scan

AI에게 prompt를 보내기 전에 빠르게 검사한다.

표준 모드:

- 개인정보가 있으면 경고
- 정책에 따라 진행 가능

공공기관 모드:

- 개인정보가 있으면 차단
- audit에 `pii_scan_blocked` 기록

### 13.4 Deep File Scan

파일 내용 또는 첨부 데이터처럼 더 깊은 검사가 필요한 경계에서 사용한다.

공공기관 모드에서 개인정보가 발견되면 차단하고, 감사 기록에는 원문이 아니라 마스킹된 샘플만 남긴다.

---

## 14. 감사 기록과 증거 봉투

### 14.1 감사 기록이 필요한 이유

AI 작업은 결과만 중요한 것이 아니다. 누가 어떤 작업을 요청했고, 어떤 작업이 승인되었고, 무엇이 차단되었는지도 중요하다.

Harness Pipeline은 이런 흐름을 audit ledger에 남긴다.

### 14.2 기록되는 대표 이벤트

- run 시작과 종료
- review session 생성
- Codex 비평 요청
- Claude hand-back
- approval requested
- approval granted
- approval denied
- PII scan blocked
- local executor blocked
- manifest signature verification
- evidence bundle export

### 14.3 Evidence Bundle

감사관이나 기관 담당자에게 제출할 수 있는 sealed JSON 봉투다.

특징:

- run 단위 또는 시간 범위 단위 export
- HMAC-SHA256 기반 sealed envelope
- 오프라인 verifier로 검증 가능
- 감사 체인 재현 가능

### 14.4 오프라인 검증

```powershell
node scripts/verify-auditor-bundle.js bundle.json --key <hex>
```

검증에 성공하면 bundle이 변조되지 않았음을 확인할 수 있다.

---

## 15. 배포 패키지와 실행 방식

### 15.1 기본 배포 형태

배포자는 release zip과 manifest를 제공한다.

대표 구성:

```text
harness-pipeline-<version>/
  harness-start.bat
  harness-start.sh
  server.js
  start.js
  node_modules/
  public/
  src/
  scripts/
  docs/
  manifest.json
```

### 15.2 Windows 실행

```powershell
.\harness-start.bat
```

### 15.3 macOS/Linux 실행

```bash
./harness-start.sh
```

### 15.4 필수 조건

- Node.js 24 이상
- 브라우저
- Claude/Codex CLI 또는 기관용 runner 구성
- 기관 배포 시 trust store

### 15.5 설치 방식

두 가지 방식이 있다.

1. Full release zip
   - 모든 파일이 포함된 패키지
   - `server.js`가 있으면 바로 실행

2. Bootstrap launcher
   - manifest URL을 통해 release zip을 가져옴
   - SHA256 및 signature 검증 후 설치

---

## 16. 서명된 manifest와 오프라인 검증

### 16.1 왜 manifest 서명이 필요한가

SHA256은 파일이 manifest에 적힌 값과 같은지 확인한다. 하지만 manifest 자체가 공격자에 의해 바뀌었다면 SHA256만으로는 충분하지 않다.

따라서 manifest는 배포자의 private key로 서명하고, 사용자는 public trust store로 검증해야 한다.

### 16.2 키 생성

```powershell
node scripts/sign-manifest.js genkey --out keys/
```

생성물 예시:

- `keys/private.pem`
- `keys/public.json`
- `keys/keypair.json`

### 16.3 manifest 서명

```powershell
node scripts/sign-manifest.js sign --manifest manifest.json --private-key keys/private.pem --key-id <id>
```

### 16.4 manifest 검증

```powershell
node scripts/sign-manifest.js verify --manifest manifest.json --trust-store keys/public.json
```

또는 launcher CLI hook을 사용할 수 있다.

```powershell
node scripts/launcher/launcher-cli.js verify-manifest-signature manifest.json --trust-store keys/public.json
```

### 16.5 현재 주의사항

Ed25519 manifest signing 기능과 launcher CLI 검증 hook은 제공된다.

다만 배치 런처의 `install-version.ps1` 및 `install-version.sh` 내부에서 signature gate를 완전히 강제하는 통합은 후속 작업으로 남아 있을 수 있다. 기관 배포 시에는 설치 전에 위 검증 명령을 운영 절차에 포함해야 한다.

### 16.6 sign-manifest.js 명령 인라인 참조

```text
Usage:
  node scripts/sign-manifest.js genkey [--out <dir>]
  node scripts/sign-manifest.js sign --manifest <path> --private-key <pem> --key-id <id> [--out <path>]
  node scripts/sign-manifest.js verify --manifest <path> --trust-store <json>

Exit codes:
  0   command succeeded (verify: signature PASS)
  1   verify FAILED
  2   config error (missing arg / file missing / parse error)
```

### 16.7 공공기관 운영자 시나리오

기관 배포에서는 다음 순서로 동작한다:
1. 발행자가 `genkey`로 keypair 생성 → private는 발행자 보관, public.json만 운영자에게 전달.
2. 운영자가 dashboard 설정 모달 (TRUST-STORE-0 라운드 후) 또는 직접 `~/.harness/trust-store.json`에 public key 등록.
3. 발행자가 release zip 생성 후 `sign --manifest manifest.json --private-key private.pem --key-id <id>`로 서명.
4. 운영자가 launcher 실행 → SHA256 검증 + signature 검증 (E3-F1 라운드 후 자동) → install.
5. 알 수 없는 keyId 또는 unsigned manifest는 fail-closed로 install 거부 (public-sector 모드 기본값).

### 16.8 E3-F1 launcher gate 통합 후 변경되는 절차 (preview)

E3-F1 라운드가 마감되면:
- `install-version.ps1` + `install-version.sh`가 SHA256 검증 직후에 signature 검증을 자동 수행 (수동 명령 불필요).
- production posture에서 unsigned manifest = exit 37 (install 거부), 알 수 없는 keyId = exit 38.
- dev escape `HARNESS_ALLOW_UNSIGNED_MANIFEST=1`은 standard 모드에서만 허용 + LOUD warning + audit chain 기록; public-sector 모드는 escape 무시.
- trust-store path resolver는 `HARNESS_TRUST_STORE` env > `HARNESS_CONFIG_DIR/trust-store.json` > Windows AppData / Mac Library / Linux ~/.config 순서로 결정 — UI와 launcher가 같은 resolver 사용으로 single source of truth 보장.

---

## 17. 시스템 구성 요소

### 17.1 Launcher

역할:

- Node.js 확인
- 설치 모드 결정
- manifest 검증
- release zip 다운로드
- SHA256 검증
- 서버 실행
- 브라우저 열기

### 17.2 Dashboard Server

역할:

- API 제공
- runner 관리
- review session 관리
- approval 관리
- audit export 제공
- profile 관리

### 17.3 Web Dashboard

역할:

- Simple UI
- Advanced UI
- Run Viewer
- Dual Agent Console
- Approval Card
- Settings Panel

### 17.4 Profile and Credential Store

역할:

- Claude/Codex 계정 설정
- active profile 관리
- credential backend 분리
- 공공기관 정책 검증

### 17.5 Review Session Manager

역할:

- Claude와 Codex 사이의 review session 상태 관리
- stream chunk 라우팅
- session archive
- review audit 기록

### 17.6 Review Spawn Dispatcher

역할:

- `send-codex` 요청을 실제 Codex runner 실행으로 연결
- `hand-back-claude` 요청을 실제 Claude runner 실행으로 연결
- in-flight 중복 실행 차단
- dispatch audit 기록

### 17.7 Approval Manager

역할:

- 위험 도구 실행 승인 요청 생성
- 허용/거부/시간 초과 처리
- approval audit 기록

### 17.8 PII Scanner

역할:

- 개인정보 탐지
- 마스킹 샘플 생성
- inline/deep scan 구분

### 17.9 Evidence Ledger

역할:

- 감사 이벤트 저장
- 변조 탐지 가능한 체인 유지
- evidence bundle export에 사용

### 17.10 Manifest Signer

역할:

- Ed25519 key 생성
- manifest 서명
- trust store 기반 검증

---

## 18. 보안 설계 원칙

### 18.1 Default Off

위험한 기능은 기본으로 꺼져 있어야 한다. 원격 실행, dispatch, write-tool 승인 등은 명시적 설정과 정책을 통해 켠다.

### 18.2 Allowlist Only

허용된 hook과 tool만 통과한다. 모르는 입력은 거부한다.

### 18.3 Fail Closed

공공기관 모드에서 scanner나 policy 판단이 실패하면 안전한 방향으로 차단한다.

### 18.4 Human Approval

파일 수정이나 명령 실행처럼 위험한 작업은 사람이 승인해야 한다.

### 18.5 Auditability

중요한 판단은 감사 기록에 남긴다.

### 18.6 PII Minimization

감사 로그에는 원문 개인정보를 남기지 않는다. 마스킹된 샘플과 finding type만 남긴다.

### 18.7 Signed Distribution

배포물은 manifest signature와 trust store로 검증할 수 있어야 한다.

---

## 19. 공공기관용 보안 모델

공공기관용 보안 모델은 다섯 겹의 trust property로 구성된다.

### 19.1 Sandbox-only Execution

로컬 PC에서 직접 작업하지 않도록 제한한다. 기관 정책에 맞는 sandbox workspace를 요구한다.

### 19.2 Inline PII Gate

AI provider로 prompt가 dispatch되기 전에 개인정보를 검사한다.

### 19.3 Deep File Import Scan

파일 또는 첨부 데이터가 들어오는 경계에서 더 깊은 개인정보 검사를 수행한다.

### 19.4 Sealed Evidence Export

감사관에게 제출 가능한 sealed evidence bundle을 생성한다.

### 19.5 Signed Manifest Distribution

배포 manifest를 Ed25519 서명으로 검증한다.

---

## 20. 운영자 체크리스트

### 20.1 배포 전

- release zip 준비
- manifest 작성
- SHA256 확인
- manifest 서명
- trust store 준비
- operator guide 포함
- distribution guide 포함
- Node.js 요구 버전 명시

### 20.2 설치 전

- 배포 채널 확인
- manifest signature 검증
- SHA256 검증
- trust store keyId 확인
- public-sector 배포 여부 확인

### 20.3 실행 후

- `/api/health` 정상 확인
- 브라우저 자동 오픈 확인
- profile 설정 확인
- Claude/Codex 연결 테스트
- security status card 확인
- approval card 동작 확인
- evidence export 동작 확인

---

## 21. 개발자 체크리스트

### 21.1 로컬 개발

- `npm test`
- `npm run test:integration`
- `npm run test:smoke`
- `npm run readiness:check`
- `npm run scorecard:check`

### 21.2 UI 변경 시

- Simple UI 확인
- Advanced UI 확인
- public-sector posture 확인
- reduced-motion 확인
- 작은 화면에서 텍스트 겹침 확인

### 21.3 보안 변경 시

- audit sanitizer 확인
- PII sample raw value 미노출 확인
- fail-closed path 확인
- public-sector block path 확인
- approval timeout 확인

### 21.4 배포 변경 시

- manifest schema 확인
- SHA256 mismatch quarantine 확인
- signature mismatch 실패 확인
- trust-store unknown key 실패 확인

---

## 22. 감사관 체크리스트

### 22.1 Run 단위 확인

- runId
- 작업 시작/종료 시각
- review session 이력
- approval 이력
- PII scan 결과
- 차단된 작업
- evidence bundle seal

### 22.2 Evidence Bundle 검증

```powershell
node scripts/verify-auditor-bundle.js bundle.json --key <hex>
```

검증할 항목:

- seal 유효성
- runId 일치
- export 시간
- audit row 수
- redacted sample 여부
- raw PII 미포함 여부

### 22.3 Manifest 검증

```powershell
node scripts/sign-manifest.js verify --manifest manifest.json --trust-store keys/public.json
```

검증할 항목:

- keyId
- key label
- coverage field
- signature value
- publishedAt
- version
- sha256

---

## 23. 자주 묻는 질문

### Q1. Harness Pipeline은 Claude Code나 Codex를 대체하나요?

아니다. Harness Pipeline은 Claude Code와 Codex를 더 안전하고 체계적으로 사용하기 위한 운영 대시보드다.

### Q2. 일반 사용자도 사용할 수 있나요?

가능하다. Simple UI는 일반 사용자가 현재 상태, 승인 필요 작업, 최근 결과, 연결 상태를 쉽게 볼 수 있도록 설계되어 있다.

### Q3. 개발자는 왜 이 도구를 써야 하나요?

Claude와 Codex를 따로 쓰는 것보다, 구현과 비평을 하나의 흐름으로 묶을 수 있다. 또한 승인, 감사, 보안 정책을 함께 관리할 수 있다.

### Q4. 개인정보가 AI에게 전달되는 것을 막을 수 있나요?

공공기관 모드에서는 prompt dispatch 전과 file import 경계에서 개인정보를 탐지하고 차단한다. 표준 모드에서는 정책에 따라 경고로 처리할 수 있다.

### Q5. 인터넷이 없는 내부망에서도 사용할 수 있나요?

오프라인 배포 패키지와 trust store를 함께 제공하면 내부망 배포 흐름을 구성할 수 있다. 단, Claude/Codex provider 사용 방식은 기관 정책과 계정 구성에 따라 달라진다.

### Q6. 배포 파일이 진짜인지 어떻게 확인하나요?

manifest의 SHA256과 Ed25519 signature를 검증한다. 기관 배포 시 trust store에 등록된 public key로 검증해야 한다.

### Q7. 감사관에게 무엇을 제출할 수 있나요?

특정 run 또는 시간 범위에 대한 sealed evidence bundle을 제출할 수 있다. 감사관은 offline verifier로 변조 여부를 확인할 수 있다.

### Q8. 이 도구가 AI를 더 똑똑하게 만드나요?

모델 자체를 바꾸지는 않는다. 하지만 Claude와 Codex가 서로 검토하고, 품질 게이트와 승인 절차를 거치게 만들어 결과적으로 더 신중하고 안정적인 작업 결과를 만들 수 있다.

---

## 24. 현재 제한사항과 후속 작업

### 24.1 현재 제한사항

- 일부 배포 환경에서는 SmartScreen 또는 조직 보안 정책에 의해 첫 실행 경고가 나타날 수 있다.
- Ed25519 manifest signature 기능은 제공되지만, 모든 launcher shell 경로에서 강제 통합되었는지는 배포 버전별로 확인해야 한다.
- 공공기관 운영 배포에서는 기관별 trust store, sandbox runner, account policy를 별도로 확정해야 한다.
- 장기 작업 기억과 자동 리뷰 추천 기능은 후속 Smart Operations Layer에서 다룬다.

### 24.2 권장 후속 작업

- Launcher signature gate full integration
- Trust-store management UI
- Run Viewer export button
- Real Claude hand-back live evidence
- Smart decision context foundation
- Review recommendation cards
- Policy-backed quality gates
- Expert review presets
- Redacted run memory
- Institutional policy packs

---

## 25. 용어 사전

### Harness Pipeline

AI 작업을 실행, 관찰, 검토, 승인, 기록하는 대시보드.

### Claude

구현, 수정, 계획 작성 등에 사용하는 AI CLI 실행 주체.

### Codex

비평, 검토, 오류 분석, 대안 제시에 사용하는 AI CLI 실행 주체.

### Run

하나의 작업 실행 단위.

### Review Session

Claude와 Codex 사이의 검토 흐름을 묶는 세션.

### Approval Card

위험 작업을 사람이 허용하거나 거부하는 UI 카드.

### PII

개인정보 또는 개인을 식별할 수 있는 정보.

### Evidence Bundle

감사관에게 제출할 수 있는 sealed JSON 증거 봉투.

### Manifest

배포 버전, URL, SHA256, 최소 Node 버전, signature 등을 담는 배포 메타데이터.

### Trust Store

배포 manifest 서명을 검증하기 위해 신뢰하는 public key 목록.

### Public-sector Mode

공공기관 또는 강한 보안 정책이 필요한 환경을 위한 실행 정책.

---

## 26. 부록: 주요 명령어

### 26.1 Windows 실행

```powershell
.\harness-start.bat
```

### 26.2 macOS/Linux 실행

```bash
./harness-start.sh
```

### 26.3 manifest key 생성

```powershell
node scripts/sign-manifest.js genkey --out keys/
```

### 26.4 manifest 서명

```powershell
node scripts/sign-manifest.js sign --manifest manifest.json --private-key keys/private.pem --key-id <id>
```

### 26.5 manifest 검증

```powershell
node scripts/sign-manifest.js verify --manifest manifest.json --trust-store keys/public.json
```

### 26.6 launcher CLI signature 검증

```powershell
node scripts/launcher/launcher-cli.js verify-manifest-signature manifest.json --trust-store keys/public.json
```

### 26.7 감사 봉투 검증

```powershell
node scripts/verify-auditor-bundle.js bundle.json --key <hex>
```

### 26.8 테스트

```powershell
npm test
npm run test:integration
npm run test:smoke
npm run readiness:check
npm run scorecard:check
```

### 26.9 PDF 변환 예시

Markdown 원본을 PDF로 변환할 때는 조직의 문서 표준에 맞는 도구를 사용한다. 예를 들어 `pandoc`이 설치되어 있다면 다음과 같이 변환할 수 있다.

```powershell
pandoc docs/harness-pipeline-distribution-guide.md -o Harness-Pipeline-Guide.pdf
```

PDF로 배포할 때도 Markdown 원본을 함께 보관하는 것을 권장한다.

---

## 결론

Harness Pipeline은 AI를 더 편하게 쓰기 위한 단순 UI가 아니다.

이 도구는 AI 작업을 사람이 이해할 수 있는 흐름으로 만들고, 위험한 행동을 승인 절차로 묶고, 개인정보와 감사 요구를 반영하며, Claude와 Codex가 서로 검토하는 작업 구조를 제공한다.

개인 개발자에게는 더 안전한 AI 협업 환경을 제공하고, 조직과 공공기관에는 통제 가능한 AI 운영 체계를 제공한다.

