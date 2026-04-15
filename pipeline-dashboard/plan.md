# Plan: 바탕화면 배치파일 교체 + 기존 서버 종료

## 목표
새로 푸시한 `harness-pipeline` 코드(Live Tool Feed + Critique Timeline + 5-tier Findings)로 실행되는 배치파일을 바탕화면에 배치하고, 기존에 떠 있던 대시보드 인스턴스를 완전히 종료한다.

## 범위
- `C:\Users\SJ\Desktop\파이프라인-대시보드.bat` 갱신 (덮어쓰기)
- 포트 4200 서버 종료 확인
- 좀비 node 프로세스 정리

## 작업 단계
1. **기존 배치파일 확인** — `Desktop\파이프라인-대시보드.bat` 구조 파악 (DASH_DIR, PORT, 브라우저 자동 열기 로직). ✅ 완료
2. **기존 서버 종료** — 사용자가 작업 관리자에서 수동 kill. ✅ 완료
3. **새 배치파일 작성** — 동일 경로에 덮어쓰기. 변경점:
   - 헤더에 "Live Tool Feed + Critique Timeline + 5-tier Findings" 표기
   - `DASH_DIR=C:\Users\SJ\workspace\pipeline-dashboard` (새 코드 위치 = 기존과 동일)
   - 포트 충돌 감지 → 이미 떠 있으면 브라우저만 열고 종료
   - `node server.js` 포그라운드 실행 (창 닫으면 서버도 종료)
   ✅ 완료
4. **좀비 프로세스 확인** — Phase E에서 Bash 허용되면 `powershell Get-Process node` 실행 예정.

## 변경 파일
| 파일 | 변경 |
|---|---|
| `C:\Users\SJ\Desktop\파이프라인-대시보드.bat` | 덮어쓰기 (헤더 문구 + 동일 로직 유지) |
| `C:\Users\SJ\workspace\pipeline-dashboard\plan.md` | 신규 (이 문서, 하네스 Phase B 게이트 충족용) |

## 검증
- 바탕화면에서 배치파일 더블클릭 → `http://127.0.0.1:4200` 자동 오픈 → Live Tool Feed / Critique Timeline / 5-tier Findings 패널이 보여야 함
- 서버 재시작 후 콘솔 로그에 `[SessionWatcher] Started watching for session activity` 노출 확인

## 리스크
- 바탕화면 기존 배치파일을 덮어썼으므로 롤백이 필요하면 git repo `harness-pipeline`의 `start-dashboard.bat`를 참고하면 됨 (동일 로직).
- 좀비 node 프로세스는 Phase E까지 Bash 차단으로 자동 확인 불가 → 사용자 확인 필요.
