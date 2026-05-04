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
27. 부록: 오픈소스 구성과 라이선스 고지

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

CLI만 사용할 때는 AI가 출력하는 로그를 사람이 직접 읽어야 한다. 작업이 짧고 단순하다면 이 방식도 충분하다. 그러나 여러 파일을 수정하고, 테스트를 돌리고, 다른 AI에게 검토를 맡기고, 다시 수정하는 흐름이 길어지면 터미널 로그만으로는 현재 상태를 판단하기 어렵다. 무엇이 이미 끝났고, 무엇이 실패했으며, 어떤 판단이 아직 사람의 승인을 기다리는지 한눈에 보이지 않는다.

Harness Pipeline은 이 문제를 화면 구조로 해결한다. Simple UI는 일반 사용자가 지금 필요한 정보만 보도록 카드 형태로 상태를 보여주고, Advanced UI는 개발자와 운영자가 run, agent, audit, approval, review session을 더 깊게 볼 수 있도록 구성된다. Harness Track은 작업 단계를 시각적으로 보여주며, Run Viewer는 끝난 작업을 나중에 다시 열어 실행 요약, 리뷰, 승인, 감사 로그를 함께 확인하게 해준다.

즉 이 도구의 첫 번째 가치는 “AI가 무엇을 하고 있는지 보이는 것”이다. 보이는 작업은 설명할 수 있고, 설명할 수 있는 작업은 검토할 수 있으며, 검토할 수 있는 작업은 조직 안에서 운영할 수 있다.

### 5.2 위험한 작업을 승인 절차로 묶는다

Bash, Write, Edit 같은 작업은 시스템에 직접 영향을 줄 수 있다. 파일을 바꾸거나 명령을 실행하는 기능은 AI 개발 도구의 강력한 장점이지만, 동시에 가장 큰 위험 지점이다. 사람이 의도하지 않은 파일이 수정되거나, 내부 경로가 노출되거나, 삭제 명령이 잘못 실행되면 작은 실수가 큰 사고로 이어질 수 있다.

Harness Pipeline은 이런 작업을 즉시 실행하지 않고 승인 카드로 멈춰 세운다. 승인 카드에는 어떤 도구가 요청되었는지, 어떤 인자가 전달되었는지, PII 탐지 결과가 있는지, 어떤 run에서 나온 요청인지 표시된다. 운영자는 허용 또는 거부를 선택할 수 있고, 시간 초과 시에는 기본적으로 안전한 방향으로 거부하도록 설계할 수 있다.

이 구조의 핵심은 AI를 불신하는 것이 아니라, 강한 권한을 가진 행동에 인간의 마지막 판단을 두는 것이다. 일반 사용자는 어려운 명령을 모두 이해하지 못해도 “위험 작업이 발생했다”는 사실을 알 수 있고, 개발자나 운영자는 정확한 요청 내용을 보고 판단할 수 있다.

### 5.3 한 AI의 결과를 다른 AI가 검토하게 한다

AI 하나가 모든 문제를 완벽히 잡아내기는 어렵다. 한 모델은 구현을 빠르게 진행하지만 테스트 누락을 놓칠 수 있고, 다른 모델은 보안 위험이나 회귀 가능성을 더 날카롭게 짚을 수 있다. Harness Pipeline은 이 차이를 제품 기능으로 활용한다.

Review Relay는 Claude가 작성한 계획, 코드 변경, 결과 요약을 Codex에게 넘겨 비평하게 하고, 그 비평을 다시 Claude에게 돌려보내 수정에 반영할 수 있게 하는 흐름이다. 사용자는 두 개의 터미널을 직접 오가며 복사하고 붙여넣지 않아도 된다. Dual Agent Console은 Claude와 Codex의 흐름을 나란히 보여주고, review session은 어느 비평이 어떤 작업에 연결되는지 기록한다.

이 기능은 단순한 병렬 실행이 아니다. “작성자”와 “검토자” 역할을 분리하는 품질 관리 구조다. 개발자는 구현 속도를 유지하면서도 제3자 리뷰에 가까운 효과를 얻을 수 있고, 일반 사용자는 결과를 다른 AI가 한 번 더 확인했다는 신뢰 단서를 얻을 수 있다.

### 5.4 개인정보와 기관 보안 요구를 반영한다

AI 작업에서 가장 민감한 문제 중 하나는 개인정보와 내부 정보가 의도치 않게 외부 provider로 전달되는 것이다. 특히 공공기관, 금융, 의료, 교육, 사내망 환경에서는 “편리하게 AI를 쓰는 것”보다 “어떤 데이터가 AI에게 전달되는지 통제할 수 있는가”가 먼저다.

Harness Pipeline은 주민등록번호, 전화번호, 이메일, 카드번호, 사업자등록번호, 운전면허번호, 여권번호 등 한국 환경에서 자주 문제가 되는 개인정보 패턴을 탐지하고 마스킹한다. Inline Scan은 prompt가 AI에게 전달되기 전에 빠르게 검사하고, Deep File Scan은 파일 내용이나 첨부 데이터처럼 더 깊은 검사가 필요한 경계에서 동작한다.

표준 모드에서는 개인정보 탐지 결과를 경고로 처리할 수 있고, 공공기관 모드에서는 차단으로 처리할 수 있다. 중요한 점은 원문 개인정보를 감사 로그에 남기지 않는다는 것이다. 기록에는 탐지 유형, 차단 여부, 마스킹된 샘플, 정책 판단만 남겨 감사 가능성과 개인정보 최소화를 동시에 추구한다.

### 5.5 감사 가능한 기록을 남긴다

조직에서 AI를 사용하려면 결과물만으로는 충분하지 않다. 누가 어떤 작업을 요청했는지, 어떤 도구가 실행되었는지, 어떤 요청이 승인되거나 거부되었는지, 개인정보가 탐지되었는지, 배포 파일이 검증되었는지를 나중에 설명할 수 있어야 한다.

Harness Pipeline은 실행, 승인, 거부, 차단, 개인정보 탐지, 원격 hook, review session, 배포 검증 등의 이벤트를 감사 가능한 형태로 남긴다. Run Viewer는 특정 run의 기록을 화면에서 보여주고, Evidence Bundle은 감사관에게 제출할 수 있는 sealed JSON 봉투로 내보낼 수 있다. 오프라인 verifier는 이 봉투가 변조되지 않았는지 검증한다.

이 감사 구조는 공공기관 배포에서 특히 중요하다. AI 사용이 문제가 되었을 때 “AI가 알아서 했다”는 말은 충분한 설명이 되지 않는다. 어떤 정책이 있었고, 어떤 요청이 차단되었고, 사람이 어떤 결정을 내렸는지 남아 있어야 한다.

---

## 6. 전체 기능 요약

### 6.1 실행 및 배포

Harness Pipeline은 배포자가 복잡한 컨테이너 이미지를 요구하지 않고도 사용자에게 전달할 수 있도록 설계되었다. Windows에서는 `harness-start.bat`, macOS/Linux에서는 `harness-start.sh`가 진입점 역할을 한다. 사용자는 배포받은 폴더에서 실행 파일을 누르거나 명령을 실행하면 되고, 런처는 Node.js 버전 확인, 설치 모드 판단, 서버 시작, health check, 브라우저 오픈을 순서대로 처리한다.

배포 방식은 크게 두 가지다. 첫 번째는 release zip에 필요한 파일을 모두 담아 전달하는 방식이다. 이 경우 사용자는 압축을 풀고 바로 실행할 수 있다. 두 번째는 manifest 기반 bootstrap 방식이다. 이 방식에서는 작은 런처가 manifest를 읽고, 지정된 release zip을 내려받은 뒤 SHA256으로 무결성을 검증한다.

보안 배포를 위해 Ed25519 manifest 서명 검증 기능도 포함되어 있다. SHA256은 zip 파일이 manifest에 적힌 값과 일치하는지 확인하지만, manifest 자체가 바뀌면 충분하지 않다. 따라서 배포자는 manifest에 서명하고, 사용자는 trust store에 등록된 public key로 배포자가 맞는지 검증한다. 내부망이나 공공기관 배포에서는 이 절차가 배포 신뢰성의 핵심이 된다.

### 6.2 사용자 인터페이스

UI는 처음부터 두 종류의 사용자를 모두 고려한다. 일반 사용자는 복잡한 로그와 내부 구조를 몰라도 현재 상태를 이해할 수 있어야 하고, 고급 사용자는 run, agent, audit, approval, review session을 세밀하게 추적할 수 있어야 한다.

Simple UI는 카드 중심 화면이다. “지금 AI가 하는 일”, “승인 필요”, “최근 결과”, “연결 상태”, “보안 상태”처럼 사용자가 바로 판단해야 하는 항목을 전면에 둔다. Advanced UI는 개발자와 운영자를 위한 상세 화면이다. 작업 흐름, agent 상태, dual agent console, audit stream, approval card, settings/account panel을 함께 보여준다.

Legacy mode는 기존 화면을 그대로 우회해 보여주는 호환 모드다. UI를 새로 도입하는 과정에서도 기존 운영 방식을 깨지 않도록 하기 위한 안전장치다. Harness Track은 작업 단계를 시각적으로 보여주는 장치이며, Run Viewer는 끝난 작업을 다시 열어 실행, 리뷰, 승인, 감사 기록을 확인하는 상세 화면이다.

### 6.3 AI 협업

Harness Pipeline의 AI 협업 기능은 Claude와 Codex를 단순히 동시에 실행하는 수준을 목표로 하지 않는다. 핵심은 역할 분리다. Claude가 구현, 수정, 계획 작성을 맡고, Codex가 비평, 검토, 위험 분석, 대안 제시를 맡는 식으로 작업을 구성할 수 있다.

Review session은 이 협업 흐름의 단위다. 운영자는 session을 만들고, Claude의 산출물을 Codex에게 보내 비평을 요청할 수 있다. Codex 응답에 대해 추가 질문을 던질 수 있으며, 충분한 검토가 끝나면 그 비평을 다시 Claude에게 넘겨 수정하도록 할 수 있다. 작업이 끝난 session은 archive하여 나중에 run viewer나 감사 흐름에서 추적할 수 있다.

이 구조의 장점은 AI 작업을 “한 번 요청하고 끝나는 대화”가 아니라 “작성, 검토, 수정, 검증의 루프”로 바꾸는 데 있다. 특히 개발 작업에서는 한 모델이 놓친 테스트 누락, 보안 위험, 회귀 가능성을 다른 모델이 잡아낼 수 있다.

### 6.4 계정 및 프로필

프로필 기능은 배포형 도구에서 매우 중요하다. 사용자가 개인 Claude/Codex 계정을 쓰는 경우와, 기관이 승인한 계정 또는 runner를 쓰는 경우는 보안 요구가 다르다. Harness Pipeline은 프로필을 통해 계정, credential, 실행 정책, deployment posture를 분리한다.

사용자는 여러 프로필을 만들고 active profile을 선택할 수 있다. 프로필은 Claude와 Codex provider 설정, credential backend, public-sector 정책 여부, sandbox 요구사항 등을 담을 수 있다. 계정 연결 상태는 UI에서 테스트할 수 있으며, active run이 있는 동안 중요한 프로필 변경을 막는 정책도 적용할 수 있다.

Credential store는 profile store와 분리되어야 한다. 프로필은 “어떤 계정을 쓰는가”를 설명하고, credential store는 실제 토큰이나 인증 정보를 보관한다. 이 분리는 설정 파일 유출, 백업/복원, 기관 정책 적용에서 중요한 안전장치가 된다.

### 6.5 보안과 통제

보안 기능은 여러 겹으로 구성된다. 첫 번째 겹은 위험 도구 승인이다. Bash, Write, Edit처럼 시스템에 영향을 주는 작업은 승인 카드로 멈춰 세우고, 사용자가 확인한 뒤에만 진행할 수 있게 한다.

두 번째 겹은 개인정보 탐지다. Inline Scan은 prompt가 AI provider로 나가기 전에 빠르게 검사하고, Deep File Scan은 파일 import 경계에서 더 깊은 패턴을 검사한다. 공공기관 모드에서는 개인정보가 탐지되면 차단하는 fail-closed 정책을 사용할 수 있다.

세 번째 겹은 실행 위치 통제다. Public-sector mode에서는 로컬 PC에서 직접 실행되는 executor를 차단하고, sandbox workspace 또는 기관이 승인한 runner를 요구할 수 있다. 네 번째 겹은 감사 sanitizer다. 감사 로그에는 원문 민감정보가 들어가지 않도록 마스킹과 redaction을 적용한다. 다섯 번째 겹은 배포 신뢰성이다. Signed manifest와 evidence bundle seal은 배포물과 감사 자료가 변조되지 않았는지 검증할 수 있게 한다.

### 6.6 감사와 증거

감사 기능은 화면 확인과 파일 제출 두 방향을 모두 지원한다. 운영자는 Run Viewer에서 특정 run의 실행 요약, 리뷰, 승인, 감사 로그를 확인할 수 있다. 개발자는 어떤 승인 요청이 있었고 어떤 PII 경고가 발생했는지 작업 단위로 추적할 수 있다.

감사관이나 보안 담당자에게 제출할 때는 Evidence Bundle을 사용할 수 있다. Evidence Bundle은 run 단위 또는 시간 범위 단위로 export할 수 있는 sealed JSON envelope이다. HMAC-SHA256 기반 seal을 통해 bundle이 생성 이후 변조되지 않았는지 오프라인에서 확인할 수 있다.

이 구조는 내부망이나 공공기관 환경에서 유용하다. 감사관은 실제 운영 서버에 접속하지 않고도 제출받은 bundle을 verifier CLI로 검증할 수 있고, 운영자는 필요한 범위의 증거만 내보낼 수 있다.

---

## 7. 일반 사용자용 사용 흐름

### 7.1 처음 실행

일반 사용자는 복잡한 설치 절차를 알 필요가 없다. 배포자가 제공한 폴더를 열고, 운영체제에 맞는 시작 파일을 실행하면 된다. Windows 사용자는 `harness-start.bat`를 실행하고, macOS/Linux 사용자는 `harness-start.sh`를 실행한다.

런처는 내부적으로 Node.js 버전을 확인하고, 필요한 실행 파일이 있는지 확인한 뒤 대시보드 서버를 시작한다. 서버가 정상적으로 준비되면 브라우저가 자동으로 열리고, 사용자는 웹 화면에서 작업을 시작할 수 있다. 처음 실행한 사용자에게는 welcome/setup 안내가 표시되어 계정 연결, 프로필 선택, 보안 상태 확인 같은 기본 설정을 차례대로 진행하게 한다.

이 흐름의 목표는 “터미널을 잘 모르는 사용자도 실행할 수 있게 하는 것”이다. 사용자가 직접 포트를 찾거나, 여러 명령을 순서대로 실행하거나, 로그를 읽어 원인을 추측하지 않아도 되도록 런처와 UI가 초기 진입 과정을 맡는다.

### 7.2 프로필 설정

프로필은 이 도구에서 “어떤 계정과 어떤 정책으로 AI를 사용할 것인가”를 정하는 단위다. 개인 사용자는 자신의 Claude/Codex 계정을 연결한 개인용 프로필을 만들 수 있고, 기관 사용자는 운영자가 지정한 정책을 따르는 기관용 프로필을 만들 수 있다.

프로필 설정에서는 Claude 또는 Codex 연결 정보를 입력하고, 연결 상태를 테스트한다. 테스트가 성공하면 해당 프로필을 active profile로 선택한다. active profile은 이후 실행되는 작업의 기본 계정과 정책으로 사용된다. 예를 들어 표준 프로필에서는 개인정보가 발견될 때 경고만 표시할 수 있지만, 공공기관 프로필에서는 같은 상황을 차단으로 처리할 수 있다.

프로필을 나누는 이유는 편의성만이 아니다. 개인 계정, 업무 계정, 기관 승인 계정, sandbox 전용 runner를 섞어 쓰면 실수 가능성이 커진다. 프로필을 분리하면 어떤 작업이 어떤 계정과 정책으로 실행되었는지 추적할 수 있다.

### 7.3 AI 작업 시작

일반 사용자는 Simple UI에서 현재 상태를 먼저 확인한다. 보안 상태 카드가 정상인지, 연결 상태가 준비되었는지, 승인 대기 작업이 있는지 확인한 뒤 AI 작업을 시작한다. 작업은 Claude에게 맡길 수도 있고, 이미 작성된 결과나 계획을 Codex에게 검토시킬 수도 있다.

중요한 점은 사용자가 모든 내부 로그를 직접 따라갈 필요가 없다는 것이다. Harness Track은 작업이 계획, 검토, 수정, 실행, 검증 중 어느 단계에 있는지 보여준다. 승인 카드가 나타나면 위험한 작업이 요청되었다는 뜻이므로, 사용자는 내용을 확인하고 허용 또는 거부를 선택한다.

작업이 끝나면 최근 결과 카드에서 결과를 다시 열 수 있다. 여기서 단순한 성공/실패만 보는 것이 아니라 어떤 검토가 있었는지, 어떤 승인 요청이 있었는지, 보안 이벤트가 있었는지도 함께 확인할 수 있다.

### 7.4 결과 확인

결과 확인은 Run Viewer에서 이루어진다. 최근 결과를 클릭하면 해당 run의 상세 화면이 열리고, 사용자는 실행 요약을 먼저 확인한다. 요약에는 작업 상태, 시작/종료 시각, 주요 결과, 오류 여부 같은 정보가 포함된다.

Review 섹션에서는 Claude와 Codex 사이의 검토 흐름을 확인한다. Codex가 어떤 비평을 했고, 그 비평이 Claude에게 다시 전달되었는지 볼 수 있다. Approval 섹션에서는 어떤 위험 작업이 승인되었거나 거부되었는지 확인한다. Audit 섹션에서는 개인정보 탐지, local executor 차단, 배포 검증, evidence export 같은 보안 이벤트를 확인할 수 있다.

일반 사용자에게 이 화면은 “AI가 제대로 했는지 다시 보는 화면”이고, 운영자에게는 “나중에 설명할 수 있는 기록을 확인하는 화면”이다.

---

## 8. 개발자용 사용 흐름

### 8.1 개발자에게 이 도구가 주는 가치

Harness Pipeline은 Claude Code나 Codex CLI를 대체하지 않는다. 두 도구를 더 안전하고 체계적으로 운영하기 위한 상위 레이어다.

개발자는 CLI를 직접 사용하는 데 익숙하다. 그래서 단순히 “예쁜 화면”만 제공한다면 이 도구를 쓸 이유가 약하다. Harness Pipeline이 개발자에게 주는 가치는 화면보다 운영 구조에 있다. Claude와 Codex의 역할을 분리하고, 구현과 비평의 반복 루프를 만들고, 위험 작업을 승인 게이트로 묶고, run 단위로 추적 가능한 기록을 남긴다.

예를 들어 Claude에게 기능 구현을 맡긴 뒤 Codex에게 변경 위험을 비평하게 할 수 있다. Codex가 누락된 테스트, 잘못된 보안 가정, 회귀 가능성을 지적하면 그 비평을 다시 Claude에게 넘겨 수정하도록 할 수 있다. 이 흐름은 사람이 직접 두 터미널을 오가며 복사/붙여넣기해도 가능하지만, Harness Pipeline은 그것을 review session과 audit event로 구조화한다.

또한 개발자는 profile 기반 계정 분리를 통해 개인 작업과 기관 작업을 분리할 수 있다. 원격 runner와 sandbox 기반 확장을 통해 로컬 PC가 아닌 통제된 환경에서 AI 작업을 실행하는 방향으로 확장할 수도 있다.

### 8.2 추천 작업 패턴

권장 패턴은 “작성자와 검토자 분리”다. 먼저 Claude에게 구현 또는 수정 계획을 맡긴다. 이 단계에서는 빠른 초안, 코드 변경, 테스트 추가, 문서 업데이트처럼 실제 산출물을 만드는 데 집중한다. 그 다음 Codex에게 보안, 정확성, 회귀 위험, 테스트 누락을 비평하게 한다.

Codex의 비평이 의미 있다면 그대로 Claude에게 hand-back하여 수정하게 한다. 이때 운영자는 Dual Agent Console에서 양쪽 흐름을 확인하고, 필요한 경우 Codex에게 추가 질문을 던질 수 있다. AI가 Bash, Write, Edit 같은 위험 도구를 요청하면 approval card가 나타나며, 개발자는 요청 범위를 확인한 뒤 허용하거나 거부한다.

작업이 끝나면 Run Viewer에서 테스트와 검증 결과를 확인한다. 중요한 변경, 보안 관련 변경, 기관 제출이 필요한 변경은 Evidence Bundle로 보관한다. 이렇게 하면 개발 과정 자체가 나중에 설명 가능한 기록으로 남는다.

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

Advanced UI는 정보량이 많기 때문에 일반 사용자에게는 과하게 보일 수 있다. 하지만 개발자에게는 필요한 밀도를 제공한다. run tree는 여러 작업의 관계를 보여주고, run summary는 현재 작업의 상태와 결과를 요약한다. agent tree는 Claude, Codex, runner가 어떤 상태인지 보여준다.

Dual Agent Console은 이 도구의 개발자 경험에서 가장 중요한 영역 중 하나다. Claude 출력과 Codex 비평을 나란히 확인할 수 있고, review session action row를 통해 Codex 비평 요청, follow-up 질문, Claude hand-back 같은 행동을 수행할 수 있다. Audit event stream과 approval card는 보안과 통제 흐름을 함께 보여준다.

개발자는 이 화면을 통해 “AI가 지금 무엇을 하고 있는가”뿐 아니라 “이 작업이 어떤 검토와 승인 과정을 거쳤는가”까지 확인할 수 있다.

---

## 9. 공공기관 및 사내망 사용 흐름

### 9.1 공공기관 모드의 목적

공공기관 모드는 AI가 로컬 PC나 내부 데이터를 임의로 다루지 못하게 하기 위한 정책 모드다.

핵심은 “AI 사용을 금지하는 것”이 아니라 “통제 가능한 조건에서만 AI 사용을 허용하는 것”이다. 공공기관이나 사내망 환경에서는 사용자의 편의보다 정보보호, 개인정보 최소화, 감사 가능성, 배포 신뢰성이 우선한다. Harness Pipeline은 이러한 요구를 public-sector posture로 묶어 정책화한다.

공공기관 모드에서는 로컬 executor를 차단하고 sandbox workspace 또는 기관이 승인한 runner를 요구할 수 있다. prompt dispatch 전에는 개인정보 inline scan을 수행하고, 파일 import 경계에서는 deep scan을 수행한다. Bash, Write, Edit 같은 위험 도구는 승인 없이 실행되지 않으며, 중요한 판단은 audit ledger에 기록된다. 배포물 역시 manifest signature와 trust store를 통해 검증하는 흐름을 갖는다.

이 모드는 일반 사용자에게는 다소 엄격하게 느껴질 수 있다. 하지만 기관 입장에서는 이 엄격함이 도입 명분이 된다. “누가 어떤 데이터를 AI에게 보냈는지 모른다”는 상태가 아니라, “정책에 따라 탐지하고 차단하며 기록한다”는 상태로 바꾸기 때문이다.

### 9.2 기관 운영자 첫 설정

기관 운영자는 먼저 승인된 배포 패키지를 준비한다. 이 패키지는 release zip, manifest, public trust store, 운영자 가이드, 배포용 통합 가이드를 포함해야 한다. 배포 전에는 manifest 서명과 SHA256 무결성을 검증하고, 검증 결과를 내부 배포 기록에 남기는 것이 좋다.

사용자에게 전달할 때는 기관의 내부 배포 채널을 사용한다. 이메일 첨부나 임의 다운로드 링크보다, 기관이 승인한 파일 배포 시스템이나 내부 포털을 사용하는 편이 안전하다. 사용자가 처음 실행하면 운영자는 public-sector profile을 만들도록 안내하고, sandbox runner 또는 기관 승인 작업 공간을 연결하게 한다.

초기 점검에서는 PII scanner와 evidence export 기능을 실제로 확인해야 한다. 테스트용 개인정보 패턴을 사용해 차단이 발생하는지 보고, 샘플 run을 export하여 offline verifier로 검증한다. 이 과정은 단순 기능 확인이 아니라 기관 보안 정책이 실제로 적용되는지 확인하는 acceptance test에 가깝다.

### 9.3 공공기관 모드에서 차단되는 대표 행동

- public-sector 정책에서 금지된 local Claude 실행
- sandbox workspace가 아닌 프로필 실행
- 개인정보가 포함된 prompt dispatch
- 승인되지 않은 Bash/Write/Edit 작업
- 서명 검증되지 않은 배포물 사용

차단은 사용자를 방해하기 위한 기능이 아니다. 차단은 “이 작업은 기관 정책상 사람이 다시 판단해야 한다”는 신호다. 예를 들어 개인정보가 포함된 prompt가 발견되면 AI provider로 전달되기 전에 멈춘다. 승인되지 않은 Bash 명령은 실행되지 않는다. 서명 검증되지 않은 배포물은 설치 단계에서 거부되어야 한다.

공공기관 운영에서 중요한 것은 차단 사실 자체보다 차단 기록이다. 어떤 정책이 어떤 요청을 막았는지 audit event로 남아야 하며, 감사관은 나중에 해당 기록을 evidence bundle로 확인할 수 있어야 한다.

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

Simple UI는 “덜 보여주는 화면”이 아니라 “지금 판단해야 할 것만 보여주는 화면”이다. 일반 사용자는 run tree, audit stream, dispatcher 상태 같은 내부 정보를 모두 볼 필요가 없다. 대신 현재 AI가 작업 중인지, 승인이 필요한지, 최근 결과가 성공했는지, 계정 연결이 정상인지, 보안 상태가 안전한지 알 수 있어야 한다.

이 모드의 설계 원칙은 낮은 진입 장벽이다. 버튼과 카드의 문구는 기술 용어보다 작업 의미를 우선해야 한다. 예를 들어 “reviewSession archived”보다 “검토 세션 보관됨”이 낫고, “PII gate blocked”보다 “개인정보가 포함되어 전송이 차단됨”이 일반 사용자에게 더 적합하다.

### 10.2 Advanced UI

개발자와 운영자용 화면이다. 더 많은 정보를 보여준다.

주요 영역:

- 작업 흐름
- run 상세
- agent 상태
- Claude/Codex 콘솔
- 감사 로그
- 승인 카드

Advanced UI는 반복 작업과 문제 해결을 위한 화면이다. 개발자는 이 화면에서 run의 흐름을 보고, agent 상태를 확인하고, Claude와 Codex의 출력 차이를 비교한다. 운영자는 audit event stream과 approval card를 보며 보안 정책이 제대로 작동하는지 확인한다.

이 화면은 정보 밀도가 높아야 하지만 무질서하면 안 된다. 작업 흐름, 실행 로그, 검토 세션, 승인 요청, 감사 이벤트가 서로 다른 의미를 갖기 때문에 영역별 구분이 중요하다. 특히 dual agent console은 Claude와 Codex를 단순히 나란히 보여주는 데서 끝나지 않고, review relay action을 수행할 수 있는 조작면이 되어야 한다.

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

Harness Track의 목적은 사용자가 긴 작업 중에도 현재 위치를 잃지 않게 하는 것이다. AI 작업은 중간 출력이 많고, 때로는 멈춘 것처럼 보이기도 한다. Track은 작업이 계획 중인지, 비평 중인지, 수정 중인지, 검증 중인지 단계로 보여준다.

애니메이션은 보조적 요소다. 시각적으로 매력적인 움직임은 사용자가 작업 진행을 체감하는 데 도움이 되지만, 실제 상태와 무관하게 움직이면 신뢰를 해친다. 따라서 Track은 가능한 한 실제 state machine과 연결되어야 하며, reduced-motion 환경이나 public-sector posture에서는 차분한 표현을 사용해야 한다.

### 10.4 Run Viewer

최근 결과를 클릭하면 열리는 상세 화면이다.

섹션:

- 실행 요약
- 리뷰 세션
- 승인 이력
- 감사 로그

Run Viewer는 작업이 끝난 뒤 가장 중요한 화면이다. AI 작업은 실시간으로 보는 것도 중요하지만, 실제 운영에서는 “나중에 다시 확인할 수 있는가”가 더 중요하다. Run Viewer는 특정 run을 기준으로 실행 요약, review session, approval, audit event를 한곳에 모은다.

일반 사용자는 여기서 결과가 무엇인지 확인하고, 개발자는 테스트 실패나 리뷰 지적을 다시 볼 수 있다. 운영자와 감사 담당자는 승인/거부 이력과 보안 이벤트를 확인한다. 향후 export 버튼이 연결되면, Run Viewer는 화면 확인에서 evidence bundle 생성까지 이어지는 자연스러운 출발점이 된다.

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

## 27. 부록: 오픈소스 구성과 라이선스 고지

Harness Pipeline은 Node.js 기반 도구이며, 일부 기능은 오픈소스 라이브러리 위에 구축되어 있다. 배포 문서에는 어떤 오픈소스를 사용했는지, 어떤 라이선스가 적용되는지, 각 구성 요소가 어떤 역할을 하는지 명시하는 것이 좋다. 특히 공공기관이나 기업 배포에서는 기능 설명만큼이나 소프트웨어 구성 목록과 라이선스 고지가 중요하다.

이 절의 목록은 현재 `package-lock.json`에 고정된 npm dependency 기준이다. 버전 업데이트, dependency 추가, lockfile 재생성 이후에는 반드시 이 표를 다시 확인해야 한다.

### 27.1 라이선스 요약

현재 npm dependency 기준 라이선스 분포는 다음과 같다.

| 라이선스 | 패키지 수 | 비고 |
|---|---:|---|
| MIT | 63 | 대부분의 HTTP, Express, WebSocket, 유틸리티 패키지 |
| ISC | 4 | 소형 Node.js 유틸리티 패키지 |
| BSD-3-Clause | 1 | `qs` |

현재 목록에는 GPL, AGPL, LGPL처럼 강한 copyleft 의무가 있는 패키지는 포함되어 있지 않다. 다만 이 문서는 법률 자문이 아니며, 기관 배포 전에는 조직의 오픈소스 검토 절차에 따라 별도 확인하는 것이 안전하다.

### 27.2 직접 의존성

직접 의존성은 `package.json`에 명시된 패키지다. 이 도구의 핵심 런타임 기능과 직접 연결되므로, 일반 사용자용 문서보다 개발자/운영자용 문서에서 조금 더 깊게 설명해야 한다.

| 패키지 | 버전 | 라이선스 | Harness Pipeline에서의 역할 |
|---|---:|---|---|
| `express` | 5.2.1 | MIT | 대시보드 서버와 REST API를 제공한다. profile, review session, approval, audit, security scan 같은 HTTP endpoint의 기반이다. |
| `ws` | 8.20.0 | MIT | WebSocket 실시간 통신을 담당한다. run 상태, agent 출력, review stream, approval 변화 같은 이벤트를 브라우저로 전달한다. |
| `node-pty` | 1.1.0 | MIT | CLI 기반 AI 도구를 실제 터미널처럼 실행하고 입출력을 연결한다. Claude/Codex runner를 대시보드와 연결하는 핵심 브릿지다. |

`express`는 HTTP 서버의 뼈대다. 이 도구에서 UI는 정적 파일로 제공되고, 내부 상태와 작업 요청은 API endpoint로 오간다. 따라서 Express는 단순 웹 서버가 아니라 profile, credential, approval, review, audit 기능을 묶는 운영 API의 기반이다.

`ws`는 실시간성을 제공한다. AI 작업은 긴 시간 동안 출력이 조금씩 흘러나오는 형태가 많다. HTTP polling만 사용하면 지연이 크고 서버 부담이 커질 수 있다. WebSocket은 runner 출력과 상태 변화를 즉시 UI에 전달해 “지금 AI가 무엇을 하고 있는지”를 사용자가 볼 수 있게 한다.

`node-pty`는 Claude Code와 Codex 같은 CLI 도구를 대시보드 안으로 끌어오는 핵심 구성 요소다. 일반 child process와 달리 pty는 터미널 환경을 흉내 내므로, CLI 도구가 기대하는 입출력 방식과 더 잘 맞는다. 이 패키지는 편의 기능이 아니라 Harness Pipeline의 핵심 실행 브릿지에 해당한다.

### 27.3 전체 dependency inventory

아래 표는 lockfile 기준 전체 npm dependency 목록이다. “역할”은 Harness Pipeline에서 직접 호출한다는 뜻이 아니라, 의존성 그래프 안에서 어떤 종류의 기능을 제공하는지 설명한 것이다.

| 패키지 | 버전 | 라이선스 | 역할 |
|---|---:|---|---|
| `accepts` | 2.0.0 | MIT | HTTP 요청의 content negotiation 처리 |
| `body-parser` | 2.2.2 | MIT | HTTP request body parsing |
| `bytes` | 3.1.2 | MIT | byte 크기 문자열 파싱 |
| `call-bind-apply-helpers` | 1.0.2 | MIT | JavaScript function binding 내부 유틸리티 |
| `call-bound` | 1.0.4 | MIT | ECMAScript intrinsic helper |
| `content-disposition` | 1.1.0 | MIT | HTTP Content-Disposition header 생성 |
| `content-type` | 1.0.5 | MIT | HTTP Content-Type header 파싱 |
| `cookie` | 0.7.2 | MIT | Cookie header 파싱과 직렬화 |
| `cookie-signature` | 1.2.2 | MIT | 서명된 cookie helper |
| `debug` | 4.4.3 | MIT | 개발/진단용 debug logging |
| `depd` | 2.0.0 | MIT | deprecation warning helper |
| `dunder-proto` | 1.0.1 | MIT | JavaScript prototype helper |
| `ee-first` | 1.1.1 | MIT | EventEmitter first-event 처리 |
| `encodeurl` | 2.0.0 | MIT | URL encoding helper |
| `es-define-property` | 1.0.1 | MIT | `Object.defineProperty` compatibility helper |
| `es-errors` | 1.3.0 | MIT | ECMAScript error constructor helper |
| `es-object-atoms` | 1.1.1 | MIT | JavaScript object intrinsic helper |
| `escape-html` | 1.0.3 | MIT | HTML escaping |
| `etag` | 1.8.1 | MIT | HTTP ETag 생성 |
| `express` | 5.2.1 | MIT | HTTP API server framework |
| `finalhandler` | 2.1.1 | MIT | Express final response/error handler |
| `forwarded` | 0.2.0 | MIT | proxy forwarding header parsing |
| `fresh` | 2.0.0 | MIT | HTTP cache freshness 판단 |
| `function-bind` | 1.1.2 | MIT | function bind polyfill/helper |
| `get-intrinsic` | 1.3.0 | MIT | ECMAScript intrinsic lookup |
| `get-proto` | 1.0.1 | MIT | prototype lookup helper |
| `gopd` | 1.2.0 | MIT | `Object.getOwnPropertyDescriptor` helper |
| `has-symbols` | 1.1.0 | MIT | Symbol 지원 여부 감지 |
| `hasown` | 2.0.2 | MIT | own-property 검사 helper |
| `http-errors` | 2.0.1 | MIT | HTTP error object 생성 |
| `iconv-lite` | 0.7.2 | MIT | 문자 인코딩 변환 |
| `inherits` | 2.0.4 | ISC | Node.js inheritance helper |
| `ipaddr.js` | 1.9.1 | MIT | IP 주소 파싱과 검사 |
| `is-promise` | 4.0.0 | MIT | Promise-like object 감지 |
| `math-intrinsics` | 1.1.0 | MIT | JavaScript math intrinsic helper |
| `media-typer` | 1.1.0 | MIT | media type 파싱 |
| `merge-descriptors` | 2.0.0 | MIT | object descriptor merge |
| `mime-db` | 1.54.0 | MIT | MIME type database |
| `mime-types` | 3.0.2 | MIT | MIME type lookup |
| `ms` | 2.1.3 | MIT | 시간 문자열 변환 |
| `negotiator` | 1.0.0 | MIT | HTTP content negotiation |
| `node-addon-api` | 7.1.1 | MIT | native addon API wrapper |
| `node-pty` | 1.1.0 | MIT | pseudo terminal bridge |
| `object-inspect` | 1.13.4 | MIT | object inspection helper |
| `on-finished` | 2.4.1 | MIT | HTTP response 완료 감지 |
| `once` | 1.4.0 | ISC | one-time callback helper |
| `parseurl` | 1.3.3 | MIT | URL parsing helper |
| `path-to-regexp` | 8.4.2 | MIT | Express route path matching |
| `proxy-addr` | 2.0.7 | MIT | proxy IP address 판단 |
| `qs` | 6.15.1 | BSD-3-Clause | querystring parsing |
| `range-parser` | 1.2.1 | MIT | HTTP Range header parsing |
| `raw-body` | 3.0.2 | MIT | raw request body reading |
| `router` | 2.2.0 | MIT | Express routing layer |
| `safer-buffer` | 2.1.2 | MIT | Buffer safety helper |
| `send` | 1.2.1 | MIT | static file response helper |
| `serve-static` | 2.2.1 | MIT | static asset serving |
| `setprototypeof` | 1.2.0 | ISC | prototype 설정 helper |
| `side-channel` | 1.1.0 | MIT | side-channel data structure |
| `side-channel-list` | 1.0.1 | MIT | side-channel list backend |
| `side-channel-map` | 1.0.1 | MIT | side-channel map backend |
| `side-channel-weakmap` | 1.0.2 | MIT | side-channel weakmap backend |
| `statuses` | 2.0.2 | MIT | HTTP status code utility |
| `toidentifier` | 1.0.1 | MIT | string-to-identifier helper |
| `type-is` | 2.0.1 | MIT | request Content-Type 판단 |
| `unpipe` | 1.0.0 | MIT | stream unpipe helper |
| `vary` | 1.1.2 | MIT | HTTP Vary header helper |
| `wrappy` | 1.0.2 | ISC | callback wrapper helper |
| `ws` | 8.20.0 | MIT | WebSocket server/client runtime |

### 27.4 배포 시 OSS 고지 권장 방식

배포 패키지에는 최소한 다음 파일을 포함하는 것을 권장한다.

- `LICENSE` 또는 프로젝트 자체 라이선스 파일
- `THIRD-PARTY-NOTICES.md`
- `package.json`
- `package-lock.json`
- 이 가이드의 PDF 또는 Markdown 원본

`THIRD-PARTY-NOTICES.md`에는 패키지명, 버전, 라이선스, 라이선스 전문 또는 라이선스 URL, 사용 목적을 포함하는 것이 좋다. 현재 dependency 대부분은 permissive license이지만, 기관 보안 검토에서는 “대부분 문제없다”보다 “정확히 무엇이 들어갔는가”가 중요하다.

### 27.5 보안 업데이트 원칙

오픈소스 dependency는 한 번 확인하고 끝나는 항목이 아니다. Express, ws, node-pty처럼 런타임 표면에 가까운 패키지는 보안 공지가 있을 때 빠르게 업데이트해야 한다. 배포 전에는 `npm audit --package-lock-only --audit-level=moderate`를 실행하고, lockfile이 바뀌면 smoke test와 readiness check를 함께 수행하는 것을 권장한다.

기관 배포에서는 업데이트가 더 조심스럽다. dependency를 올렸다는 것은 기능뿐 아니라 감사 대상도 바뀌었다는 뜻이다. 따라서 업데이트 manifest, SHA256, signature, changelog, OSS notice를 함께 갱신해야 한다.

---

## 결론

Harness Pipeline은 AI를 더 편하게 쓰기 위한 단순 UI가 아니다.

이 도구는 AI 작업을 사람이 이해할 수 있는 흐름으로 만들고, 위험한 행동을 승인 절차로 묶고, 개인정보와 감사 요구를 반영하며, Claude와 Codex가 서로 검토하는 작업 구조를 제공한다.

개인 개발자에게는 더 안전한 AI 협업 환경을 제공하고, 조직과 공공기관에는 통제 가능한 AI 운영 체계를 제공한다.
