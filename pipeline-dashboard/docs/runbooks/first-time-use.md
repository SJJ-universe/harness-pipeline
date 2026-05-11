# Runbook — 처음 사용 안내 (First-Time Use Guide)

**Slice END-USER-DEPLOY-POLISH (Phase 2 v2 follow-up, 2026-05-05)**

이 문서는 Orchestrator Pipeline을 **처음 사용하는 일반 사용자**를 위한
Korean-primary 안내서입니다. 개발자가 아닌 분도 이 문서만 따라가면
설치 → 첫 실행 → Claude/Codex 연결 → 첫 작업까지 마칠 수 있도록
설계되었습니다.

> 기술적 세부 사항이 필요한 운영자(operator)나 개발자는
> [`../README.md`](../README.md) §1 — Architecture & design 부터
> 시작하세요. 이 문서는 일반 사용자 트랙입니다.

---

## §1 이 도구가 무엇인가요?

Orchestrator Pipeline은 **AI 코딩 도구를 안전하게 감독하는 대시보드**입니다.

- Claude나 Codex 같은 AI에게 코드 작업을 부탁하면, 그 AI가 어떤
  파일을 읽고 어떤 명령을 실행하는지 **실시간으로 보여줍니다**.
- 위험한 작업(파일 삭제, 외부 명령 실행 등)은 **사용자가 승인할
  때까지 기다립니다**.
- 모든 동작이 **감사 로그(audit log)** 에 기록되어 나중에 검토할
  수 있습니다.

> 이 도구는 Claude나 Codex를 대체하지 않습니다. 두 AI를 안전한
> 환경에서 사용할 수 있게 도와주는 **감독 계층(oversight layer)**
> 입니다.

---

## §2 설치 전 필요한 것

| 항목 | 필수 여부 | 설명 |
| --- | :---: | --- |
| Windows 10 / 11 (PowerShell 기본 포함) | 필수 | macOS / Linux도 지원되지만 Windows가 1급 환경입니다. |
| Node.js 24 이상 | 필수 | https://nodejs.org/ 에서 LTS 버전을 받으세요. 설치 후 `node --version` 명령으로 확인. |
| Claude CLI 또는 Codex CLI | 권장 | AI 작업 기능을 쓰려면 둘 중 하나는 있어야 합니다. CLI는 각각 Anthropic / OpenAI 공식 사이트에서 받습니다. |
| 인터넷 연결 | 권장 | 첫 실행 시 npm 의존성 확인. 이후에는 오프라인에서도 동작합니다. |

> **중요**: Harness는 사용자의 **Claude나 Codex 비밀번호를 받지
> 않습니다.** 로그인은 각 AI 도구의 공식 흐름을 따릅니다. Orchestrator
> 화면에서 비밀번호 입력을 요구하는 일은 없습니다.

---

## §3 처음 실행 (Quick Start)

### §3.1 압축 풀기

배포된 zip 파일을 원하는 위치에 풀어주세요. 권장 위치는 `C:\Tools\HarnessPipeline\` 같은 경로입니다.

### §3.2 더블클릭으로 실행

`orchestrator-start.bat` 파일을 **더블클릭**하세요. 검은색 명령 프롬프트
창이 뜨면서 다음과 같은 메시지가 차례로 나타납니다:

```
[orchestrator-start] Node v24.x.x detected.
[orchestrator-start] dev mode: launching from C:\Tools\HarnessPipeline\
[orchestrator-start] starting supervisor (node start.js)...
[orchestrator-start] server up at http://127.0.0.1:4201
```

마지막 줄이 보이면 자동으로 브라우저가 열려서 대시보드 화면이
나타납니다.

### §3.3 정상 동작 확인

브라우저에 다음 화면이 보이면 성공입니다:

- 상단에 "Orchestrator Pipeline" 제목
- 가운데에 4개의 카드 (AI 작업 중 / 승인 필요 / 최근 작업 / Claude·Codex 연결됨)
- 우측 상단에 현재 시간과 서버 상태

이 화면이 나타나면 §5로 이동해 Claude/Codex를 연결하세요.

---

## §4 화면이 열리지 않을 때 (자주 있는 문제)

### §4.1 "Node.js not found on PATH" 메시지

원인: Node.js가 설치되지 않았거나 PATH에 등록되지 않음.

해결:
1. https://nodejs.org/ 접속
2. LTS 버전 다운로드 (24.x 이상)
3. 설치 마법사를 끝까지 따라가기 (기본 옵션이면 충분)
4. 컴퓨터 재시작 (PATH 갱신을 위해)
5. `orchestrator-start.bat` 다시 더블클릭

### §4.2 "server did not respond within 10s" 메시지

원인: 서버가 부팅되었지만 포트 4201이 다른 프로그램에 의해 점유됨,
또는 시작 중에 오류 발생.

해결:
1. 명령 프롬프트 창의 메시지를 위로 스크롤해서 빨간색 오류
   메시지를 찾으세요.
2. "EADDRINUSE" 오류가 보이면 다른 프로그램이 같은 포트를 쓰고
   있습니다. 다음 명령으로 확인:
   ```
   netstat -ano | findstr :4201
   ```
3. 다른 포트로 실행하려면 `orchestrator-start.bat` 실행 전에:
   ```
   set ORCHESTRATOR_PORT=4301
   orchestrator-start.bat
   ```

### §4.3 브라우저가 안 열리거나 빈 페이지가 나옴

원인: `start ""` 명령이 작동하지 않거나 기본 브라우저가 설정되지 않음.

해결: 브라우저를 직접 열고 주소창에 `http://127.0.0.1:4201` 입력.

### §4.4 회사 보안 정책으로 SmartScreen이 차단

Windows Defender SmartScreen이 "PC 보호"를 표시하면:
1. **추가 정보** 클릭
2. **실행** 클릭

이 단계는 **신뢰하는 출처(예: 사내 공유)** 에서 받은 zip만
실행하세요. 모르는 곳에서 받은 파일은 절대 실행하지 마세요.

---

## §5 Claude / Codex 연결하기

대시보드 우측 상단의 ⚙️ Settings 아이콘을 클릭하면 Accounts 메뉴가
나옵니다.

### §5.1 Claude 연결

1. **Claude CLI가 설치되어 있는지** 명령 프롬프트에서 확인:
   ```
   claude --version
   ```
   버전이 나오면 OK. 안 나오면 https://docs.anthropic.com/claude-code/ 에서 설치.
2. 같은 프롬프트에서 `claude` 로그인 흐름 따라가기:
   ```
   claude login
   ```
   브라우저 창이 열리고 Anthropic 계정으로 로그인하라고 안내합니다.
3. Settings → Accounts → Test Claude 클릭. 초록색 ✓ 가 나오면 연결 완료.

### §5.2 Codex 연결

Claude와 동일한 방식이지만 OpenAI 계정을 사용합니다:

```
codex --version    # 설치 확인
codex login        # 로그인
```

> **이 단계에서 Orchestrator 화면은 비밀번호를 묻지 않습니다.**
> Test 버튼은 단순히 "CLI가 설치되어 있고 로그인되어 있는지"
> 확인할 뿐입니다. 비밀번호는 Anthropic / OpenAI 공식 화면에서만
> 입력합니다.

---

## §6 첫 작업 시작하기

대시보드 메인 화면에서 "Send to Codex" 또는 "Send to Claude" 버튼을
누르고 작업 내용을 한국어 또는 영어로 적으세요.

### §6.1 작업 진행 상황 보기

작업이 시작되면 화면에 두 영역이 나타납니다:

- **AI 작업 중**: 현재 무슨 도구를 쓰고 있는지 (Read / Write / Bash 등)
- **타임라인**: 단계별 진행 기록

### §6.2 승인 카드 (Approval Card)

위험한 작업(파일 쓰기 / 명령 실행)을 AI가 시도하면 화면에 승인
카드가 뜹니다. 카드는 다음을 표시합니다:

- 어떤 도구를 쓰려고 하는지 (예: `Bash`, `Write`)
- 무엇을 입력값으로 쓸지 (예: `rm temp/*.log`)
- ⏱ 30초 카운트다운

**[허용]** / **[거부]** 중 선택하세요. 30초 안에 누르지 않으면
자동으로 거부됩니다 (안전장치).

### §6.3 결과 확인

작업이 끝나면 "최근 작업" 카드에서 결과를 확인할 수 있습니다.
필요하면 같은 작업을 Codex에게 검토(critique)시킬 수도 있습니다 —
"Send to Codex" → preset 선택.

---

## §7 안전장치 이해하기

Harness가 자동으로 차단하는 것들:

| 차단되는 것 | 이유 |
| --- | --- |
| 시스템 디렉토리(`C:\Windows\`)에 파일 쓰기 | 운영체제 파일 손상 방지 |
| 외부 네트워크로 비밀번호/토큰 전송 | 자격 증명 유출 방지 |
| 사용자 모르게 권한 상승 (관리자 권한) | 의도하지 않은 시스템 변경 방지 |
| 개인정보(주민번호, 계좌번호 등) 패턴 포함 명령 | PII 보호 (공공기관 모드에서 강화) |

**차단되었다고 해서 오류가 아닙니다** — 안전장치가 의도대로
작동한 것입니다. 차단된 이유는 화면 하단의 알림 또는 감사 로그에서
확인할 수 있습니다.

---

## §8 도움이 필요할 때

| 상황 | 어디서 도움받기 |
| --- | --- |
| 위 §4의 해결책으로 안 풀림 | 명령 프롬프트의 빨간색 오류 메시지를 그대로 캡처해서 운영자에게 전달. |
| Claude/Codex 자체가 작동 안 함 | Claude는 https://docs.anthropic.com/, Codex는 https://platform.openai.com/docs/ 에 문의. Orchestrator 문제가 아닙니다. |
| 승인 카드의 결정이 어려움 | 명령 내용이 이해가 안 되면 거부하세요. 거부는 안전한 기본값입니다. 다시 부탁하면 같은 작업을 새로 시도합니다. |
| 더 자세한 기능 안내 | [`../orchestrator-pipeline-distribution-guide.md`](../orchestrator-pipeline-distribution-guide.md) — 운영자용 통합 가이드. |
| 보안/감사 관련 질문 | [`../security-model.md`](../security-model.md) + [`../public-sector-hardening-plan.md`](../public-sector-hardening-plan.md). |

---

## §9 다음 단계

이 문서는 첫 실행에 필요한 최소한만 다뤘습니다. 더 알아보려면:

- **운영자 가이드**: [`../operator-guide.md`](../operator-guide.md) — `orchestrator-start` launcher의 모든 옵션 설명.
- **배포 전 점검**: [`deployment-readiness.md`](deployment-readiness.md) — 새 버전을 받았을 때의 확인 사항.
- **현장 시험**: [`field-pilot-deployment-log.md`](field-pilot-deployment-log.md) — 일주일 사용 기록 템플릿.
- **AI 협업 흐름**: [`live-verify-review-relay.md`](live-verify-review-relay.md) — Claude → Codex 검토 → Claude 흐름 상세.

## §10 References

- [`../README.md`](../README.md) — top-level documentation index.
- [`../../README.md`](../../README.md) — project-root README (quick-start).
- [`../operator-guide.md`](../operator-guide.md) — launcher 전체 옵션.
- [`../scorecard.md`](../scorecard.md) — 현재 성숙도 점수.
