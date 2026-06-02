# auto-approve

macOS GUI 승인 다이얼로그(1Password 인증, 방화벽 수신연결, 확인창 등)를 자동으로 클릭하는
네이티브 데몬. AppleScript + launchd + Accessibility(AX) 로 구현. 외부 런타임 의존성은
`cliclick`(좌표 클릭 폴백) 하나뿐.

## 구조: "한 번 빌드, 로직은 .claude 에서"

```
Lang-Swift/auto-approve/            ← 빌드 도구 (Syncthing sync)
  loader.applescript               ← .app 골격: 권한 보유 + engine 자동 로드   ★ 한 번만 빌드
  build.sh                         ← loader → ~/Applications/AutoApprove.app
  auto-approve-watchdog.sh         ← heartbeat 끊기면 kickstart
  1pw-auto-approve.sh              ← 수동 도구(레거시)

~/.claude/auto-approve/             ← 런타임 로직/규칙 (재빌드 0, 양 머신 sync)
  engine.applescript               ← 스캔·클릭·좌표폴백 엔진 (loader 가 mtime 보고 자동 컴파일)
  rules.txt                        ← 승인 규칙. 새 승인 = 여기 한 줄

~/Applications/AutoApprove.app      ← 빌드 산출물. Accessibility 권한 보유체
```

**핵심 원리**: `.app`(loader)은 권한만 들고, 실제 로직은 `~/.claude/auto-approve/` 를
**홈 기준으로 자동 감지**해 실행한다. `.app` 이 외부 스크립트를 자기 프로세스에서 실행하므로
AX 권한이 그대로 상속된다. → `.app` 만 각 머신에 배포하면 그 머신의 `.claude` 를 읽는다.

- `load script` 는 `.scpt` 만 받으므로, loader 가 `engine.applescript` 의 mtime 을 보고
  바뀌었을 때만 `osacompile`→`load script` 한다. **engine 텍스트만 고치면 자동 반영.**
- 규칙은 `rules.txt` 순수 텍스트라 컴파일조차 불필요 — 저장 즉시 다음 tick 에 반영.

## 빌드 (머신당 한 번)

```bash
./build.sh
# → ~/Applications/AutoApprove.app 생성
# 1) 시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용(Accessibility) 에 AutoApprove 허용
# 2) LaunchAgent 등록:
#    com.ghyeong.auto-approve            → AutoApprove.app/Contents/MacOS/applet  (KeepAlive)
#    com.ghyeong.auto-approve-watchdog   → auto-approve-watchdog.sh               (StartInterval 30)
```

ad-hoc 서명(`codesign -s -`)이라 **재빌드하면 권한이 무효화될 수 있다.** 그래서 한 번만 빌드한다.
로직/규칙은 빌드 없이 `~/.claude/auto-approve/` 에서 고친다.

## 규칙 추가 (`~/.claude/auto-approve/rules.txt`)

한 줄 = 한 규칙. 탭 구분:

```
proc<TAB>mode<TAB>label|label|...
```

- `proc`  : 대상 프로세스명 (`osascript -e 'tell app "System Events" to get name of every process'` 로 확인)
- `mode`  : `ax`(논리 클릭, 일반 다이얼로그) | `coord`(좌표 클릭, 방화벽 등 AX 가 막힌 보안창)
- `label` : 버튼 텍스트 후보들을 `|` 로 나열 (한/영)
- `#` 으로 시작하면 주석

예:
```
1Password	ax	Authorize|Allow|승인|허용|확인
mosh-server	coord	Allow|허용
Google Chrome	ax	Allow|승인|확인
```

## 로그

- `~/.claude/logs/auto-approve.log`        — 클릭/차단 이벤트
- `~/.claude/logs/auto-approve.heartbeat`  — 매 tick touch (watchdog 가 감시)
