# RemotePair 내부 아키텍처

RemotePair가 "원격에서 붙은 `claude`가 macOS Computer Use(스크린샷·클릭·타이핑)를 계속 쓰게" 만드는 방법을 코드 기준으로 설명한다. 파일경로:라인은 실제 구현 위치다.

> 사용자용 설치/사용법은 [README](../README.md) 참고. 이 문서는 동작 원리/내부 계약에 집중한다.

---

## 1. 구성요소

| 영역 | 산출물 | 책임 |
|---|---|---|
| **host** | `RemotePairHost.app` (메뉴바 앱) | 권한 경계. AX·SR(필요시 FDA)를 쥐고, patched tmux 서버를 자기 자식으로 붙들어 `claude`에 권한을 상속시킨다. |
| **client** | `remote-pair` CLI + `remote-pair-launch` + Finder Service | 두뇌(권한 0). 폴더 매핑을 풀고 SSH/mosh로 호스트에 붙어 세션을 attach/생성한다. |
| **shared** | `install.sh` · `config.sh` · `bootstrap.sh` | 역할 기반 가역 설치, 설정 SSOT, 원샷 부트스트랩. |

호스트 앱은 self-signed(공증 X). 앱 번들 `Contents/Helpers`에 `tmux-aqua`·`remote-pair-approve-router.sh`·`ocr-find`·`cliclick`을 동봉하고, 없으면 외부 경로로 폴백한다 (`host/RemotePairHost/Config.swift:13`).

---

## 2. 권한 상속 메커니즘 (핵심)

`claude`를 SSH로 띄우면 macOS가 그 프로세스에 AX/SR을 주지 않는다. RemotePair는 **권한을 가진 앱의 프로세스 서브트리 안에 tmux 서버를 두고**, 세션을 그 서버에 붙여 권한을 상속시킨다.

```
launchd (LaunchAgent: com.x10lab.remote-pair-host.plist)
  └─ RemotePairHost.app          ← TCC가 AX·SR·FDA grant를 여기에 묶음
       └─ /usr/bin/script -q /dev/null   ← pty 확보 (posix_spawn)
            └─ tmux-aqua -S /tmp/aqua-tmux.sock  (server, _keeper 세션)
                 └─ [원격 attach된 claude 세션들]  ← AX·SR 상속 → Computer Use 동작
```

- `HostManager.spawn()`이 `/usr/bin/script -q /dev/null tmux-aqua -S <sock> new-session -s _keeper "sleep 2147483647"`를 `posix_spawn`으로 띄운다 (`host/RemotePairHost/HostManager.swift:48-71`).
- `_keeper`는 서버가 절대 비지 않게 하는 더미 세션. 서버 소켓은 `/tmp/aqua-tmux.sock` (`Config.swift:20`).
- **patched tmux(`tmux-aqua`)** 가 핵심: 보통 tmux는 서버를 데몬화하며 launchd로 reparent돼 앱 체인을 벗어난다. `tmux-aqua`는 `daemon→setsid`만 하고 reparent하지 않아 서버 PPID가 앱 체인에 남는다 (`HostManager.swift:1-4`).
- `AppDelegate`가 5초마다 `host.ensureServer()`로 서버 생존을 확인하고, 죽었으면 재기동한다 (`AppDelegate.swift:41`).
- 좀비(defunct) 오판 방지: `posix_spawn` 후 `waitpid(WNOHANG)`로 좀비를 reap하고 죽음으로 판정해야 영구 미기동을 피한다 (`HostManager.swift:20-26`).

TCC는 **공증이 아니라 안정적 코드서명 정체성(designated requirement)** 에 grant를 묶는다. 안정 self-signed cert로 서명하면 재빌드·업데이트에도 grant가 유지된다. → [설치/상태 모델](#6-설치상태-모델).

---

## 3. CLI↔앱 primitive 채널 (InputServer)

앱은 "권한 경계"고 CLI(에이전트 두뇌)는 권한이 0이다. CLI가 좌표/타이밍/재시도/OCR을 다 결정하고, **원자적 권한 primitive 하나**만 앱에 요청한다. 앱은 요청당 primitive 하나만 실행해 권한을 그 안에서만 쓴다 (`host/RemotePairHost/InputServer.swift:1-7`).

**채널 = 파일 두 개** (`Config.swift:30-31`):

| 파일 | 방향 | 내용 (탭 구분) |
|---|---|---|
| `/tmp/remote-pair.input-req` | CLI → 앱 | `shot\t<outpath>` · `click\t<x>\t<y>` · `key\t<combo>` |
| `/tmp/remote-pair.input-res` | 앱 → CLI | `ok` · `ok\t<path>` · `err\t<msg>` |

- `AppDelegate`의 `inputTimer`가 0.1초마다 `InputServer.tick()` 호출 → 요청 파일이 있으면 소비(1요청=1응답)하고 응답을 쓴다 (`AppDelegate.swift:44`, `InputServer.swift:16-24`).
- primitive 매핑 (`InputServer.swift:26-41`):
  - `shot` → `/usr/sbin/screencapture -x` (**SR** 사용)
  - `click` → `cliclick c:<x>,<y>` (**AX** 사용)
  - `key` → `osascript`로 System Events `key code`/`keystroke`
- **키는 왜 osascript인가**: `cliclick`의 CGEvent 합성키는 Chrome 확장 팝업 같은 웹 UI에 안 먹힌다(실측). System Events 경로는 먹힌다 (`InputServer.swift:43-44`). `cmd+return`→`key code 36 using {command down}`, 일반키→`keystroke "x"` (`InputServer.swift:46-69`).
- `screencapture`·`cliclick`은 앱(granted)의 자식으로 실행되어 권한을 상속 → 권한 사용은 앱 안에서만 일어난다.

---

## 4. 세션 흐름 (client → host)

`remote-pair launch <folder>` (또는 Finder Service) → `remote-pair-launch`가 처리 (`client/remote-pair-launch`).

1. **설정 로드** — `~/.remote-pair/{common,host,client}.env`를 source. `REMOTE_HOST`, `FOLDER_MAPS`, `AQUA_SOCK` 등 (`remote-pair-launch:20-34`).
2. **폴더 매핑** — 클라이언트 경로 → 호스트 경로 변환. 같은 프로젝트가 외부 동기화(Google Drive/Syncthing/iCloud)로 양쪽에 있지만 절대경로가 다를 수 있어, `FOLDER_MAPS`로 매핑한다 (`remote-pair-launch:4-6`). → [폴더 매핑](../README.md#folder-mapping-do-this-first).
3. **결정적 세션 이름** — 호스트 경로 기반 `<HOST>_…`. 상태바만 봐도 어느 머신인지 안다 (`remote-pair-launch:7-8`).
4. **접속** — mosh(권장)/ssh로 호스트에 붙어, `tmux-aqua -S /tmp/aqua-tmux.sock`의 세션에 attach하거나 생성한다. 이 소켓이 **2장의 권한 상속 서버**라서, 여기 붙은 `claude`가 Computer Use를 쓴다 (`remote-pair-launch:10-12`).
5. **`_N` 넘버링** — 1:1 연결만 지원(세션 공유 X). `_1`에 이미 클라이언트(탭)가 attach돼 있으면 `_2`를 새로 열고, detached 세션은 `attach -d`로 가져온다 (`remote-pair-launch:9`).

비대화 모드: `RP_YES=1` / `--yes`로 모든 프롬프트(디렉터리 자동생성 등) 생략 (`remote-pair-launch:13`).

---

## 5. approve 라우터 (승인 다이얼로그 자동 클릭)

헤드리스 호스트에서 "허용?" 다이얼로그나 1Password 잠금 프롬프트가 뜨면 세션이 멈춘다. 라우터가 이를 감지해 누른다.

- **트리거** — `AppDelegate.poll()`(1초 틱)이 `/tmp/remote-pair.approve-request` 존재를 확인하면 `ApproveManager.run()` → 라우터를 **앱의 자식으로** 실행(권한 상속) (`AppDelegate.swift:140-144`, `Config.swift:26`).
- **라우팅은 전부 라우터** — claude/스킬은 "막히면 트리거"만, 어떤 창을 어떻게 허용할지는 `remote-pair-approve-router.sh`가 결정 (`host/remote-pair-approve-router.sh:4-5`).
- **3단계 동작** (`approve-router.sh:7-11`):
  1. 적응형 폴링 — 트리거 직후 창이 아직 없어도 `WAIT_SECS`(기본 18s) 동안 출현을 기다림.
  2. 하이브리드 비전 — `ocr-find` 룰 우선(빠름), 미스 시 haiku(`claude-haiku-4-5`)가 "알려진 창 분류"만 수행(좌표는 룰이).
  3. 검증 루프 — 클릭/키 후 재캡처해 마커가 사라졌는지 확인, 안 닫혔으면 재시도. `exit 0`=성공/`1`=실패.
- **rules.txt** (탭 구분: `id <TAB> marker <TAB> action`) — `marker`=감지/검증용 OCR 텍스트, `action`=`ocr:<라벨>`(버튼텍스트 찾아 클릭) 또는 `key:<콤보>` (`approve-router.sh:13-15`).
- 키 전송은 InputServer와 동일하게 osascript(System Events) — 웹 UI 팝업 호환.

---

## 6. 설치/상태 모델

### 네임스페이스 — `~/.remote-pair`

모든 런타임 상태가 여기 모인다(`~/.claude` 동기화에 의존 X) (`Config.swift:3`). 역할별 env 분리: `common.env`(공유) / `host.env` / `client.env` — 각 역할 설치가 자기 파일만 써서 교차 오염을 막는다 (`shared/config.sh`).

### status.json — 에이전트가 읽는 ground truth

`AppDelegate.poll()`(1초)이 `writeStatus()`로 `~/.remote-pair/logs/status.json`을 갱신 (`AppDelegate.swift:139`, `Config.swift:45-52`):

```json
{"ts":..,"pid":..,"version":"..","bundle_id":"..","socket":"/tmp/aqua-tmux.sock","ax":true,"sr":true,"fda":false}
```

`remote-pair status`/`doctor`가 pgrep 추측 대신 이 파일로 "앱 생존 + grant 사실"을 읽는다. `ts` 신선도로 생존 판단. 같은 루프가 `remote-pair.heartbeat`(watchdog가 읽음)도 touch (`Config.swift:23`).

### 자기설치 — Installer

GitHub Releases로 받은 `.app`이 `install.sh` 없이도 host가 되도록, 매 실행 `Installer.ensureInstalled()`가 불린다 (`AppDelegate.swift:22`, `Installer.swift:33-45`):

- 설치됨 + 버전 동일 → **진짜 no-op**(돌고 있는 tmux 서버 안 건드림).
- 버전 올라감 → 리소스(rules/skill/tmux-aqua)만 갱신, **grant·LaunchAgent·host.env(사용자 설정)는 보존**.
- 미설치 → 전체 설치. LaunchAgent plist 모양·라벨·경로는 `shared/config.sh`/`install.sh`의 `is_host` 섹션과 글자 단위로 일치해야 한다(SSOT) (`Installer.swift:5-7`).

LaunchAgent 라벨: `com.x10lab.remote-pair-host`(앱) / `…-watchdog`(워치독) (`Installer.swift:13-15`).

### TCC grant 지속성

안정 self-signed cert가 grant를 앱의 designated requirement에 묶어, 재빌드·인앱 업데이트에도 유지된다. **릴리스 바이너리가 같은 cert로 서명**돼야 머신 간/업데이트 간 grant가 안 깨진다 → 그래서 각자 빌드 대신 동일 서명 cask 배포를 쓴다.

---

## 7. 호스트 앱 파일 맵

| 파일 | 책임 |
|---|---|
| `main.swift` | 엔트리포인트 (NSApplication 기동) |
| `AppDelegate.swift` | 메뉴바(NSStatusItem), 동적 세션 목록, 타이머 3종(host 5s / poll 1s / input 0.1s), 권한·설정·업데이트·About 라우팅 |
| `Config.swift` | 경로/상수 SSOT, `status.json`/heartbeat/로그(5MB 회전), `runCapture` 헬퍼 |
| `HostManager.swift` | patched tmux 서버를 앱 자식으로 spawn/유지/reap |
| `InputServer.swift` | CLI↔앱 primitive 채널(shot/click/key) 실행기 |
| `Installer.swift` | 다운로드 .app 자기설치, 버전 스탬프 리소스 갱신 |
| `Permissions.swift` | AX/SR/FDA grant 체크 + 시스템 설정 열기 |
| `Sessions.swift` | tmux 세션 조회/detach/kill |
| `ApproveManager.swift` | approve 라우터 실행 래퍼 |
| `Updater.swift` | GitHub Releases 기반 인앱 업데이트(leaf CN 검증) |
| `SettingsWindow.swift` | 설정창(자동 업데이트 토글 등) |

---

## 8. 주요 경로/식별자 요약

| 종류 | 값 |
|---|---|
| tmux 서버 소켓 | `/tmp/aqua-tmux.sock` |
| primitive 요청/응답 | `/tmp/remote-pair.input-req` / `…input-res` |
| approve 트리거 | `/tmp/remote-pair.approve-request` (+`.label`, `.type`) |
| status ground truth | `~/.remote-pair/logs/status.json` |
| heartbeat (watchdog) | `~/.remote-pair/logs/remote-pair.heartbeat` |
| 로그 | `~/.remote-pair/logs/remote-pair.log` (5MB→`.1` 회전) |
| approve 룰 | `~/.remote-pair/rules.txt` |
| bundle id / LaunchAgent | `com.x10lab.remote-pair-host` (+`-watchdog`) |

---

## 9. 온보딩 웹 브리지 (localhost 마법사)

`remote-pair web` 서브커맨드가 기동하는 로컬 온보딩 마법사의 아키텍처. **저결합 원칙 유지** — `.app`은 여기서 어떤 서버도 추가로 갖지 않는다.

```
브라우저(127.0.0.1:<port>?token=<run-token>)
  ↑↓ JSON API (교체 가능한 seam)
client/remote-pair-web   ← 얇은 HTTP 브리지 (python3 stdlib ~150줄)
  ├─ GET  /              → client/web/index.html 정적 서빙
  ├─ GET  /api/status    → status.json 읽기 + ~/.remote-pair/role 머지
  ├─ POST /api/permissions/open {pane}  → open x-apple.systempreferences:... (설정창 열기만, 토글 불가)
  ├─ POST /api/role      → ~/.remote-pair/role 기록
  ├─ POST /api/config    → remote-pair config set host|terminal (shell-out)
  ├─ GET  /api/ssh-check → remote-pair doctor SSH 섹션 (shell-out)
  ├─ *    /api/map       → remote-pair map list|add|rm (shell-out)
  ├─ GET  /api/syncthing → 127.0.0.1:8384 프로빙 (graceful "not detected")
  └─ GET  /api/regrant   → bundle_id 신구 비교 → 재grant 필요 여부
```

**핵심 설계 결정**:
- 브리지는 **기존 `remote-pair` CLI에 shell-out** + `status.json` 읽기만 한다. 설치 로직 재구현 금지.
- `.app`은 새 서버를 전혀 갖지 않는다 — `AppDelegate.poll()`의 기존 1초 `writeStatus()` 루프가 status.json을 갱신하고, 브라우저가 `/api/status`를 1.5초 폴링해 **앱 재시작 없이 ~2초 내** 권한 토글 반영.
- 보안: 127.0.0.1 바인딩 + **per-run 토큰**(런타임 생성, CLI 인자 비전달 — 히스토리 누출 방지). 토큰 없는 요청 거부.
- **JSON API = 교체 가능한 seam**: 나중에 Swift WKWebView 앱이나 code-server 임베드로 브리지 구현만 교체해도 `index.html`과 API 계약은 불변.
- 소스: `client/remote-pair-web`(브리지), `client/web/index.html`(SPA, 빌드·npm 불필요). 헬퍼 경로(`Config.swift` 참조)는 소스 디렉터리 불변이라 그대로.

---

## 10. Web UI 셸 + 확장 API (M2~M5, 구현됨/스캐폴드)

온보딩 마법사(§9)가 끝난 뒤 같은 브리지·SPA가 **터미널·Remote Desktop·에디터·알림** 탭을 가진 상주 셸로 전환된다. 저결합 원칙은 동일하게 유지된다.

### 10-1. SPA 레이아웃

`client/web/index.html`(+`app.js`/`style.css`)은 빌드 툴체인 없는 단일 SPA다.

```
┌───────────────────────────────────────────────────────────┐
│  왼쪽: Terminal 탭            │  오른쪽: Desktop / Editor  │
│  (xterm.js, tmux attach)      │  탭(Remote Desktop·코드뷰) │
└───────────────────────────────────────────────────────────┘
```

브라우저 ↔ 브리지 JSON API(§9)를 재사용하고, 추가 API만 아래와 같이 확장한다:

| 엔드포인트 | 방향 | 설명 |
|---|---|---|
| `GET/POST /api/term/*` | 브리지 ↔ SSH/tmux | 터미널 세션 제어(§10-2) |
| `POST /api/desktop/open` | 브리지 → CLI | macOS Screen Sharing 실행 트리거(§10-4) |
| `GET /api/editor/status` | 브리지 → CLI | code-server 구동 여부 확인 |
| `POST /api/editor/start` | 브리지 → CLI | code-server 시작 트리거 |
| `GET /api/notifications` | 브리지 → 큐 파일 | 알림 큐 폴링(§10-3) |
| `GET/POST /api/notify/settings` | 브리지 → conf 파일 | ENABLED_TYPES 필터 읽기/쓰기 |

---

### 10-2. M3 — 터미널 탭 (구현됨)

**목적**: 브라우저에서 호스트 tmux 세션에 직접 연결하는 터미널 탭.

**동작**:
- SPA가 xterm.js를 로드하고, `/api/term/*` WebSocket(또는 폴링)을 통해 브리지와 통신.
- 브리지는 SSH를 통해 호스트에서 `tmux-aqua -S /tmp/aqua-tmux.sock`의 `capture-pane`(읽기) 및 `send-keys`(쓰기)를 실행.
- 세션 목록 조회·Attach/Detach 탭 UX를 제공.

**제약(alt-screen 한계)**: `capture-pane`은 일반 버퍼만 읽어서, vim·htop처럼 alt-screen을 점유하는 프로그램의 현재 화면은 그대로 캡처되지 않는다. 완전한 pseudo-pty 스트리밍은 v0.5+ WebSocket 업그레이드 후에 해결 예정.

---

### 10-3. M2 — 알림 포워딩 (구현됨)

**목적**: host에서 발생한 Claude Code 알림(완료·Stop·Ask·approve)을 client에 전달.

```
host(gh-mac-m1)
  └─ ~/.claude/settings.json hooks
       └─ remote-pair-notify.sh   ← Stop/Notification 이벤트 수신
            └─ ~/.remote-pair/notifications/queue.jsonl  ← 이벤트 누적
                 ↑ SSH 폴링(client 브리지)
client(gh-mac-m4)
  └─ remote-pair-web  GET /api/notifications
       └─ SPA 알림 배너 표시
```

- 훅 스크립트: `host/hooks/remote-pair-notify.sh`. 이벤트를 `~/.remote-pair/notifications/queue.jsonl`에 JSON 줄 단위로 추가한다.
- 필터: `host/hooks/notify.conf`(`notify.conf.example` 참조)의 `ENABLED_TYPES`로 포워딩할 알림 종류를 선택한다(기본: `notification,stop`).
- 클라이언트 브리지 `/api/notifications`가 SSH를 통해 host의 queue.jsonl을 폴링하고 SPA에 전달한다.
- 저결합 원칙: 앱에 알림 서버를 넣지 않는다. 전송은 CLI 레이어에서 처리한다.

---

### 10-4. M4 — 에디터 (스캐폴드)

**목적**: code-server를 localhost에서 띄워 브라우저 에디터 탭으로 연결.

- `client/remote-pair-editor`: code-server 런처 스크립트. 서브커맨드 `start [<folder>]` / `status` / `stop`. 기본 포트 `EDITOR_PORT=8080`, `127.0.0.1` 바인딩(`--auth none` — loopback 전용이라 안전).
- code-server는 포크 레포(`ghyeongl/code-server`)에서 유지 관리 중이며, 설정 우선·surgical 최소 패치 전략을 따른다(Electron 레이아웃 패치 등 WIP).
- Claude Code 익스텐션은 **Open VSX**를 통해 설치(code-server는 MS 마켓플레이스 미사용).
- 브리지의 `/api/editor/{status,start}`가 `remote-pair-editor`에 shell-out. code-server가 설치되어 있지 않으면 에디터 탭은 안내 메시지만 표시.
- **현재 상태: 스캐폴드** — 런처·브리지 연결·기본 UI 탭은 완성. Electron 레이아웃 패치·Claude Code 익스텐션 통합은 진행 중(스파이크).

---

### 10-5. M5 — Remote Desktop (스캐폴드)

**목적**: 브라우저 탭에서 호스트 화면을 보고 입력하는 Remote Desktop.

- `client/remote-pair-desktop`: macOS Screen Sharing(VNC) 런처. 서브커맨드 `open [<host>]` / `check` / `help`. `open vnc://` URL을 통해 macOS 기본 Screen Sharing 앱을 arm's-length로 트리거한다.
- 브리지의 `POST /api/desktop/open`이 `remote-pair-desktop open`에 shell-out.
- **v0.5 계획**: Screen Recording primitive(`InputServer.shot`)를 재사용해 저지연 캡처 스트리밍 스파이크.
- **v1 계획**: ScreenCaptureKit + VideoToolbox HW 인코딩 기반 WebRTC. Input Monitoring 권한 추가 필요.
- RustDesk(AGPL-3.0) 사용 시 arm's-length 별도 프로세스 필수(requirements.md §라이선스 매트릭스 참조).
- **현재 상태: 스캐폴드** — VNC launcher 트리거까지 구현. 인-브라우저 스트리밍(WebRTC)은 스파이크 단계.

---

## 11. M6 — 2-레벨 hot-update (설계 확정, 스파이크 대기)

앱 업데이트를 세션 중단 없이 수행하기 위한 2단계 모델.

| 레벨 | 대상 | 방식 | 세션 영향 |
|---|---|---|---|
| **L1** | glue(CLI / 웹 브리지 / approve 스킬·훅) | 파일 교체만, 재시작 불필요 | 없음(CodePush-style 핫스왑) |
| **L2** | 네이티브 앱(`RemotePairHost.app`) | 세션 체크 + 사용자 동의 후 재실행 | 짧은 재시작 |

**L1 hot-swap**: `remote-pair-web`, `remote-pair-editor`, `remote-pair-notify.sh` 등 glue 파일은 프로세스 재시작 없이 파일만 교체하면 즉시 반영된다. 번들 파일 교체 후 브리지를 재기동하는 것으로 충분.

**L2 네이티브 재실행 절차**:
1. 활성 `claude` 세션 수 확인 — 세션이 붙어 있으면 사용자에게 동의를 요청.
2. 동의 시 `launchctl kickstart -k`로 앱 재기동.
3. `HostManager.spawn()`이 재기동 후 tmux 서버를 재연결.

**⚠️ 열린 스파이크**: 앱 재시작 시 `tmux-aqua` 부모가 launchd로 reparent되어 AX 권한 상속이 깨지는지 먼저 검증해야 한다. `tmux-aqua`가 reparent를 막는 전제가 앱 교체 과정에서 유지되는지 확인 전에 L2 구현을 진행하지 않는다.
