# Phase 3-S — 보안 재구현 backlog (정본 추적용 요약)

이 문서는 `harness-pipeline-analysis` 정본 리포 위에서 진행 중인 보안
강화 라운드(Phase 3-S)의 짧은 추적표입니다. 슬라이스별 의도와 진행
상태만 담고, 자세한 reimpl 가이드/risk 분석/원본 reference 매핑은
개인 플랜 폴더의 backlog를 참조합니다.

- 개인 backlog (full): `~/.claude/plans/security-reimpl-backlog-2026-04-27.md`
- Phase 2.5 plan: `~/.claude/plans/swift-waddling-hanrahan.md`

## 운영 규칙 (변경 금지)

- 정본 working tree: `C:\Users\SJ\harness-pipeline-analysis` (master).
- workspace 보존(read-only reference, 절대 수정 금지):
  - archive: `C:\Users\SJ\archive\workspace-2026-04-27\`
  - bundle: `C:\Users\SJ\archive\workspace-pipeline-dashboard-2026-04-27.bundle`
  - GitHub: `backup/workspace-pre-cleanup-2026-04-27` @ `cbeb944`
- merge / cherry-pick **금지**. workspace 코드는 의도 reference로만 사용,
  정본의 Phase 2.5 구조 위에서 다시 구현.
- 한 슬라이스 = 한 커밋 = 회귀 green = 다음 슬라이스. 순서 고정.

## 슬라이스 진행 상태

| 슬라이스 | 의도 | 상태 | 커밋 |
|---|---|:---:|---|
| **S1** | Loopback 바인딩 + 토큰 게이트 + WS Origin 검증 + `.env.example` + `auth.js` 단위 테스트 | **DONE** | `a350357` |
| **S2** | File access sandbox 강화 (Windows case + triggerId slug + skill-registry pathSandbox 통합) | **DONE** | `98bc99c` |
| **S3-a** | childRegistry 신규 + runner integration + gracefulShutdown SIGTERM→1s→SIGKILL | **DONE** | `bb40c22` |
| **S3-b** (선택) | codex-runner Windows `shell: true` → `cmd.exe /c` wrapper (Node 24 DEP0190 대응) | TODO | — |

S1 결과 (커밋 `a350357`): `server.js`의 `wss.on("connection")` 진입부에
공통 검증 헬퍼(`verifyWsConnection`)를 두어 일반 pipeline event WS도
loopback / token / origin 정책을 따른다. 정본의 `src/security/auth.js`
는 이미 풍부한 미들웨어를 갖추고 있어 재구현보다 보강 + 누락 보완 +
회귀 보호 테스트(unit 17 + integration 13) 위주로 마감.

S2 결과 (커밋 `98bc99c`): pathSandbox에 Windows case-insensitive
double-check, `validateCodexTrigger`에 triggerId slug regex
(`/^[a-zA-Z0-9._-]+$/`), `skill-registry.js getSkillContent`를
`resolveInsideRoot`로 통합 (slug regex는 첫 방어층 유지). 신규/확장
테스트 unit +38 / integration +18.

S3-a 결과 (커밋 `bb40c22`): `src/runtime/childRegistry.js` 신규.
claude/codex runner가 spawn 직후 `register({label, runId})` →
close/error 시 `unregister`. server.js `gracefulShutdown` 시퀀스를
SIGTERM → 1s grace → SIGKILL → exit으로 교체 (이전: 단순 400ms 후
exit, zombie 위험). 신규 테스트 unit +16 / integration +7.

부수 정리: `scripts/env-check.ps1` 의 archived 디렉토리 노이즈와
untracked count 버그 동시 수정 (`e7162dd`).

## S3-b 후속 (별도 슬라이스로 보류)

`executor/codex-runner.js:135`의 `shell: process.platform === "win32"`는
Node 24 DEP0190 경고 후보 + shell quoting 위험. workspace P1-5
(`e24a83c`)의 `shell:false` + `cmd.exe /c <cmd>` wrapper 패턴이 더 안전.
단 spawn 동작 변경이라 codex 호출 회귀(quote/escape/glob)가 발생할 수
있어 별도 슬라이스에서 진행. 그 동안은 정본 동작(shell:true)을 유지하며
경고만 허용.

## 미래 backlog (선별)

개인 backlog의 "Group A 문서 이식" / "Group D Watcher·UI·Test 통합" /
"Group E workspace plan" 항목은 우선순위 낮음. S2/S3 완료 후 별도
라운드에서 선별 검토. Cherry-pick 대신 의도 재구현 원칙은 동일.

## 회귀 보호 체크리스트 (각 슬라이스 완료 후)

- [ ] `npm run test:unit && test:integration && test:legacy && test:smoke` 0 fail
- [ ] `npm run verify:hooks` PASS
- [ ] `pwsh -File scripts/env-check.ps1` 정본 in-sync
- [ ] commit + push to origin/master
- [ ] workspace archive read-only — 변경 없음

---

문서 작성: 2026-04-27 (S1 green 직후, S2 진입 전).
