# RemotePair Desktop IDE — 설계문서

Cursor 같은 데스크톱 IDE. 핵심 동인은 **Claude Code + OpenAI Codex VS Code 익스텐션 호환**이며, 이 제약이 전체 아키텍처를 강제한다.

> 익스텐션 호환 ⟹ 진짜 VS Code 아키텍처(extension host + 웹 워크벤치) ⟹ **Electron 필수**(Tauri/네이티브 WebView는 워크벤치를 못 띄움 — Cursor·Windsurf·VSCodium 전부 Electron) ⟹ **데스크톱 VS Code OSS = VSCodium 포크**(브라우저 code-server 웹-attach 아님).

그 앱 **안에** "원격접속 = 화면공유" 탭(호스트 macOS 화면)을 띄운다. 이전의 커스텀 vanilla-JS SPA 셸은 폐기. **M1~M6 백엔드는 그대로 재사용** — IDE는 "얼굴"이고 두뇌는 `remote-pair` CLI + python 브리지, 권한은 host `RemotePairHost.app` 데몬, approve는 CLI 경로.

## 확인된 사실
- Claude Code = Open VSX `Anthropic/claude-code` 2.1.177 ✓
- OpenAI(Codex 포함) = Open VSX `openai/chatgpt` 26.5609.30741 ✓
- open Remote-SSH = Open VSX `jeanp413/open-remote-ssh` 0.1.2 ✓
- noVNC MPL-2.0 · websockify LGPL/BSD (번들 OK) · RustDesk=AGPL(**임베드 금지**, 퍼미시브 Rust 크레이트만)
- RemotePair=Apache-2.0 · 빌드엔 **node 22.22.1 nvm 핀 필수**(시스템 node 25 아님)

## 불변식
- host `.app` = 권한 데몬만(서버 안 넣음). CLI/브리지 = 두뇌. approve = CLI→라우터(앱 자식). IDE는 필요 시 CLI에 shell-out.
- IDE는 **별도 앱·별도 bundle id `com.x10lab.remotepair-ide`** (host 데몬 `com.x10lab.remote-pair-host`와 무관). 번들 id 통일은 v0.5.0 defer 유지.

## 잠긴 결정
- **베이스**: VSCodium 포크 → 별도 레포 `ghyeongl/remotepair-ide`(remote-pair에 vendoring 안 함, upstream remote).
- **툴체인**: nvm node 22.22.1 + brew(python3.11, rustup, jq, imagemagick, png2icns, librsvg). arm64-only.
- **브랜딩**: VSCodium env(`APP_NAME=RemotePair`, `BINARY_NAME=remotepair`, `ORG_NAME=x10lab`, `darwinBundleIdentifier=com.x10lab.remotepair-ide`, `GH_REPO_PATH=ghyeongl/remotepair-ide`). product.json overlay → `extensionsGallery`=Open VSX + `linkProtectionTrustedDomains`.
- **번들 익스텐션(built-in)**: claude-code, openai/chatgpt, Remote Desktop noVNC 웹뷰. (brittle 시 first-run 설치 폴백.)
- **파일/터미널**: `open-remote-ssh` primary(호스트 fs 직접 + 터미널=호스트 tmux-aqua=claude 세션). Syncthing/Mount는 폴백.
- **Remote Desktop 탭**: Electron BrowserView(워크벤치 webview는 CSP가 localhost iframe 차단). v0=noVNC+websockify(SSH -L)로 macOS 화면공유(vnc://host:5900). v1=Rust 사이드카.
- **RemotePair 내장 익스텐션**: 브리지 spawn + Remote Desktop 탭 + 알림 + 커맨드 + walkthrough.
- **온보딩 필수 단계**: 권한(AX/SR) 안내 + 역할 + SSH/호스트 + **파일 접근 설정** — 백엔드 선택(open-remote-ssh / Syncthing / Mount) **및 mount 타깃 또는 매핑(mapped) 폴더를 온보딩에서 반드시 구성**한다. (기존 M1 마법사의 folder-mapping + sync-backend(syncthing/mount) 스텝을 IDE 온보딩/walkthrough로 흡수 — 재구현 X.)
- 커스텀 SPA 셸 폐기. 마법사는 슬림 유지/walkthrough 흡수(단 위 파일접근/매핑 스텝은 유지).

### Rust 화면공유 (v1, license-clean)
- **사이드카**(napi 애드온 아님): 신규 Rust 워크스페이스 `remote-pair-screen`(별도 디렉터리, out-of-band). 저결합 + Electron Node ABI 핀 회피 + 크래시 격리 + AGPL 프로세스-경계 방화벽.
- capture `screencapturekit`(MIT) → encode `videotoolbox`(H.264 기본) → `webrtc-rs`(MIT/Apache; SDP/ICE는 토큰 브리지 `/api/screen/*`+SSH) → 클라 `<video>` 네이티브 디코드.
- 입력 역채널 = **기존 InputServer 재사용**(click/key, 좌표 스케일만 추가; CGEventTap 안 씀).
- 사이드카 자체 Screen Recording TCC grant + 안정 cert 서명. **cargo-deny CI**로 AGPL 무혼입 증명.

## 단계별 빌드
0. nvm node22 + brew prereq, VSCodium 포크, **vanilla 빌드 green**(최대 리스크 게이트) — 1~3일
1. 브랜딩(env) + Open VSX 갤러리 — 1~2일
2. 익스텐션 3종 built-in 번들 — 2~4일
3. RemotePair 내장 익스텐션(Remote Desktop BrowserView·알림·커맨드·walkthrough) + open-remote-ssh(호스트 워크스페이스·tmux-aqua 터미널) — 1주
4. Remote Desktop v0(noVNC+websockify) + `/api/screen/*` 브리지(remote-pair-desktop 재사용) — 3~5일
5. 레이아웃(settings 우선) + defaults + **SPA 셸 폐기** — 1~3일
6. 패키징/서명(ad-hoc→Developer-ID/notarize) + dmg + cask — 2~4일
7. (후속) Rust v1 사이드카 — 3~5주

> 레이아웃은 settings/saved-workspace/auxiliary-bar 우선, 안 되는 것만 최소 `layout.ts` 패치.

## 재사용 맵 (M1~M6 → IDE)
브리지(+신규 `/api/screen/*`) · CLI(editor/desktop/mount/notify/update) · host 데몬(tmux-aqua 권한상속) · InputServer(v1 입력) · approve(무변경) · 알림 포워딩 · Syncthing/Mount(폴백) · 안정 cert/TCC 모델(사이드카 SR grant) · Tailscale/WireGuard(WebRTC 도달성). **폐기**: 커스텀 SPA 셸.

## 확인 필요(비차단)
- Apple Developer ID 지금 vs 나중 · 파일 백엔드 기본값(open-remote-ssh vs Mount) · Remote Desktop 웹뷰(google/vscode-vnc vs 자체 noVNC).

## Verification
Phase0 vanilla .app 실행 → 단계별 런치 스모크 + **Playwright 시각검증** + 클린 프로필 익스텐션 확인 → Claude/Codex Open VSX 구동 → 화면공유 탭 렌더 → 터미널 tmux-aqua attach → `cargo-deny` green · bundle id 분리 확인 → 기존 run.sh 159/4 유지.

## Risks / 스코프
첫 vanilla 빌드(600MB~1GB, 20~60분)가 최대 리스크 → 브랜딩 전 green 먼저. node 핀(25 vs 22). 리베이스 부담=소스패치 수. noVNC×화면공유 글리치(v0 모니터링용, v1이 인터랙티브). 전체 = **Cursor 규모**: v0 ~1.5~3주, v1 Rust +3~5주.

## 구현 상태 (2026-06-14)
포크 레포 `ghyeongl/remotepair-ide` (VSCodium fork, vscode 1.121), 빌드 노드 22.22.1(nvm).
- **Phase 0 ✅** vanilla 빌드+실행 검증.
- **Phase 1 ✅** RemotePair 브랜딩(dev/build.sh env + 루트 product.json: nameLong=RemotePair, darwinBundleIdentifier=com.x10lab.remotepair-ide). Open VSX 갤러리는 VSCodium 기본. 실행 캡쳐 확인.
- **Phase 2 ✅** Claude Code(anthropic.claude-code 2.1.177) + Codex(openai.chatgpt 26.609.30741) + open-remote-ssh(jeanp413 0.1.2) Open VSX에서 .app에 설치(`bin/remotepair --install-extension`, 리빌드 없이). IDE 실행 시 CLAUDE CODE·CODEX 탭 로드+동작 캡쳐 확인.
- **Phase 3 ✅** RemotePair 내장 익스텐션 `remotepair-ide/remotepair-ext/` (.vsix 18.97KB): Remote Desktop 웹뷰(v0 = 기존 InputServer `shot` 스크린샷 폴링 ~1.2s, 좌표 스케일 png dims=1344x1008), 시작 시 자동 reveal, first-run AI 익스텐션 보장, open-remote-ssh connect(`openremotessh.openEmptyWindow`), 호스트 알림 폴러, walkthrough 3. 호스트 검증(인젝션 거부).
- **Phase 6 ✅** `RemotePair-0.1.0-arm64.dmg` (291MB) 패키징+마운트 검증(ad-hoc, 내부배포).
- **Phase 7 (스캐폴드)** Rust 사이드카 `native/remote-pair-screen` (scap/screencapturekit 캡쳐 + cargo-deny AGPL 방화벽). v1 webrtc 트랜스포트는 multi-week 남음.
- **한계/사용자 단계**: Remote Desktop 호스트화면 in-IDE 렌더는 클라 ssh의 **1Password "Approve for all applications" 1회**(TCC grant류 수동 — 자동승인 안 함) 후 동작. 입력 v0 coarse(클릭+키). 레이아웃 좌터미널/우데스크톱 정밀배치는 폴리시. CLI 터널은 옵션(cargo 심 수정됨).
- **검증 방식**: Electron 앱이라 Playwright 대신 `screencapture`+Read로 시각검증(computer-use request_access는 갓빌드앱 미인식). 호스트는 ssh gh-mac-m1 + InputServer.
