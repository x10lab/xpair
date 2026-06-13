# Future — 추후 피쳐 / 미뤄둔 작업

이번 세션(2026-06-12~13)에서 논의됐지만 뒤로 미룬 항목들. 우선순위 대략순.

## 1. `remote-pair config` — role 전환 + interactive
- 현재 role(host/client/both)은 설치 시 `install.sh --role` 로만 정해지고, 사후 변경 수단이 없다.
- `remote-pair config` 서브커맨드로:
  - role 을 host ↔ client ↔ both 로 전환(재설치/원복을 manifest 기반으로 안전하게).
  - `REMOTE_HOST`, 폴더 매핑 등 주요 설정을 **interactive 메뉴**로 편집(현재는 env 파일 직접 수정).
- 비대화(`--role host` 등)와 대화 모드 둘 다 제공.

## 2. install.sh 에 Releases zip 다운로드 폴백 (brew 의존 제거)
- 지금 `install.sh --role host` 는 로컬에 빌드된 `build/RemotePairHost.app` 이 있어야만 앱을 깐다(없으면 스킵).
  그래서 빌드 툴체인 없는 호스트는 **brew cask** 로만 앱을 받을 수 있다 → "왜 brew 를 따로 치지?" 어색함.
- install.sh 에 "로컬 빌드 없으면 GitHub Releases 의 서명 zip 다운로드 → quarantine 제거 → 설치" 폴백 추가.
- 효과: 툴체인 없는 호스트도 `install.sh --role host` 한 번으로 앱+approve 원샷, brew 는 순수 선택지로.
  같은 서명 zip 이라 TCC grant 유지.

## 3. glue(skill/hook) 자동 업데이트 트리거
- 현재: cask 가 .app 만 자동 업데이트. approve 스킬·훅(=glue)은 `bootstrap`/`install.sh --role host`
  **재실행** 해야 갱신된다(재실행 시 manifest revert→재설치라 갱신은 정확히 됨).
- 앱이 cask 로 자동 업데이트될 때 glue 도 따라오게 하려면 별도 설계 필요:
  - (a) 앱 self-install(Installer.swift)이 버전업 시 glue 까지 refresh — 단 cask-only 호스트엔 repo 가 없어
    스킬/훅 소스가 없다는 문제(번들에 동봉해야 함).
  - (b) cask postflight 에서 bootstrap 호출.
- 결정 필요: glue 소스를 .app 번들에 넣을지(결합도↑) vs repo 재실행 모델 유지(수동 트리거).

## 4. approve 훅 노이즈 튜닝 (필요 시)
- 현재 matcher = `mcp__claude-in-chrome__.*|mcp__computer-use__.*|Bash`, 게이트 = `denied|permission|timed out|timeout`.
- `--dangerously-skip-permissions` 호스트는 승인 막힘이 대부분 hang→timeout 이라 timeout 을 주 신호로 넣음.
- 부작용: approval 과 무관한 Bash timeout(느린 빌드·행 걸린 테스트)에도 리마인더가 뜰 수 있음.
- 너무 시끄러우면: matcher 에서 Bash 제외(chrome/computer-use 만) 하거나, 게이트에 ssh/git/scp 등
  '인증 동반 명령' 조건을 AND 로 추가.

## 5. cask UX — 설치 후 첫 실행 안내/자동화
- cask 는 .app 만 배치하고 **앱을 자동 실행하지 않음** → 사용자가 한 번 열어야 self-install(LaunchAgent·
  tmux-aqua 링크)이 돈다. 현재 caveats 엔 권한 grant 안내만 있고 "한 번 여세요" 가 빠져 있음.
- caveats 에 "설치 후 앱을 한 번 여세요" 추가, 또는 postflight 에서 `open -a` 로 첫 실행 트리거.

## 6. 서명 cert 전환(33849F → 898E32) 마무리 + 번들 id 통일 — **v0.5.0 계획/예정**

- cert 전환(33849F → 898E32)과 **번들 id 통일(`com.x10lab.remote-pair-host` → `com.x10lab.remote-pair`) + 앱 리네임(`RemotePairHost` → `RemotePair`)** 을 한 릴리스(v0.5.0)에 묶어 처리 **예정**. (M1 작업 트리에 준비됨 — `shared/config.sh` "0.5 RELEASE FLIP" 주석 + 본 문서 올인원 레시피가 한-스텝 플립 가이드. 현재 출하 정체성은 -host 접미사를 유지.)
- 기존 호스트는 이 버전으로 업그레이드할 때 **AX/SR 재grant 1회**만 필요(cert + bundle id 변경이 동시 — 이후 grant 유지). README와 cask caveats에 명시 예정.
- cask 토큰도 `remote-pair-host` → `remote-pair`로 전환 예정. 사용자 액션(0.5 출하 시): `brew uninstall --cask remote-pair-host && brew install --cask remote-pair`.

## 7-1. 올인원 "지휘자" — Syncthing(e2e) + Tailscale/WireGuard + RustDesk (나중)
RemotePair를 베스트 OSS들을 *오케스트레이션*하는 단일 셋업으로. 기존 저결합 철학(앱=권한데몬, CLI=두뇌, sync는 Syncthing에 위임) 그대로 — RemotePair는 컴포넌트를 **설치·구성·실행**만 시키고 소스는 안 건드린다.

- **Syncthing e2e 매핑**: 현재는 사용자가 Syncthing 폴더를 수동 구성. → RemotePair가 **양쪽(host/client) Syncthing REST API로 폴더를 자동 추가 + `.stignore`(.git, .claude/projects 제외) 주입**해서 폴더 매핑을 e2e로 셋업. 선택적으로 `~/.claude` 동기화도 같은 메커니즘으로(현재 git 백본 opt-in 대체/보완). `.git`·기기-로컬 상태 제외 규칙은 유지([[syncthing-git-exclude]] 원칙).
- **Tailscale/WireGuard 연결**: host↔client zero-config 도달성(수동 SSH/포트포워딩 제거). 온보딩 마법사가 Tailscale 설치/로그인 + 노드 확인까지 안내. (BSD-3/MIT — 자유 번들)
- **RustDesk(또는 VNC/WebRTC) Remote Desktop**: M5와 연결.

**라이선스 매트릭스(중요)**: Syncthing=MPL-2.0(consume/번들 OK, 코드 의무전파 X), Tailscale=BSD-3·WireGuard=MIT(퍼미시브), **RustDesk=AGPL-3.0(강카피레프트+네트워크조항)**. RemotePair는 Apache-2.0이고 Apache→AGPL은 단방향 호환이라, **RustDesk를 한 작업물로 묶으면 RemotePair 전체가 AGPL로 전염**된다. → RustDesk는 반드시 **arm's-length 별도 프로세스**(사용자 설치/런타임 다운로드, 자기 배포물에 링크·포함 X)로 두어 mere-aggregation 유지, 또는 macOS 화면공유/ScreenCaptureKit-WebRTC(Apple, 라이선스 0)로 대체. 상용 배포 전 법률 확인 권장.

## 8. M6 — 2-레벨 hot-update + AX 상속 스파이크 (⚠️ 스파이크 선행 필수)

M6 구현 전에 반드시 먼저 검증해야 할 열린 항목.

### 8-1. AX 권한 상속 스파이크

앱을 `launchctl kickstart -k`로 재기동하면 `tmux-aqua` 프로세스의 부모가 launchd로 reparent되어 AX 상속 체인이 끊길 수 있다. `tmux-aqua`의 패치(`daemon→setsid`만 하고 reparent하지 않음)가 앱 교체 과정에서도 유지되는지 먼저 스파이크로 확인해야 한다. 확인 전 L2(네이티브 재실행) 구현은 진행하지 않는다.

**스파이크 체크리스트**:
1. 앱 재기동 전후 `tmux-aqua`의 PPID 기록 비교.
2. 재기동 후 `claude` 세션에서 `screencapture`·`cliclick`이 동작하는지(AX/SR 상속 확인).
3. 상속이 깨지면: `HostManager.spawn()` 재호출로 tmux 서버를 앱 자식으로 재spawn하는 방안 검토.

### 8-2. 2-레벨 update 설계 (architecture.md §11 참조)

- **L1 glue 핫스왑**: `remote-pair-web`, `remote-pair-editor`, `remote-pair-notify.sh`, approve 스킬·훅 등 파일 교체만으로 즉시 반영. 재시작 불필요(CodePush-style).
- **L2 네이티브 재실행**: 세션 수 확인 + 사용자 동의 → `launchctl kickstart -k`. AX 상속 스파이크(§8-1) 통과 후 구현.

## 9. M4 code-server 포크 유지보수 (`ghyeongl/code-server`)

- 포크 레포: `ghyeongl/code-server`. 업스트림 `cdr/code-server` 추종 비용 최소화를 위해 **설정 우선·surgical 최소 패치** 전략.
- **Electron 레이아웃 패치**: 워크벤치 레이아웃을 RemotePair 셸 UX(왼쪽 터미널 / 오른쪽 에디터 탭)에 맞게 조정하는 패치. 현재 WIP(스파이크).
- **Claude Code 익스텐션 통합**: Open VSX를 통해 설치. MS 마켓플레이스 경로는 사용하지 않음.
- 유지보수 전략: 패치가 upstream PR로 흡수되는 항목은 포크에서 revert → 업스트림 추종으로 전환. 패치 표면을 지속 축소.

## 10. doctor 확장 여지
- 이번에 host approve 스킬·훅 존재 + AX/SR grant 를 healthy 판정에 포함시킴.
- 추가 여지: cliclick/ocr-find 등 나머지 헬퍼 존재, 훅이 settings.json 에서 실제 등록됐는지(`claude /hooks`
  수준), tmux-aqua self-contained 여부(otool) 점검.

---
완료된 관련 작업(참고): 세션 0 근본수정(tmux-aqua 번들 누락 HARD-FAIL + 좀비 감지),
0.4.11/0.4.12 재배포, approve 훅 레포화(install/update/uninstall/doctor 일원화, chrome+computer-use+Bash 커버).
