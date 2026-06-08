# RemotePair

원격(mosh/ssh)으로 attach하는 persistent tmux 세션 안의 **Claude Code가 macOS 빌트인 computer-use(스크린샷·클릭·타이핑)를 쓸 수 있게** 하는 시스템.

헤드리스 24h Mac 서버(**host**)에 노트북(**client**)에서 붙어 `tmux` 세션의 `claude`를 돌리면서도 — 그 claude가 host 화면을 보고 마우스/키보드를 조작할 수 있다. 터미널 + 가벼운 원격 + 영속 + computer-use, 네 조건 동시 충족.

**2개 제품**으로 나뉜다:
- **RemotePairHost.app** — 원격 맥(host)에 설치되는 메뉴바 앱. tmux 데몬을 호스팅하고, 권한·세션·승인·업데이트를 관리.
- **`remote-pair` CLI** — 클라이언트 맥에 설치. Finder 폴더 우클릭 → **빠른 동작 → Launch Remote Pair** 로 host 의 tmux 데몬에 붙는다. 빌드·Xcode·권한 불필요.

하나의 host 에 **여러 client** 가 붙을 수 있고, 같은 폴더면 **같은 tmux 세션을 공유**(multi-attach)한다.

---

## 왜 어려운가 (macOS TCC 2-게이트)

빌트인 computer-use는 claude 프로세스가 **두 권한**을 가져야 한다:
- **SR (Screen Recording / 화면 기록)** — 스크린샷. responsible-process 체인으로 평가(daemon 거쳐도 상속).
- **AX (Accessibility / 손쉬운 사용)** — 클릭·타이핑(CGEvent 합성입력). host .app의 activation policy + Aqua graphic-session으로 평가.

핵심 사실:
- `claude-code` CLI는 버전경로 + 비-.app이라 **System Settings 권한 목록에 등록조차 안 됨** → 직접 grant 불가.
- 따라서 **권한을 가진 .app(RemotePairHost)이 host가 되어**, claude를 자기 프로세스 서브트리에 두고 권한을 상속시켜야 한다.
- **tmux 기본은 막힘**: `proc.c`의 `proc_fork_and_daemon()`이 `daemon(3)`으로 서버를 launchd로 reparent → claude가 host 서브트리에서 빠져나가 AX 실패.
- SIP enabled + non-MDM에서는 `sudo`/`tccutil`/PPPC로 TCC 부여 불가 → **System Settings 사용자 토글만**.

## 해법 아키텍처

```
[host: gh-mac-m1]  login → LaunchAgent(KeepAlive) → RemotePairHost.app  (메뉴바, AX+SR granted)
   └─ script(pty) → tmux-aqua 서버 (/tmp/aqua-tmux.sock, _keeper 세션)   ← RemotePairHost 서브트리
        └─ (client launch 가 추가한 claude 세션) → computer-use ✅

[client: gh-mac-m4]  Finder Service / `remote-pair launch <dir>`
   → 경로 매핑(client→host) → ssh setup(세션 생성/공유) → mosh attach
```

- **patched tmux (`tmux-aqua`)**: `daemon(1,0)` → `setsid()` + stdio redirect. reparent fork 제거 → 서버가 부모(RemotePairHost) 서브트리에 남는다.
- **RemotePairHost.app (네이티브 Swift, 메뉴바)**: ① `posix_spawn`으로 tmux-aqua 서버를 자식으로 붙듦 ② on-demand approve 라우터(OCR 승인창 클릭) 스폰 ③ 동적 세션 목록·권한·설정·업데이트 메뉴 ④ NSStatusItem 으로 graphic-session 확보.
- claude는 **서버의 자식**이라, attach하는 client(mosh/ssh)가 무엇이든 RemotePairHost의 권한을 상속한다.

## 자기완결 네임스페이스 — `~/.remote-pair`

RemotePair 의 모든 런타임 상태·설정은 `~/.remote-pair` 아래 산다. **`~/.claude` 동기화 여부에 의존하지 않는다.**

| 경로 | 내용 |
|---|---|
| `~/.remote-pair/{common,host,client}.env` | role 별 설정 (서로 침범 안 함) |
| `~/.remote-pair/logs/` | `remote-pair.log` · `remote-pair.heartbeat` |
| `~/.remote-pair/rules.txt` | approve 라우터 룰 (즉시 반영) |
| `~/.remote-pair/bin/` | 런처·watchdog·hangul-romanize |
| `~/.remote-pair/.manifest-*` · `backups/` | 가역 설치 기록 |
| `~/.claude/skills/approve/` | **유일한 `~/.claude` 설치물** — 클로드 하네스가 보는 위치 |

> `~/.claude` git-sync(두 기기의 에이전트 정체성 공유)는 **선택적 개인 편의 기능**(`--with-sync`)일 뿐, RemotePair 동작의 전제가 아니다. sync 가 없거나 실패해도 launch 는 성공한다.

## 구성 파일

| 파일 | 역할 |
|---|---|
| `host/RemotePairHost/*.swift` | 호스트 앱 (Config/HostManager/ApproveManager/Sessions/Permissions/SettingsWindow/Updater/AppDelegate/main) |
| `host/build-tmux-aqua.sh` | patched tmux 빌드 → `~/.local/bin/tmux-aqua` |
| `host/make-signing-cert.sh` | 안정 self-signed 코드서명 cert (재빌드·업데이트에도 grant 유지) |
| `host/build-host.sh` | RemotePairHost.app 빌드·서명 (+`--deploy` 원격 설치 / `--release` GitHub Releases) |
| `host/rules.txt` · `host/remote-pair-approve-router.sh` · `host/ocr-find.swift` | approve 룰 템플릿 + 라우터 + OCR (앱 번들에 임베드) |
| `host/skills/approve/SKILL.md` | on-demand 승인 스킬 (claude 가 요청 → RemotePairHost 가 클릭) |
| `client/remote-pair` | 클라이언트 CLI (launch/ls/map/doctor/approve/status/host) |
| `client/remote-pair-launch` | 런처 (경로매핑·세션공유·비인터랙티브) |
| `client/Launch Remote Pair.workflow` | Finder Service |
| `shared/` | 가역적 설치/원복(`install.sh`/`uninstall.sh`) + 설정 단일출처(`config.sh`) + 부트스트랩(`bootstrap.sh`) |
| `shared/bootstrap.sh` | `curl … \| bash` 원샷 설치 (role 별) |

## 설치 (사용자)

```bash
# host (claude 가 computer-use 로 도는 머신 — 빌드+권한 1회)
curl -fsSL https://raw.githubusercontent.com/ghyeongl/remote-pair/main/shared/bootstrap.sh | ROLE=host bash

# client (앉아서 띄우는 노트북 — 빌드 없음)
curl -fsSL https://raw.githubusercontent.com/ghyeongl/remote-pair/main/shared/bootstrap.sh | ROLE=client bash
```

| role | 설치물 | 빌드 | 권한 토글 |
|---|---|---|---|
| **host** | `RemotePairHost.app`(tmux-aqua·router·ocr-find 임베드) + LaunchAgent + watchdog + approve(skill/rules) | 필요 | 필요(1회) |
| **client** | Service "Launch Remote Pair" + 런처 + `remote-pair` CLI | 불필요 | 불필요 |

- 되돌리기: `~/.local/share/remote-pair/shared/uninstall.sh` (manifest 기반 정확한 원복). `--purge` 로 `~/.remote-pair` 까지.
- client 설치는 끝에 `remote-pair doctor` 로 **SSH 키 연결**을 점검·안내한다.

## 사용

```bash
# 1) 두 기기에서 같은 내용인 폴더 매핑 (외부 sync = Google Drive/Syncthing 등이 내용 동기화).
#    절대경로가 달라도 됨.  client 경로  →  host 경로
remote-pair map add ~/Drive/proj /Users/ghyeong/proj
remote-pair map ls

# 2) 폴더로 세션 실행·attach (또는 Finder 폴더 우클릭 → 빠른 동작 → Launch Remote Pair)
remote-pair launch ~/Drive/proj
#   - 같은 폴더를 다른 터미널/다른 client 에서 launch → 같은 tmux 세션 공유(multi-attach)
#   - 새 독립 세션을 원하면:  remote-pair launch ~/Drive/proj --fresh
#   - 비인터랙티브(프롬프트 없이):  RP_YES=1 remote-pair launch <dir>  또는 --yes

# 점검 / 현황
remote-pair doctor     # SSH 키·host 앱·tmux 점검 + 안내
remote-pair ls         # host 세션 + 매핑 목록
remote-pair status     # 앱·서버·heartbeat
```

매 세션 유일 상호작용 = claude 자체 "Allow for this session" 프롬프트(빌트인, Enter 1회).

### host 메뉴바 (RemotePairHost.app)
- **권한 상태 + Grant Permissions…** — AX/SR 현황 표시, 설정창 열기.
- **Sessions (N)** — 현재 tmux 세션 동적 목록 + attach 현황. 세션 클릭 → 모달(**Detach all** / **Kill session**).
- **Restart tmux host / Approve now**.
- **Settings…** — 소켓·버전·세션 cwd·자동 업데이트 토글.
- **Check for Updates…** — GitHub Releases 확인·적용.
- **About / Quit**.

## 빌드 (메인테이너)

Apple Silicon + Xcode(또는 CLT) + Homebrew(tmux 정적 빌드 의존성).

```bash
./host/build-tmux-aqua.sh        # patched tmux → ~/.local/bin/tmux-aqua  (tmux -V == 3.6)
./host/make-signing-cert.sh      # 안정 cert "RemotePair Local Signing" (1회, idempotent)
./host/build-host.sh             # → build/RemotePairHost.app (서명·검증)
./host/build-host.sh --deploy [host]   # 위 + rsync → 원격 → install.sh --role host
```

- **안정 cert** 가 핵심: ad-hoc 서명은 재빌드마다 cdhash 가 바뀌어 grant 무효화. 안정 cert 로 서명하면 TCC grant 가 designated requirement 에 묶여 **재빌드·업데이트에도 유지**. (Apple Developer/공증 불필요 — 본인 기기 전용. p12 백업: `~/Library/Application Support/RemotePair/signing.p12`.)
- CLT(Swift 5.10) + 최신 SDK 조합이 깨지면 `build-host.sh` 가 자동으로 호환 SDK(14.x)로 폴백한다.

### 권한 부여 (1회, 물리화면/VNC 필요)
RemotePairHost 실행 후 claude 가 computer-use 를 처음 호출하면 프롬프트가 뜬다. **System Settings → 개인정보 보호 및 보안**:
- **손쉬운 사용(Accessibility)**: `RemotePairHost` ON  (안 보이면 `+` → `~/Applications/RemotePairHost.app`)
- **화면 기록(Screen Recording)**: `RemotePairHost` ON
- 토글 후 메뉴 **Restart tmux host** 또는 `launchctl kickstart -k gui/$(id -u)/com.x10lab.remote-pair-host`.

### 릴리스 (GitHub Releases)
```bash
RP_VERSION=4.1.0 ./host/build-host.sh --release   # 서명앱 zip → gh release create v4.1.0
```
- 릴리스 자산은 반드시 **동일 안정 cert** 로 서명돼야 업데이트 후에도 grant 가 유지된다(앱 Updater 가 leaf CN 검증; 불일치 시 경고).
- 앱 메뉴 **Check for Updates…** → 다운로드 → `codesign --verify` → 스왑 → 재기동.

## 트러블슈팅
- **claude update 후 'computer use not granted'**: claude 안에서 `/mcp disable computer-use && /mcp enable computer-use`.
- **SSH 키 인증 실패**: `remote-pair doctor` 안내대로 `ssh-keygen` / `ssh-copy-id $REMOTE_HOST` / `~/.ssh/config`. 1Password SSH agent 면 승인창을 `remote-pair approve` 로 자동 클릭.
- **재부팅 후**: LaunchAgent 가 RemotePairHost → tmux-aqua 서버 자동 기동. `tmux-aqua -S /tmp/aqua-tmux.sock ls` 로 `_keeper` 확인.

## 주의
개인 도구. ad-hoc/self-signed 서명. macOS 26(Tahoe)/Apple Silicon 개발·검증.
