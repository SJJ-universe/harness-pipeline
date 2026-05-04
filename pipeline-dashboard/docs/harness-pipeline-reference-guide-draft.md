# Harness Pipeline 전공서형 통합 가이드 초안

> 상태: 초안 v0.1
>
> 작성 기준일: 2026-05-04
>
> 목적: Harness Pipeline을 일반 사용자, 개발자, 기관 운영자, 보안 담당자, 감사 담당자가 모두 참고할 수 있는 장문형 제품 참고서로 발전시키기 위한 마스터 원고 초안이다.
>
> 주의: 이 문서는 구현이 진행 중인 제품을 설명한다. 각 장은 "현재 지원", "진행 중", "추가 작성 필요"를 분리하여 사실관계가 섞이지 않도록 관리한다.

---

## 0. 이 문서의 작성 원칙

이 가이드는 단순한 사용 설명서가 아니다. Harness Pipeline이 왜 만들어졌고, 어떤 문제를 해결하며, 어떤 보안·운영·감사 원칙 위에서 동작하는지를 설명하는 제품 참고서다. 따라서 각 장은 기능 목록만 나열하지 않고, 그 기능이 필요한 배경과 실제 운영에서의 의미를 함께 설명해야 한다.

모든 장은 다음 구조를 기본으로 한다.

1. 개념 정의
2. 문제 배경
3. Harness Pipeline에서의 구현 방식
4. 일반 사용자 시나리오
5. 개발자 시나리오
6. 공공기관 및 사내망 시나리오
7. 보안·감사 관점
8. 현재 한계
9. 추가 작성 필요
10. 확인 체크리스트

이 구조를 반복하면 독자가 어느 장을 펼쳐도 같은 방식으로 이해할 수 있다. 특히 공공기관 배포를 염두에 두므로, "편리하다"보다 "통제 가능하다", "설명 가능하다", "검증 가능하다"는 관점이 더 중요하다.

### 추가 작성 필요

- 실제 배포 버전 번호와 guide versioning 정책.
- PDF 변환 시 표지, 목차, 페이지 번호, 변경 이력 형식.
- 각 장의 최종 책임 독자 지정: 일반 사용자, 개발자, 운영자, 보안 담당자, 감사관.

---

## 1. 핵심 결론: Harness Pipeline은 무엇인가

Harness Pipeline은 Claude Code와 Codex 같은 AI CLI 도구를 더 안전하고 체계적으로 운영하기 위한 AI 작업 운영 계층이다. 이 도구는 AI 모델 자체를 대체하지 않는다. 대신 AI가 수행하는 작업을 사람이 볼 수 있고, 멈출 수 있고, 검토할 수 있고, 기록할 수 있는 구조로 바꾼다.

일반적인 CLI 환경에서는 사용자가 터미널을 열고 AI에게 작업을 요청한 뒤, 긴 로그를 직접 읽으며 진행 상황을 판단해야 한다. 작업이 짧을 때는 이 방식도 충분하다. 그러나 작업이 길어지고, 여러 파일을 수정하고, 테스트와 리뷰를 반복하고, 보안 정책까지 고려해야 하는 순간부터 CLI 로그만으로는 부족해진다.

Harness Pipeline은 이 문제를 대시보드, 승인 카드, 감사 로그, review relay, profile, sandbox, PII scan, evidence bundle, signed distribution으로 해결한다. 핵심은 "AI에게 일을 시키는 것"이 아니라 "AI가 하는 일을 운영 가능한 절차로 만드는 것"이다.

### 추가 작성 필요

- "Claude Code/Codex CLI만 사용할 때"와 "Harness Pipeline을 사용할 때"를 비교하는 표.
- 비개발자도 이해할 수 있는 한 문장 정의.
- 공공기관 제안서에 넣을 수 있는 짧은 정의.

---

## 2. 왜 이 도구가 필요한가

AI CLI 도구는 강력하다. 파일을 읽고, 코드를 수정하고, 명령을 실행하고, 테스트를 돌릴 수 있다. 그러나 강력한 도구일수록 조직에서 도입할 때는 더 많은 질문을 받는다. 어떤 파일을 봤는가, 어떤 명령을 실행했는가, 개인정보가 포함된 데이터가 외부로 나갔는가, 누가 위험 작업을 승인했는가, 나중에 감사할 수 있는가 같은 질문이다.

Harness Pipeline은 이 질문들에 답하기 위해 만들어졌다. 이 도구는 AI 사용을 무조건 제한하는 것이 아니라, AI 사용을 허용할 수 있는 조건을 만든다. 사용자는 AI에게 작업을 맡기되, 위험한 순간에는 승인 카드로 멈춰 세울 수 있다. 개발자는 Claude가 작성한 결과를 Codex에게 비평하게 하고, 그 비평을 다시 Claude에게 넘길 수 있다. 운영자는 실행 기록과 감사 이벤트를 남길 수 있다. 감사관은 evidence bundle을 오프라인에서 검증할 수 있다.

이 도구의 필요성은 특히 세 가지 상황에서 뚜렷하다.

첫째, AI 작업이 길고 복잡해지는 경우다. 단일 prompt로 끝나는 작업이 아니라 계획, 구현, 테스트, 비평, 수정, 검증이 반복되는 작업에서는 흐름을 시각화하고 기록하는 장치가 필요하다.

둘째, 보안과 개인정보가 중요한 환경이다. 공공기관, 금융, 의료, 교육, 내부망 환경에서는 AI가 임의로 데이터를 외부 provider에 전달해서는 안 된다. prompt dispatch 전 PII scan과 file import deep scan은 이런 환경에서 최소한의 방어선이다.

셋째, 배포와 감사가 필요한 제품 환경이다. 개인 개발자의 실험 도구라면 "내 PC에서 잘 된다"로 충분할 수 있다. 그러나 배포용 제품은 설치 파일의 무결성, manifest 서명, trust store, 운영자 가이드, OSS 고지, 장애 대응 절차까지 필요하다.

### 추가 작성 필요

- 실제 사용자 시나리오 3개: 개인 개발자, 팀 리드, 공공기관 보안 담당자.
- "AI 사용 금지"와 "통제 가능한 AI 사용"의 차이를 설명하는 도식.
- 기관 제안서용 요약 문단.

---

## 3. 제품 구성 개요

Harness Pipeline은 여러 계층으로 구성된다. 가장 바깥에는 사용자가 보는 웹 대시보드가 있다. 대시보드는 Simple/Pro 모드, Harness Track, pipeline rail, monitor grid, dual terminal, approval card, run viewer를 제공한다. 그 아래에는 Node.js 기반 dashboard server가 있으며, profile, credential, review session, approval, audit, security scan, trust store API를 제공한다.

AI 실행 계층에는 ClaudeRunner와 CodexRunner가 있다. 이들은 Claude Code와 Codex CLI를 child process 또는 pty 기반 실행 주체로 다루며, profile-aware spawn env, PII gate, public-sector policy, reviewSessionId hint, audit emission과 연결된다.

보안 계층에는 danger gate, PII scanner, publicSectorPolicy, audit sanitizer, evidence ledger, manifest signer, trust store가 있다. 이 계층은 AI 실행 전후의 위험 지점을 통제한다. 배포 계층에는 `harness-start.bat`, `harness-start.sh`, launcher CLI, install-version script, check-update script, manifest signing 도구가 있다.

이 구조에서 중요한 것은 각 계층이 서로 다른 책임을 갖는다는 점이다. UI는 보여주고 조작하게 한다. server는 상태와 정책을 조합한다. runner는 AI CLI를 실행한다. security module은 위험을 판단한다. ledger는 나중에 설명할 수 있는 기록을 남긴다. launcher는 배포물을 안전하게 시작한다.

### 추가 작성 필요

- 전체 아키텍처 Mermaid 다이어그램.
- 계층별 대표 파일 목록.
- "일반 실행 흐름"과 "공공기관 실행 흐름" 시퀀스 다이어그램.

---

## 4. 일반 사용자용 설명

일반 사용자에게 Harness Pipeline은 "AI 작업을 눈으로 보면서 맡기는 화면"이다. 사용자는 터미널 명령을 몰라도 AI가 지금 무엇을 하고 있는지, 승인이 필요한지, 최근 결과가 무엇인지 확인할 수 있어야 한다.

일반 사용자의 기본 흐름은 단순해야 한다. 배포받은 폴더에서 시작 파일을 실행한다. 브라우저가 열린다. 계정 또는 프로필을 설정한다. Simple UI에서 연결 상태와 보안 상태를 확인한다. AI에게 작업을 맡긴다. 위험 작업이 나타나면 승인 카드에서 확인한다. 작업이 끝나면 최근 결과를 열어 요약과 리뷰를 확인한다.

일반 사용자용 설명에서는 내부 구현 용어를 최소화해야 한다. 예를 들어 "review_session_dispatch_started" 같은 표현보다 "Codex 검토가 시작되었습니다"가 낫다. "PII gate blocked"보다 "개인정보가 포함되어 AI 전송이 차단되었습니다"가 낫다.

### 추가 작성 필요

- 처음 실행 화면 설명.
- Simple UI 각 카드별 설명.
- 승인 카드에서 사용자가 봐야 할 항목.
- "무엇을 눌러야 하는가" 중심의 단계별 이미지 캡션.
- 자주 겪는 상황: 연결 실패, 승인 대기, 개인정보 차단, 작업 실패.

---

## 5. 개발자용 작업 흐름

개발자에게 Harness Pipeline은 AI pair programming을 운영 절차로 바꾸는 도구다. 개발자는 Claude Code와 Codex CLI를 이미 직접 사용할 수 있다. 따라서 Harness Pipeline의 가치는 단순히 CLI를 웹으로 보여주는 데 있지 않다. 핵심 가치는 구현과 비평을 분리하고, 그 과정을 run 단위로 추적하며, 위험 작업과 보안 이벤트를 기록하는 데 있다.

권장 패턴은 Claude가 작성하고 Codex가 비평하는 흐름이다. Claude에게 구현 계획이나 코드 수정을 맡긴다. Codex에게 그 결과를 보안, 정확성, 회귀 위험, 테스트 누락 관점에서 비평하게 한다. Codex 비평이 의미 있다면 Claude에게 다시 hand-back하여 반영하게 한다. 이때 Harness Pipeline은 review session, dual terminal, action row, audit event로 흐름을 묶는다.

개발자는 이 구조를 통해 단일 모델의 자기확신 문제를 줄일 수 있다. 한 모델이 놓친 위험을 다른 모델이 지적할 수 있고, 운영자는 그 과정에서 어떤 판단이 있었는지 나중에 확인할 수 있다.

### 추가 작성 필요

- Claude -> Codex -> Claude 실제 예시 대화.
- 코드 리뷰 finding 예시.
- 테스트 실패를 Codex가 지적하고 Claude가 수정하는 예시.
- 일반 CLI 복사/붙여넣기 방식과 Harness review relay 방식 비교.

---

## 6. UI와 디자인 원칙

Harness Pipeline의 UI는 참조 HTML 디자인을 visual source of truth로 삼아야 한다. 이전 접근은 기존 dashboard 위에 디자인 토큰과 일부 monitor panel을 얹는 방식이었다. 그러나 배포용 제품의 첫인상 관점에서는 충분하지 않다. 앞으로의 UI productization은 참조 HTML의 모양새를 먼저 맞추고, 기존 기능을 그 안으로 이식하는 순서로 진행해야 한다.

참조 디자인의 핵심 요소는 상단 header, Simple/Pro toggle, Harness Track, 좌측 pipeline rail, 중앙 monitor grid, 하단 dual terminals, 말 sprite animation이다. 이 구조는 단순히 예쁜 화면이 아니라 제품의 사용 철학을 드러낸다. 사용자는 전체 작업 흐름을 한 화면에서 보고, Claude와 Codex의 역할 분리를 직관적으로 이해하며, AI 작업이 단계적으로 진행된다는 느낌을 받는다.

기능 이식 순서는 모양, 말 animation, mode toggle, pipeline rail, monitor cards, dual terminals, review relay actions, approval card, run viewer, audit/evidence export, security posture, skill recommendation 순서가 바람직하다. 기능을 먼저 붙이면 기존 dashboard의 구조가 새 디자인을 끌고 가기 쉽다. 반대로 화면 구조를 먼저 고정하면 기능은 그 구조 안으로 자연스럽게 들어온다.

### 추가 작성 필요

- 참조 HTML 스크린샷과 제품 UI 스크린샷 비교.
- `SJ Harness Dashboard.html`의 구성 요소별 porting 표.
- `horse-frames.png` sprite 이식 방식.
- Simple/Pro 모드별 화면 요구사항.
- legacy dashboard 유지 정책: 기본 아님, 호환 모드.

---

## 7. Claude와 Codex 협업 구조

Harness Pipeline의 대표 기능 중 하나는 Claude와 Codex를 협업시킬 수 있다는 점이다. 여기서 협업은 두 터미널을 동시에 여는 수준이 아니다. 작성자와 검토자를 분리하는 작업 구조다.

Claude는 구현, 계획, 수정, hand-back 반영에 강점을 둘 수 있다. Codex는 계획 비평, 위험 분석, 보안 검토, 회귀 가능성 지적, 테스트 누락 탐지에 사용할 수 있다. Harness Pipeline은 이 둘 사이에 review session을 두어 어떤 결과가 어떤 비평으로 이어졌는지 기록한다.

Dual Agent Console은 이 흐름을 시각화한다. 왼쪽에는 Claude 흐름, 오른쪽에는 Codex 흐름을 배치할 수 있다. 운영자는 "Codex에게 검토 요청", "추가 질문", "Claude에게 돌려보내기", "보관" 같은 구조화된 action을 수행한다. 이렇게 하면 AI 협업이 ad hoc 대화가 아니라 추적 가능한 workflow가 된다.

### 추가 작성 필요

- review session 상태 전이표.
- 5개 action endpoint 설명.
- 공공기관 모드에서 Claude hand-back 제한되는 경우.
- 실제 live verification 증거 연결.

---

## 8. 승인 카드와 위험 작업 통제

AI가 파일을 수정하거나 명령을 실행하는 기능은 생산성을 크게 높이지만 동시에 가장 큰 위험 지점이다. Harness Pipeline의 approval card는 이 위험을 사람이 판단할 수 있는 순간으로 만든다.

Bash, Write, Edit 같은 tool request는 시스템 상태를 바꿀 수 있다. 따라서 승인 전에는 실행되지 않아야 한다. 승인 카드에는 tool 이름, 작업 요약, 대상 run, argument hash, PII scan 결과, 요청 시각, 허용/거부 버튼이 표시되어야 한다. 승인 범위는 exact tool + args hash에 묶어야 하며, 승인 이후 AI가 다른 인자로 같은 tool을 실행하려 하면 다시 승인받아야 한다.

공공기관 모드에서는 approval card가 더 중요하다. 사용자는 단순히 편의를 위해 승인하는 것이 아니라 기관 정책에 맞는지 확인하는 역할을 한다. 시간 초과 시 기본 거부, PII 포함 시 차단, local executor 금지 같은 정책과 결합되어야 한다.

### 추가 작성 필요

- approval lifecycle 다이어그램.
- 승인/거부/시간초과 audit verb 목록.
- 위험 tool별 설명: Bash, Write, Edit.
- 사용자에게 보여줄 안전한 요약문 생성 규칙.

---

## 9. 개인정보 탐지와 마스킹

AI 작업에서 개인정보는 가장 민감한 데이터 경계다. 사용자가 의도하지 않게 주민등록번호, 전화번호, 이메일, 카드번호, 사업자등록번호, 운전면허번호, 여권번호가 포함된 prompt나 파일을 AI에게 전달할 수 있다. Harness Pipeline은 이 위험을 inline scan과 deep file scan으로 나눠 다룬다.

Inline scan은 prompt가 AI provider로 dispatch되기 전에 빠르게 검사한다. 표준 모드에서는 경고로 처리할 수 있고, 공공기관 모드에서는 차단으로 처리한다. Deep file scan은 파일 import 또는 첨부 데이터처럼 더 깊은 검사가 필요한 경계에서 사용한다. 검사 결과는 audit ledger에 남기되, 원문 개인정보를 남기지 않고 마스킹된 샘플과 finding type만 남겨야 한다.

성능 관점에서는 모든 입력을 무겁게 검사할 수 없다. 따라서 inline scan은 빠른 패턴 중심으로, deep scan은 명시적 file import boundary에서 더 정밀하게 수행하는 계층화가 필요하다. 공공기관 환경에서는 scanner failure가 곧 allow가 아니라 block으로 이어져야 한다.

### 추가 작성 필요

- PII pattern별 탐지 방식 설명.
- 사업자등록번호 check digit 설명.
- false positive/false negative 한계.
- 성능과 chunking 정책.
- 감사 로그에 남겨도 되는 데이터와 안 되는 데이터 표.

---

## 10. 감사 기록과 Evidence Bundle

조직에서 AI 작업을 운영하려면 결과물뿐 아니라 과정이 남아야 한다. 누가 어떤 작업을 요청했는지, 어떤 AI가 어떤 비평을 했는지, 어떤 tool request가 승인되었는지, 어떤 개인정보가 탐지되어 차단되었는지, 배포 파일은 검증되었는지를 나중에 설명할 수 있어야 한다.

Harness Pipeline은 audit ledger를 통해 이런 사건을 기록한다. audit event는 단순 로그가 아니라 운영과 감사의 공통 언어다. 예를 들어 `pii_scan_blocked`, `local_executor_blocked`, `review_session_dispatch_started`, `approval_granted`, `evidence_bundle_exported` 같은 이벤트는 나중에 run 단위로 재구성될 수 있다.

Evidence Bundle은 감사관에게 제출할 수 있는 sealed JSON 봉투다. run 단위 또는 시간 범위 단위로 export할 수 있으며, HMAC-SHA256 seal을 통해 파일이 생성 이후 변조되지 않았음을 오프라인에서 검증할 수 있다. 감사관은 운영 서버에 직접 접속하지 않고도 bundle과 key를 받아 검증할 수 있다.

### 추가 작성 필요

- audit verb taxonomy 전체 표.
- Evidence Bundle JSON schema.
- offline verifier 사용 예시.
- 감사관 제출 시나리오.
- HMAC seal과 Ed25519 manifest signature의 차이 설명.

---

## 11. 배포와 실행 모델

Harness Pipeline은 배포용 제품으로서 단일 배치파일 또는 shell script를 통해 실행될 수 있어야 한다. 사용자가 Docker image를 직접 다루지 않아도 실행할 수 있어야 하며, Windows 환경에서는 `harness-start.bat`, macOS/Linux 환경에서는 `harness-start.sh`가 진입점이 된다.

런처는 Node.js 버전을 확인하고, 설치 모드를 판단하고, 이미 실행 중인 Harness 서버가 있는지 health check로 확인한다. 서버가 없으면 supervisor를 시작하고, health check가 성공하면 브라우저를 연다. 배포 환경에서는 기본 URL이 제품 UI로 열려야 하며, legacy dashboard는 호환 모드로 남기는 것이 바람직하다.

설치 방식은 full release zip과 bootstrap launcher로 나뉜다. Full release zip은 필요한 파일이 모두 포함된 패키지다. Bootstrap launcher는 manifest URL을 읽고 release zip을 내려받은 뒤 SHA256과 signature를 검증한다. 공공기관 배포에서는 offline trust store와 signed manifest가 필수에 가깝다.

### 추가 작성 필요

- Windows 실행 절차 상세.
- macOS/Linux 실행 절차 상세.
- 배포 폴더 구조.
- launcher exit code 표.
- SmartScreen/조직 보안 경고 대응 문구.

---

## 12. 서명, Manifest, Trust Store

배포 보안에서 SHA256은 필요한 조건이지만 충분조건은 아니다. SHA256은 파일이 manifest에 적힌 값과 일치하는지 확인한다. 그러나 manifest 자체가 공격자에 의해 바뀌면 SHA256도 함께 바뀔 수 있다. 따라서 manifest는 배포자의 private key로 서명하고, 사용자는 trust store에 등록된 public key로 검증해야 한다.

Harness Pipeline의 signed distribution 모델은 Ed25519 detached manifest signing을 사용한다. 발행자는 private key로 manifest에 서명하고, 운영자는 public key를 trust store에 등록한다. 설치 시 launcher는 manifest signature를 검증하고, 알 수 없는 keyId 또는 unsigned manifest를 거부해야 한다.

이 영역은 최근 review finding에서도 중요한 개선점으로 지적되었다. HTTPS이기 때문에 unsigned manifest를 warn-only로 허용하는 방식은 배포 신뢰성에 약하다. production/install 경로에서는 기본적으로 fail-closed가 안전하며, 개발 예외는 `HARNESS_ALLOW_UNSIGNED_MANIFEST=1`처럼 명시적이고 감사 가능한 escape로 제한해야 한다.

### 추가 작성 필요

- Ed25519 서명 절차.
- trust-store path resolver 정책.
- unknown key, invalid signature, missing signature별 exit code.
- UI trust-store management와 launcher 검증의 single source of truth.
- public-sector fail-closed 정책.

---

## 13. 공공기관 및 사내망 보안 모델

공공기관용 Harness Pipeline은 "AI를 편하게 쓰는 도구"가 아니라 "AI 사용을 통제 가능한 조건에서 허용하는 도구"로 설명해야 한다. 기관망과 사내망에서는 개인정보, 내부 문서, 행정망 분리, 감사 추적, 배포 승인 절차가 매우 중요하다.

공공기관 모드의 핵심은 다섯 겹의 방어다. 첫째, local executor를 금지하고 sandbox-only execution을 요구한다. 둘째, prompt dispatch 전 inline PII gate를 수행한다. 셋째, file import boundary에서 deep PII scan을 수행한다. 넷째, 위험 tool은 approval card를 통해 사람 승인을 요구한다. 다섯째, audit ledger와 sealed evidence export를 통해 나중에 감사 가능한 기록을 남긴다.

배포 관점에서는 signed manifest와 offline trust store가 중요하다. 기관은 승인된 public key만 trust store에 등록하고, 배포물은 해당 key로 서명된 manifest를 통과해야 한다. 사용자 PC에서 임의로 내려받은 unsigned package가 실행되어서는 안 된다.

### 추가 작성 필요

- 공공기관 보안 담당자용 executive summary.
- sandbox-only 실행 정책 상세.
- local executor 차단 시 사용자 메시지.
- 내부망/offline 배포 시나리오.
- 기관별 policy pack과 unknown mode fail-closed 정책.

---

## 14. Smart Operations Layer

Smart Operations Layer는 Harness Pipeline을 "더 똑똑하게" 만드는 후속 계층이다. 여기서 똑똑함은 AI 모델 자체의 지능을 바꾸는 것이 아니라, 작업 맥락을 더 잘 이해하고, 필요한 검토를 추천하고, 위험한 상태를 알려주고, 반복되는 경험을 안전하게 기억하는 능력을 뜻한다.

기초는 decision context다. 현재 run 상태, approval pending 여부, PII 탐지 여부, Codex review 누락 여부, audit export 가능 여부, public-sector posture, release manifest signature 상태, test failure 여부를 하나의 snapshot으로 만든다. 이 snapshot을 기반으로 recommendation card, expert preset, quality gate, run memory가 동작한다.

중요한 원칙은 자동 실행 금지다. Harness Pipeline은 AI가 추천하도록 만들 수 있지만, 추천을 곧바로 실행해서는 안 된다. 추천은 설명과 함께 카드로 표시하고, 사용자가 선택한 action만 수행해야 한다. 공공기관 모드에서는 추천 가능한 action과 attach 가능한 skill이 allowlist로 제한되어야 한다.

### 추가 작성 필요

- decision context schema.
- recommendation card 예시.
- hard gate와 warn gate의 차이.
- run memory redaction 정책.
- institutional policy pack 구조.

---

## 15. Skill Pack과 배포 가능한 전문성

Harness Pipeline은 향후 사용자가 가진 Claude Code 스킬을 제품 배포물에 함께 포함할 수 있어야 한다. 다만 이것은 로컬 경로를 그대로 참조하는 방식이어서는 안 된다. `C:\Users\SJ\.claude\skills` 같은 개발자 개인 환경에 의존하면 배포 제품으로 사용할 수 없다.

올바른 방향은 bundled skill pack이다. 현재 보유한 전역 Claude 스킬과 프로젝트 스킬을 검토하고, secret scan, path scrub, license 확인, hash 계산, manifest 작성, signature 검증을 거쳐 배포 가능한 skill pack으로 만든다. 제품은 이 pack을 `<installDir>/skills/packs/...` 같은 portable 경로에 포함하고, skill source registry가 이를 읽는다.

Skill recommendation은 AI가 담당할 수 있다. 그러나 AI는 전체 `SKILL.md` 원문을 처음부터 다 읽어서는 안 된다. 먼저 metadata, description, tags, trustLevel, allowedModes만 보고 후보를 추천한다. 사용자가 승인한 skill만 prompt에 제한적으로 첨부한다. 첨부 시에는 skill id, source, hash, attach decision을 audit에 남긴다.

공공기관 모드에서는 bundled 또는 organization-approved skill pack만 attach 가능해야 한다. user/project/custom source는 기본적으로 disabled 또는 recommend-only로 둔다. unknown source의 skill이 자동 주입되어서는 안 된다.

### 추가 작성 필요

- skill pack manifest schema.
- current 74 global Claude skills + 2 project skills 분류표.
- harness-default, harness-developer, harness-public-sector, harness-full-lab pack 구성안.
- skill_pack_verified / skill_attached audit verb 정의.
- public-sector skill allowlist 정책.

---

## 16. 시스템 내부 구조

이 장은 개발자와 운영자가 Harness Pipeline을 유지보수할 때 참고하는 레퍼런스다. 각 모듈은 책임, 입력, 출력, 실패 모드, 테스트 위치를 함께 설명해야 한다.

Launcher는 배포 진입점이다. Dashboard Server는 API와 runtime wiring을 담당한다. Web Dashboard는 사용자 조작면이다. ClaudeRunner와 CodexRunner는 AI CLI 실행 주체다. ProfileStore와 CredentialStore는 계정과 secret을 분리한다. ApprovalManager는 위험 tool 승인 흐름을 관리한다. ReviewSessionManager와 ReviewSpawnDispatcher는 Claude/Codex 협업 흐름을 연결한다. PiiScanner와 PiiGate는 개인정보를 탐지하고 정책에 따라 차단 또는 경고한다. EvidenceLedger는 감사 이벤트를 저장하고 bundle export에 사용된다.

각 모듈 설명은 "무엇을 한다"에 그치면 부족하다. 왜 별도 모듈이어야 하는지, 어떤 보안 경계를 담당하는지, 어떤 테스트가 회귀를 막는지도 설명해야 한다.

### 추가 작성 필요

- 모듈별 책임 표.
- 대표 파일 경로와 테스트 파일 경로.
- runtime wiring 다이어그램.
- 실패 모드와 operator-actionable error 메시지 표.

---

## 17. 오픈소스와 라이선스

Harness Pipeline은 Node.js 기반 도구이며 Express, ws, node-pty 같은 오픈소스 패키지를 직접 사용한다. 배포용 문서에는 이 의존성을 명확히 설명해야 한다. 특히 공공기관과 기업 배포에서는 기능 설명만큼이나 OSS 고지와 라이선스 검토가 중요하다.

직접 의존성은 Express, ws, node-pty다. Express는 HTTP API server framework로 profile, approval, review session, audit, security scan endpoint의 기반이다. ws는 WebSocket 실시간 통신에 사용된다. node-pty는 CLI 기반 AI 도구를 터미널처럼 실행하고 입출력을 연결하는 핵심 브릿지다.

전이 의존성은 package-lock 기준으로 관리한다. 현재 dependency inventory는 별도 표로 유지하고, 버전 업데이트 시 반드시 다시 생성해야 한다. 배포 패키지에는 `THIRD-PARTY-NOTICES.md`, `package.json`, `package-lock.json`, project license를 포함하는 것이 바람직하다.

### 추가 작성 필요

- 최신 package-lock 기준 dependency inventory 재생성.
- THIRD-PARTY-NOTICES.md 초안.
- 각 직접 의존성 보안상 의미.
- dependency update 운영 절차.

---

## 18. 운영 체크리스트

운영 체크리스트는 실제 배포자가 사용할 수 있어야 한다. 문서 본문이 원리를 설명한다면, 체크리스트는 실행 전후에 빠르게 확인하는 도구다.

배포 전에는 release zip 생성, manifest 작성, SHA256 계산, manifest 서명, trust store 준비, OSS notice 포함, operator guide 포함, public-sector 여부 확인을 수행한다. 설치 전에는 배포 채널, signature verification, Node.js 버전, 보안 정책 예외 필요 여부를 확인한다. 실행 후에는 health endpoint, UI 기본 화면, profile 설정, Claude/Codex 연결, approval card, PII scan, evidence export를 확인한다.

공공기관 운영자는 추가로 sandbox-only execution, local executor block, deep file scan, signed/offline distribution, audit export, trust store keyId를 확인해야 한다.

### 추가 작성 필요

- 배포 전 체크리스트.
- 설치 전 체크리스트.
- 실행 후 체크리스트.
- 장애 대응 체크리스트.
- 감사 제출 체크리스트.

---

## 19. 장애 대응과 문제 해결

배포용 제품은 실패했을 때의 안내가 중요하다. 사용자가 실행했는데 브라우저가 열리지 않는 경우, 포트가 이미 사용 중인 경우, Node.js 버전이 낮은 경우, Claude/Codex 계정 연결이 실패하는 경우, manifest signature가 실패하는 경우, public-sector 정책으로 local executor가 차단되는 경우를 모두 설명해야 한다.

문제 해결 문서는 "원인"과 "조치"를 함께 제공해야 한다. 예를 들어 signature mismatch는 보안상 중요한 실패이므로 단순히 다시 시도하라고 안내하면 안 된다. 배포 채널이 올바른지, manifest와 zip이 같은 버전인지, trust store의 keyId가 맞는지 확인하게 해야 한다.

### 추가 작성 필요

- 오류 코드별 원인/조치 표.
- launcher exit code 표.
- 서버 health check 실패 대응.
- profile/credential 오류 대응.
- public-sector policy block 대응.

---

## 20. 현재 한계와 로드맵

가이드는 현재 한계를 정직하게 설명해야 한다. 이 도구는 빠르게 발전하고 있으므로 "지원됨"과 "계획 중"을 혼동하면 신뢰가 떨어진다.

현재 명확히 구분해야 할 항목은 UI productization, token usage tracking, skill-aware execution, Linux host L2/L3 enforcement, policy-backed hard gates, redacted run memory다. 예를 들어 token usage 실시간 추적은 현재 핵심 범위에서 제외되어 있으며, 쉽게 정확히 반영하기 어렵다는 점을 설명해야 한다. Skill recommendation도 아직 "추천과 승인 후 주입"으로 설계되어야 하며 자동 주입은 공공기관 보안 모델과 충돌할 수 있다.

로드맵은 operator trust, UI productization, smart recommendations, public-sector hardening, skill pack distribution 순서로 설명하는 것이 좋다.

### 추가 작성 필요

- 현재 지원/진행 중/계획 중 표.
- 점수와 cap movement 정책.
- Phase 2 이후 장기 로드맵.
- 사용자에게 과장하지 않는 표현 목록.

---

## 21. 용어 사전

가이드가 길어질수록 용어 사전이 중요해진다. 독자는 모든 장을 순서대로 읽지 않는다. 따라서 `Run`, `Review Session`, `Approval Card`, `PII`, `Evidence Bundle`, `Manifest`, `Trust Store`, `Public-sector Mode`, `Skill Pack`, `Decision Context`, `Policy Gate` 같은 용어를 독립적으로 이해할 수 있어야 한다.

용어 사전은 짧은 정의와 긴 설명을 함께 제공하는 것이 좋다. 짧은 정의는 표로 제공하고, 긴 설명은 각 용어별 문단으로 제공한다.

### 추가 작성 필요

- 핵심 용어 50개 이상 선정.
- 일반 사용자용 쉬운 정의.
- 개발자용 정확한 정의.
- 관련 장 링크.

---

## 22. 집필 순서 제안

가이드는 한 번에 완성하려고 하면 사실관계가 쉽게 어긋난다. 구현 라운드가 계속 진행 중이므로 장별로 작성하고, 라운드 마감 후 factual sync를 수행하는 방식이 좋다.

추천 집필 순서는 다음과 같다.

1. 핵심 결론과 제품 필요성
2. 일반 사용자용 설명
3. 개발자용 작업 흐름
4. UI와 디자인 원칙
5. 배포와 실행 모델
6. 보안 모델
7. 공공기관 모델
8. 개인정보 탐지와 감사
9. Claude/Codex 협업 구조
10. Smart Operations Layer
11. Skill Pack과 배포 가능한 전문성
12. 시스템 내부 구조
13. OSS와 라이선스
14. 체크리스트와 문제 해결
15. 용어 사전과 FAQ

각 장은 먼저 초안 문단을 작성하고, 다음 단계에서 실제 스크린샷, 명령어, 파일 경로, API schema, audit verb, 테스트 결과를 붙인다.

### 추가 작성 필요

- 장별 담당 라운드와 commit 기준.
- 각 장의 완료 기준.
- PDF 목차 깊이 정책.
- 스크린샷 캡처 정책.

---

## 23. 사실관계 동기화 정책

가이드는 제품이 계속 바뀌는 동안 작성되므로, 문서의 사실관계 동기화 정책이 필요하다. 특히 점수, 테스트 수, commit hash, endpoint 목록, audit verb 목록, UI 모드, public-sector 정책은 라운드가 끝날 때마다 바뀔 수 있다.

권장 정책은 다음과 같다. 장문 본문은 안정적인 개념 중심으로 작성한다. 숫자와 commit hash는 "릴리스 노트" 또는 "현재 상태 표"에 모은다. 구현이 완료되지 않은 기능은 "계획 중"으로 표시한다. 사용자가 오해할 수 있는 기능은 "현재는 지원하지 않음"을 명시한다.

문서 수정 시에는 마지막에 다음을 확인한다.

- 현재 scorecard와 충돌하지 않는가.
- CI/test count가 최신인가.
- endpoint와 command가 실제 존재하는가.
- public-sector 정책 설명이 fail-open으로 오해되지 않는가.
- UI 설명이 현재 기본 진입 화면과 일치하는가.

### 추가 작성 필요

- scorecard sync 절차.
- guide freshness check script 가능성.
- 문서 릴리스 체크리스트.

---

## 24. 초안 상태 요약

이 초안은 전체 가이드의 뼈대와 각 장의 첫 설명 문단을 제공한다. 아직 최종 배포용 문서가 아니다. 다음 단계에서는 각 장을 하나씩 확장하고, 실제 UI 스크린샷, 명령어, API schema, audit event, 테스트 evidence, OSS notice, 공공기관 운영 시나리오를 추가해야 한다.

가장 먼저 확장할 장은 1장과 2장이다. 이 두 장은 제품의 명분을 설명한다. 그 다음 6장 UI와 디자인 원칙을 확장해야 한다. 현재 제품의 첫인상 문제는 중요한 피드백이므로, 참조 HTML을 visual source of truth로 삼는다는 원칙을 문서에도 명확히 남겨야 한다.

마지막으로 15장 Skill Pack은 향후 제품 차별점이 될 수 있다. 사용자가 보유한 전문 스킬을 배포 가능한 skill pack으로 만들고, AI가 상황에 맞게 추천하되 사람이 승인한 것만 주입하는 구조는 Harness Pipeline을 "더 똑똑하게" 만드는 핵심 방향이다.

### 추가 작성 필요

- 각 장을 별도 PR/commit 단위로 확장할지 결정.
- 기존 `harness-pipeline-distribution-guide.md`와 통합할지, 이 문서를 "reference guide"로 별도 유지할지 결정.
- PDF용 최종 문서 구조 결정.

