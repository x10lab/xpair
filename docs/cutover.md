# RemotePair → RemotePairHost 리팩터 & 컷오버 — 종합 핸드오프

> 이 문서는 **처음 보는 에이전트/사람이 m4(클라이언트)에서 이 작업을 이어받아 호스트(m1) 컷오버를
> 실행·검증**할 수 있도록 현재까지의 전체 컨텍스트·결정·절차를 담았다. (브랜치 `refactor/host-client-split`)

---

## 0. 지금 어디까지 왔나
- 단일 `RemotePair.app` → **2제품(RemotePairHost.app + remote-pair CLI)** 분리 리팩터 + approve 서브시스템
  개선 + 스킬 2종, **코드·로컬검증 완료**. 브랜치 `refactor/host-client-split` 에 7커밋(아래 §9), **main 미머지**.
- **남은 것 = 호스트(m1) 컷오버 1번** (구 앱 → 새 앱 교체 + 권한 재부여 + 실 GUI 검증). 이게 위험하고
  사람/GUI 손이 필요해서 보류 중. 절차는 §7~§8.
- 작업 주체: **m4 에서 `ssh gh-mac-m1` 로 m1 조작.** m4 는 m1 물리 GUI 접근 불가 → GUI 는 RemotePair
  하위 claude 의 computer-use 로 한다(§6).

---

## 1. 이 프로젝트가 뭐고 왜 어려운가 (배경)
원격(mosh/ssh)으로 붙는 persistent tmux 세션 안의 **Claude Code 가 macOS 빌트인 computer-use
(스크린샷·클릭·타이핑)를 쓸 수 있게** 하는 시스템. 헤드리스 24h Mac(**host=gh-mac-m1**)에 노트북
(**client=gh-mac-m4**)에서 붙어 claude 를 돌리되, 그 claude 가 host 화면을 보고 조작한다.

**macOS TCC 2-게이트** 때문에 어렵다:
- **SR(화면기록)** = 스크린샷. responsible-process 체인으로 평가(daemon 거쳐도 상속).
- **AX(손쉬운사용)** = 합성입력(클릭/타이핑). host **.app 의 activation policy + Aqua graphic-session** 으로 평가.
- `claude` CLI 는 비-.app+버전경로라 권한 목록에 등록조차 안 됨 → **권한 가진 .app(RemotePairHost)이 host 가
  되어** claude 를 자기 서브트리에 두고 권한 상속시켜야 함.
- 기본 tmux 는 `daemon(3)` 으로 서버를 launchd 로 reparent → claude 가 host 서브트리에서 이탈 → AX 실패.
  그래서 **patched tmux(`tmux-aqua`: daemon→setsid, no reparent)** 로 서버를 host 앱 서브트리에 남긴다.
- SIP+non-MDM 이라 `tccutil`/PPPC 로 권한 부여 불가 → **System Settings 사용자 토글만** 가능(컷오버 난관 §8).

**해법 구조**:
```
login → LaunchAgent(KeepAlive) → RemotePairHost.app (메뉴바, AX+SR granted)
  └ posix_spawn → /usr/bin/script(pty) → tmux-aqua 서버(/tmp/aqua-tmux.sock, _keeper)  ← 앱 서브트리
       └ client 가 추가한 claude 세션 → computer-use ✅
[client] remote-pair launch <dir> → 경로매핑 → ssh setup(세션 생성/공유) → mosh attach
```

---

## 2. 이번 리팩터가 바꾼 것 (전부)
1. **앱 분리/확장**: `RemotePairNative/main.swift`(단일 150줄) → `RemotePairHost/*.swift` 8파일
   (Config / HostManager(tmux child) / ApproveManager(router child) / Sessions(조회·detach·kill) /
   Permissions(AX·SR 상태+설정창) / SettingsWindow / Updater(GitHub Releases) / AppDelegate / main).
   메뉴바: 동적 세션목록 → 세션 클릭 시 **Detach all / Kill 모달**, Grant Permissions, Settings, Check
   for Updates, About, Quit. accessory(LSUIElement) 유지.
2. **네임스페이스 `~/.remote-pair`**: 모든 런타임 상태(config·logs·rules·bin·manifest) 이전.
   `~/.claude` 에는 **스킬만** 설치 → **`~/.claude` 동기화에 의존 안 함**(없어도 동작). git-sync 는 선택적 개인 편의.
3. **클라이언트**: `remote-pair` CLI(`launch/ls/map/doctor/approve/status/host`) +
   런처 `remote-pair-launch`. **경로 매핑**(client↔host 절대경로 다름 대응; 외부 sync=Google Drive/Syncthing),
   **세션 공유**(host경로 기준 결정론적 세션명 → 여러 client 가 같은 세션 multi-attach), **비인터랙티브**(`RP_YES`/`--yes`).
4. **approve 개선** (§5).
5. **스킬**: `approve`(막힌 승인창 통과 요청), `host-gui-access`(RemotePair 하위면 GUI+computer-use 가능 판별).
6. **정리**: `CLAUDE.command`(gh-mac-m4 하드락) 삭제, Service "Launch Remote Pair", `build-native.sh`→`build-host.sh`,
   레거시 approve glue(잘못된 포맷 rules.txt·dead engine.applescript) 제거.

---

## 3. 환경 사실 (꼭 알아야 할 것)
- **이 작업이 도는 세션 자체가 구 RemotePair.app 의 tmux 자식**이다:
  `claude → bash → tmux-aqua(/tmp/aqua-tmux.sock) → /usr/bin/script → RemotePair.app(구)`.
  판별: `case "$TMUX" in *aqua-tmux.sock*) ...` → RemotePair-hosted (스킬 host-gui-access).
- m1/m4 둘 다 **Xcode 없이 CLT(Swift 5.10)** + 최신 SDK → 기본 swiftc 깨짐. `build-host.sh` 가
  MacOSX14.5 SDK 로 **자동 폴백**(해결됨).
- 구 앱: `~/Applications/RemotePair.app`, bundle `com.ghyeong.remote-pair`, LaunchAgent 동명(+watchdog).
- 새 앱: `build/RemotePairHost.app`, bundle **`com.x10lab.remote-pair-host`**, v4.0.0. (현재 ad-hoc 서명 — cert 부재.)

### cert 사연 (중요)
- 구 앱은 self-signed **"RemotePair Local Signing"** 으로 서명돼 있으나 **private key/identity 가
  m1·m4 어디에도 없음**(`security find-identity -v -p codesigning` = 0, p12 백업 없음).
- self-signed 라 **복구 대신 재생성**: `scripts/make-signing-cert.sh`(idempotent, Apple 계정 불필요).
- bundle id 가 바뀌어 **재grant 1회는 불가피**. 단 재생성 cert 로 서명하면 그 이후 재빌드/업데이트엔
  grant 유지(앱 Updater 가 leaf CN 검증; 불일치 시 경고).

---

## 4. 검증 상태 (무엇이 확인됐고 무엇이 안 됐나)
- ✅ 로컬: `build-host.sh` 빌드+`codesign --verify --strict`, 전 셸 스크립트 `bash -n`,
  샌드박스 client install→doctor→**uninstall 가역성**, 경로매핑 단위테스트, approve 라우터 graceful
  degradation·exit 코드·힌트 해석, haiku 호출 교정(`vision → NONE` rc=0), host-gui-access 판별.
- ⛔ 미검증(컷오버+실GUI 필요): 메뉴바 GUI 동작(세션목록·모달·설정창·About·업데이트), 실제 권한창 클릭/
  haiku 분류 정확도, 세션 공유 실 attach, computer-use 회귀, GitHub Releases 업데이트.

---

## 5. approve 서브시스템 (현재 설계)
파일: `scripts/remote-pair-approve-router.sh`(앱 번들 `Contents/Helpers/` 에 임베드), CLI `remote-pair approve`, 스킬 `skills/approve`.
- **적응형 폴링**(`RP_WAIT_SECS` 기본 ~18s): 트리거 후 창이 늦게 떠도 잡음.
- **검증 루프**: 클릭/키 후 재캡처로 "마커 사라졌나" 확인·재시도 → `exit 0`(성공)/`1`(실패).
- **하이브리드 탐지**: OCR 룰(마커) 우선 → 미스 시 **haiku 가 "어떤 알려진 창인가"만 분류**(좌표는 못 줌 —
  좌표는 항상 OCR `ocr-find`). UNKNOWN 이면 일반 승인 라벨 폴백.
  - haiku = 구독 claude CLI: `claude -p "$prompt" --model claude-haiku-4-5 --allowed-tools Read`
    (프롬프트 positional **먼저** — `--allowed-tools` 가 variadic 이라 뒤에 두면 prompt 를 삼킴: 과거 버그).
    best-effort+타임아웃(12s)+사이클게이트, 연속 실패 시 그 실행 동안 비전 자동 비활성. 없으면 OCR 룰만.
- **`--for "<무엇>"` 힌트**: 에이전트가 어떤 승인인지 알려주면 해당 룰 우선 + haiku prior.
  (구 `--label` 은 라우터가 안 읽던 死 인자였음 → 실제 연결.)
- **실패는 스스로 복구 말고 로그로**: `remote-pair approve` 가 이번 요청의 라우터 로그를 성공/실패 모두
  출력 → 호출 에이전트가 읽고 **재트리거 / 룰추가 / 사용자보고** 중 선택. (SKILL.md 에 분기 가이드.)
- 룰: `~/.remote-pair/rules.txt` (`id<TAB>marker<TAB>action`; action=`ocr:라벨|..` 또는 `key:콤보`).

---

## 6. 헤드리스 m1 에서 GUI 작업하는 법
m4 는 m1 물리 GUI 불가. GUI 는 **RemotePair 하위 tmux 의 claude computer-use**(SR+AX 상속)로.
- ⛔ `ssh gh-mac-m1 claude -p "..."` 단독 = computer-use 불가(sshd 자식 = RemotePair 밖 → AX 상속 못 함).
- ✅ RemotePair 하위로 띄운다:
  ```bash
  ssh gh-mac-m1 'tmux-aqua -S /tmp/aqua-tmux.sock new-session -d -s gui "claude -p \"<GUI 작업>\""'
  ```
- 보기/조작: computer-use 스크린샷(또는 `screencapture -x f.png` 후 Read) + 필요시 `cliclick`.
  승인창은 직접 클릭 말고 `remote-pair approve --for "..."`.

---

## 7. 컷오버 절차 (m4 에서)
> §8 함정 먼저 읽을 것. install 은 **plain ssh(RemotePair 밖)** 에서, **끊겨도 되는 시점에** 실행.

```bash
# 1) cert 재생성 + 빌드 (세션 안 죽음)
ssh gh-mac-m1 '
  cd ~/Spaces/Work/Devs/Lang-Swift/remote-pair &&
  git checkout refactor/host-client-split &&
  ./scripts/make-signing-cert.sh &&     # 안정 cert (idempotent)
  ./scripts/build-tmux-aqua.sh &&       # tmux-aqua (이미 있으면 빠름)
  ./scripts/build-host.sh               # → build/RemotePairHost.app, 끝에 verify OK ✓
'

# 2) 새 앱 재grant (§8 — 새 앱이 서명된 뒤, 컷오버 전에)

# 3) 컷오버 — 구 앱 + m1 의 모든 RemotePair 세션 종료됨
ssh gh-mac-m1 'cd ~/Spaces/Work/Devs/Lang-Swift/remote-pair && ./install/install.sh --role host'

# 4) 기동 확인
ssh gh-mac-m1 'launchctl list | grep remote-pair-host; ~/.local/bin/tmux-aqua -S /tmp/aqua-tmux.sock ls'
```

---

## 8. 두 가지 함정 (컷오버 핵심)
1. **세션 자살**: 위 §3 대로 이 작업이 구 RemotePair 의 tmux 자식이라, `install.sh --role host`(또는
   `pkill RemotePair*`, 같은 소켓 새 인스턴스의 `reapStrays`)는 **현재 세션 + m1 의 모든 RemotePair
   tmux 세션을 종료**한다. → plain ssh 에서, 끊겨도 되는 시점에.
2. **부트스트랩 역설(재grant)**: 컷오버하면 새 bundle id 라 grant=0. 헤드리스 m1 엔 그 새 앱을
   grant 해 줄 GUI 주체가 없다(컷오버 후 모든 claude 는 미granted 새 앱 하위 → computer-use 불가).
   → **컷오버 *전에* 둘 중 하나 확보**:
   - **(A)** 지금 살아있는(구 앱 grant 보유) 세션의 computer-use 로 System Settings → 개인정보 보호
     → 손쉬운 사용 / 화면 기록 에 `~/Applications/RemotePairHost.app` 를 `+` 로 추가·ON.
     (grant 는 bundle id + cert leaf 에 묶이므로, 재생성 cert 로 서명한 새 앱을 미리 grant 하면 컷오버 후 유지.)
   - **(B)** VNC/화면공유로 사람이 토글.
   둘 다 불가하면 컷오버 후 computer-use 가 영구히 막힌다.

---

## 9. 브랜치 커밋
```
65e5da2 docs: 컷오버 런북
8480b0e docs(skill): host-gui-access — RemotePair 하위 판별 + GUI/computer-use
fdb117d feat(approve): --for 힌트로 어떤 승인인지 전달
9e0f54d fix(approve): claude -p 호출 교정 + 실패 로그 노출
07af4b4 feat(approve): 적응형 폴링 + 검증 + haiku 분류 폴백
0afe548 feat: ~/.remote-pair 네임스페이스 + 경로매핑·세션공유·doctor + .claude 디커플
36a46a2 feat: RemotePairHost 앱 분리·확장 + build-host.sh
```

## 10. 검증 체크리스트 (재grant 후)
`remote-pair status && remote-pair doctor` → 메뉴바 ⌗⌘(세션목록·Detach/Kill 모달·권한✓✓·Settings·About·Check
for Updates) → 같은 폴더 두 번 `launch`(세션공유, attached 2) → `approve --for "1Password"` → computer-use 스크린샷/클릭.

## 11. 롤백
`ssh gh-mac-m1 '~/.local/share/remote-pair/install/uninstall.sh'` (manifest 역순; `--purge` 로 `~/.remote-pair`
까지). `~/.claude` 사용자데이터 보존. 구 앱 복귀는 `main` 브랜치 구 빌드 재생성 필요(구 cert key 없어 재grant).

## 12. 참고
- SSOT: `install/config.sh`. 가역 엔진: `install/lib.sh`(manifest).
- 원래 플랜: `~/.claude/plans/bubbly-purring-bubble.md` (m4 에선 `/plans/` 는 sync 되지만 `/projects/`
  (메모)는 gitignore 라 안 됨 → 컨텍스트는 이 문서가 단일 출처).
