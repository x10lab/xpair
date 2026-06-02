# RemotePair

원격(mosh/ssh)으로 attach하는 persistent tmux 세션 안의 **Claude Code가 macOS 빌트인 computer-use(스크린샷·클릭·타이핑)를 쓸 수 있게** 하는 시스템.

헤드리스 24h Mac 서버에 `mosh`로 붙어 `tmux` 세션에서 `claude`를 돌리면서도 — 그 claude가 화면을 보고 마우스/키보드를 조작할 수 있다. 터미널 + 가벼운 원격 + 영속 + computer-use, 네 조건 동시 충족.

---

## 왜 어려운가 (macOS TCC 2-게이트)

빌트인 computer-use는 claude 프로세스가 **두 권한**을 가져야 한다:
- **SR (Screen Recording / 화면 기록)** — 스크린샷. **responsible-process 체인**으로 평가 (daemon 거쳐도 상속).
- **AX (Accessibility / 손쉬운 사용)** — 클릭·타이핑(CGEvent 합성입력). **host .app의 activation policy + Aqua graphic-session**으로 평가.

핵심 사실:
- `claude-code` CLI는 버전경로 + 비-.app이라 **System Settings 권한 목록에 등록조차 안 됨** → 직접 grant 불가.
- 따라서 **권한을 가진 .app(RemotePair)이 host가 되어**, claude를 자기 프로세스 서브트리에 두고 권한을 상속시켜야 한다.
- **tmux 기본은 막힘**: `proc.c`의 `proc_fork_and_daemon()`이 `daemon(3)`으로 서버를 launchd로 reparent → claude가 host 서브트리에서 빠져나가 AX 실패. (SR은 responsible-pid가 sticky라 살지만 AX는 죽음.)
- SIP enabled + non-MDM에서는 `sudo`/`tccutil`/PPPC로 TCC 부여 불가 → **System Settings 사용자 토글만**.

폐기한 접근: `launchctl asuser`(audit session만, responsible=launchd라 부족), `reattach-to-user-namespace`(pasteboard만), `cliclick`(자체 TCC 필요한 틀린 프록시), osacompile **applet**(graphic-session 없어 AX 실패).

## 해법 아키텍처

```
login → LaunchAgent(KeepAlive) → RemotePair.app  (메뉴바, AX+SR granted)
   └─ script(pty) → tmux-aqua 서버 (/tmp/aqua-tmux.sock, _keeper 세션)   ← RemotePair 서브트리
        └─ (launcher가 추가한 claude 세션) → computer-use ✅
[원격]  mosh → tmux-aqua -S /tmp/aqua-tmux.sock attach   (client 무관 — claude는 서버 자식)
```

- **patched tmux (`tmux-aqua`)**: `daemon(1,0)` → `setsid()` + stdio redirect. reparent fork 제거 → 서버가 부모(RemotePair) 서브트리에 남는다.
- **RemotePair.app (네이티브 Swift, 메뉴바)**: ① `posix_spawn`으로 tmux-aqua 서버를 자식으로 붙듦(host) ② 1s 타이머로 `engine.applescript`(승인 다이얼로그 클릭)를 NSAppleScript in-process 실행(approve) ③ NSStatusItem으로 graphic-session 확보.
- claude는 **서버의 자식**이라, attach하는 client(mosh/ssh)가 무엇이든 RemotePair의 권한을 상속한다.

## 구성 파일

| 파일 | 역할 |
|---|---|
| `RemotePairNative/main.swift` | RemotePair 앱 소스 (approve + computer-use host) |
| `scripts/build-tmux-aqua.sh` | patched tmux 빌드 → `~/.local/bin/tmux-aqua` |
| `scripts/make-signing-cert.sh` | 안정 self-signed 코드서명 cert 생성 (재빌드에도 grant 유지) |
| `scripts/build-native.sh` | RemotePair.app 빌드·cert 서명 (+ `--deploy`로 원격 마이그레이션 설치) |
| `install/` | 가역적 설치/원복(`install.sh`/`uninstall.sh`) + 설정 단일출처(`config.sh`) + glue 원본(`glue/`) + sync 셋업 |
| `skills/approve/SKILL.md` | on-demand 승인 스킬 (claude 가 요청 → RemotePair 가 클릭) |
| `legacy/` | 구 osacompile 접근(보관용, 미사용) |

## 세팅 방법

대상 머신(예: gh-mac-m1)에서. Apple Silicon + Homebrew(tmux 설치돼 libevent/ncurses/utf8proc 존재) 가정.

### 1. patched tmux 빌드
```bash
./scripts/build-tmux-aqua.sh        # → ~/.local/bin/tmux-aqua  (tmux -V == 3.6)
```
tmux는 clang으로 빌드되니 대상 머신에서 직접 실행 가능. (앱(Swift)은 Xcode 있는 머신에서 빌드 후 배포.)

### 2. 안정 코드서명 cert (1회, 빌드 머신에서)
```bash
./scripts/make-signing-cert.sh        # login keychain 에 "RemotePair Local Signing" 생성 (idempotent)
```
ad-hoc 서명은 재빌드마다 cdhash 가 바뀌어 grant 가 무효화된다. 안정 cert 로 서명하면 TCC grant 가
**designated requirement (`identifier "com.ghyeong.remote-pair" and certificate leaf = H"…"`)** 에 묶여
같은 cert·bundle id 면 재빌드에도 유지된다. (Apple Developer 계정/공증 불필요 — 본인 기기 전용. p12 백업은 `~/Library/Application Support/RemotePair/signing.p12`, 다른 빌드 머신에서 import 하면 동일 정체성.)

### 3. RemotePair.app 빌드 + 배포
```bash
# Swift 툴체인(Xcode) 있는 머신에서:
./scripts/build-native.sh --deploy   # cert 서명 빌드 → scp → ~/Applications/RemotePair.app + LaunchAgent + watchdog (re)start
```
- LSUIElement 메뉴바 앱. `~/Applications/RemotePair.app`. cert 로 서명(없으면 ad-hoc 폴백).
- LaunchAgent `com.ghyeong.remote-pair`(RunAtLoad+KeepAlive) + `com.ghyeong.remote-pair-watchdog`(heartbeat 정지 시 재기동).
- 배포는 M4 cert 서명을 보존(원격 재서명 안 함) + quarantine 제거. 구 `com.ghyeong.auto-approve` 자동 정리.

### 3. 권한 부여 (1회, 물리화면/VNC 필요 — 부트스트랩 역설)
RemotePair 실행 후 claude가 computer-use를 처음 호출하면 권한 프롬프트가 뜬다. **System Settings → 개인정보 보호 및 보안**:
- **손쉬운 사용(Accessibility)**: `RemotePair` ON  (안 보이면 `+` → `~/Applications/RemotePair.app`)
- **화면 기록(Screen Recording)**: `RemotePair` ON
- 토글 후 RemotePair 재시작(LaunchAgent kickstart)으로 grant 픽업.

> ad-hoc 서명이면 재빌드마다 cdhash가 바뀌어 재토글 필요:
> ```bash
> tccutil reset Accessibility com.ghyeong.remote-pair; tccutil reset ScreenCapture com.ghyeong.remote-pair
> # 재시작 후 다시 토글
> ```
> 안정 self-signed cert로 서명하면 재빌드에도 grant 유지 (TODO).

### 4. 런처 연결 (이 저장소 밖, `~/.claude/bin/claude-iterm-launch`)
원격/로컬 모두 세션을 `tmux-aqua -S /tmp/aqua-tmux.sock new-session`으로 RemotePair-hosted 서버에 추가하고, `tmux-aqua ... attach`로 붙는다. host 서버가 없으면 `open -a RemotePair`로 기동 보장.

## 사용
```bash
# (M4) CLAUDE.command → 원격 선택 → mosh attach. 또는 수동:
ssh gh-mac-m1 '~/.local/bin/tmux-aqua -S /tmp/aqua-tmux.sock new-session -d -s myproj -c ~/proj "claude"'
mosh gh-mac-m1 -- ~/.local/bin/tmux-aqua -S /tmp/aqua-tmux.sock attach -t myproj
# claude 안에서: "스크린샷 찍어줘" / "(x,y) 클릭해줘"  → 동작
```
매 세션 유일 상호작용 = claude 자체 "Allow for this session" 프롬프트(빌트인, Enter 1회).

## 트러블슈팅
- **claude update 후 'computer use not granted'** (#50735): claude 안에서 `/mcp disable computer-use && /mcp enable computer-use`로 현재 버전 helper 번들 재추출. (RemotePair grant와 별개 — claude.app helper 무결성.)
- **approve 클릭이 -1712(AppleEvent timed out)**: engine을 매 tick 메인스레드 실행 시 가능 → 백그라운드 실행 또는 비전 fallback(screencapture + claude 좌표)로 개선 예정.
- **재부팅 후**: LaunchAgent가 RemotePair → tmux-aqua 서버 자동 기동. `tmux-aqua -S /tmp/aqua-tmux.sock ls`로 `_keeper` 확인.

## 주의
개인 도구. ad-hoc/self-signed 서명. macOS 26(Tahoe)/Apple Silicon 개발·검증.
