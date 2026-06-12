# RemotePair 요구사항

이 문서는 RemotePair 저장소에서 진행된 **모든 Claude Code 세션**(로컬 laptop 5개 + 호스트 gh-mac-m1 4개, 그중 2개는 자동화 실행이라 내용 없음)을 역추적해, 사용자가 실제로 요청·결정한 내용을 종합한 요구사항 모음이다. 출처는 세션의 사람 발화이며, 추측은 배제했다.

> 코드 동작 원리는 [architecture.md](architecture.md), 사용자용 설치/사용은 [README](../README.md).

---

## 1. 기능 요구사항

### 배포 / 설치
- 오픈소스 self-signed 서명 문제를 **Homebrew Cask 배포**로 해결한다 — postflight로 quarantine를 제거해 self-signed라도 TCC grant가 동작.
- Apple Silicon 전용 **프리빌트 바이너리**를 제공해 사용자 직접 빌드를 없앤다. `tmux-aqua`는 앱 번들에 임베드(별도 바이너리·brew 의존 제거).
- **단일 명령 부트스트랩**(`curl … | bash`)으로 처음 쓰는 사람도 빌드 없이 설치.
- bootstrap은 glue(CLI·approve 규칙·skill)만 설치하고, host면 **brew cask로 앱까지 자동 설치**한다. brew가 없으면 안내 후 중단.
- **소스 빌드는 bootstrap에서 제거** → 메인테이너 전용(`host/build-*.sh`). (brew가 앱을 공급하므로)
- installer **role 분리**(host/client/both) + Finder Service Quick Action으로 client 1분 설치.
- 설치/제거 모두 **가역적**(manifest 추적).
- **CI(GitHub Actions)로 릴리스**: 각 브랜치에서 새 태그 푸시 → 빌드 → 성공 시 main 머지. 신규 코드만 릴리스. CI가 직접 수행(셀프호스티드 아님), p12는 gh secret(`SIGNING_P12_BASE64`/`_PASSWORD`).
- 릴리스 ad-hoc 서명 거부 가드 + cask `version`/`sha256` 자동 bump.
- 버전은 0.5가 아닌 **0.4.x 유지**(pre-1.0).

### 권한 / TCC
- **AX·SR 필수, FDA 권장**(헤드리스 폴더 프롬프트가 세션을 멈추는 것 방지). FDA 권한을 실제로 쓰는 건 RemotePair 로직이 아니라 그 안의 `claude` 세션.
- TCC grant는 **안정 self-signed cert의 designated requirement**에 묶여 재빌드·업데이트에도 유지된다.
- 릴리스 바이너리가 **동일 cert**로 서명돼야 머신 간/업데이트 간 grant가 안 깨진다(= cask 배포의 핵심 근거). cert 백업: `~/Library/Application Support/RemotePair/signing.p12`.
- 권한 부여는 호스트 화면에서 1회 수동(SSH 불가) → 토글 후 `launchctl kickstart`.
- 마이크/미디어 등 불필요 권한 요청 최소화(자식 세션 탓이지 앱 탓 아님).

### Computer Use / 권한 상속
- `claude`가 **권한 가진 앱 서브트리(patched tmux-aqua)** 안에 있어야 AX/SR을 상속해 Computer Use가 동작.
- **InputServer primitive 채널**: CLI(두뇌, 권한 0)가 요청하고 앱(권한 경계)이 실행 — `shot`=screencapture / `click`=cliclick / `key`=osascript.
- 키 입력은 **osascript(System Events)로 통일** — cliclick 합성키가 Chrome 확장 팝업 등 웹 UI에 안 먹힘.
- `cliclick`(click primitive)은 번들 동봉 + 호스트 brew로 보장.

### approve 라우터
- 트리거는 `touch` 대신 **`remote-pair` CLI 호출**. approve 로직은 **claude skill**(`~/.claude/skills/approve`)로 존재.
- **적응형 폴링** — 트리거 직후 창이 아직 없어도(에이전트가 수 초 뒤 띄움) 대기 윈도우 동안 기다림.
- **검증 루프** — 클릭/키 후 닫혔는지 재확인, 실패 시 재시도. 단시간 재시도를 늘려 실패확률↓.
- **하이브리드 비전** — OCR 룰 우선, 미스 시 haiku 분류. **vision이 SPOF가 되면 안 됨**(claude 호출 실패 시 fallback 동작).
- approve **타입 인자** 전달(어떤 종류 승인인지).
- **cmd+enter 먼저**(=항상 허용 → 창 재발 안 함), 실패 시 enter(cmd+enter 안 받는 모달 대응).
- Claude for Chrome **site-level permission block 우회** — 에이전트가 실패를 인지하면 fallback로 재시도.
- 에이전트 중심 + **스킬 기반 툴 선택**(하네스가 실패 시 approve 스킬을 안내).
- **persist 자동감지 로직은 넣지 않는다**(의도적 제외).
- 1Password 잠금 프롬프트는 bash tool fail 시 hook으로 처리. m1 기존 훅을 새 훅에 **정확히 동일하게** 반영.
- record(녹화) 시도 시 뜨는 창들도 한 번에 처리.

### 세션 / launch
- **1:1 연결만** 지원(세션공유·멀티어태치 폐기). 충돌 시 1:1 방향으로.
- `remote-pair-launch`는 레퍼런스 `claude-iterm-launch`의 **충실한 1:1 포팅**(robustness 동작 복원).
- **폴더 매핑**: client 경로 → host 경로(외부 동기화로 내용 동일, 절대경로 다름). 기준 루트 `~/Spaces`.
- **결정적 세션 이름**(host 경로 기반 `<HOST>_…`) — 상태바로 머신 식별, 한글 경로 대화 오염 차단.
- **`_N` 넘버링**: `_1`에 클라이언트가 붙어 있으면 `_2` 새로, detached는 `attach -d`로 takeover.
- **resume 버그 수정**: exit 후 빈 대화가 붙는 문제 — `--resume` 폴백이 실패를 삼킴 + stale SID. remote-control/resume/tmux를 동일 id 기반으로. `--dangerously-skip-permissions` 추가.
- 다른 path의 새 세션이 기존 세션을 상속(pollute)하는 버그 수정.
- 고아(orphan) 소켓 세션 자동 감지·정리.
- onboarding을 fancy하게, iTerm2↔terminal을 CLI config로 전환 가능, 폴더매핑 모듈 재사용.
- 비대화 옵션(`--yes`/`RP_YES`) 제공.

### client
- `remote-pair ls`(host 세션 목록), `remote-pair launch <dir>`(폴더 매핑 해석 후 존재 분기).
- Finder Service "Launch Remote Pair"(폴더 우클릭).
- `remote-pair config`로 role(host/client/both) 변경 + **interactive 옵션** 제공.

### host 앱
- 메뉴바 UI: 권한 부여, 설정창, **tmux 세션 목록**(클릭 시 detach/kill 모달, attached/detached 현황), Restart tmux host, Repair install.
- 앱이 tmux 서버 생명주기 관리. **status.json**을 매 tick 기록(앱 생존 + AX/SR/FDA grant ground truth).
- **자기설치**(다운로드 .app 첫 실행) + 버전 스탬프 리소스 갱신(grant·LaunchAgent·host.env 보존).
- skills/rules/CLI 자기설치 **제거** — CLI/README 단일설치가 담당(결합도↓).
- **1:N**(호스트 하나에 여러 클라이언트) 지원하되 세션 자체는 1:1.
- 설치 시 SSH 키 연결 확인 및 미비 시 안내.
- `host-gui-access` 스킬: 활성화 조건을 SKILL.md에 명시, "단정하지 말 것" 주의.

### README / 문서
- 아키텍처 다이어그램, 문제기반 Features, 설치 중심 구성, 깊은 TCC 내부는 본문에서 제거.
- **⚠️ 보안/책임 경고**: macOS 가드레일을 모두 풀기 때문에 부주의로 인한 손해는 전적으로 사용자 책임, as-is 무보증.
- 새 설치방법 반영, **한국어/영어 두 버전**.
- **폴더 매핑 다이어그램**(Google Drive/Syncthing/iCloud, 부모경로는 달라도 하위는 동일).
- 직역투 정정(Computer Use·headless 등 고유명사 영문 유지), 군더더기 제거.
- **Claude Code 붙여넣기 설치 프롬프트**(레포 URL만 — README를 직접 읽음). 한/영 모두 프롬프트는 영어.
- brew 없는 사용자 안내 + [brew.sh] 링크.
- 원격 로그인 섹션: 스크린샷 + Apple 가이드 링크(원격 로그인은 CLI·host 양쪽 설정 필요).
- SSH 키 기반 접근 절차(검증 중심으로 압축).
- 제목 위계: 호스트/클라이언트를 축으로, 하위 단계는 `####`.
- 사용방법 섹션(Finder 실행 스크린샷), 문제해결 & 버그 신고 섹션.
- `docs/`에 내부 로직 문서(architecture.md), 본 requirements.md.

---

## 2. 비기능 요구사항 / 제약

- **Apple Silicon macOS 전용**, macOS Ventura+ (Sequoia 권장).
- 오픈소스 — 별도 배포 인프라 비용 없이 GitHub Releases 활용.
- **`~/.remote-pair`가 상태의 단일 출처** — 기기 간 `~/.claude` 동기화 불요. RemotePair 자체 config은 `.claude` 밖 네임스페이스(기기별, sync 안 함).
- **낮은 결합도 / 높은 응집도**: 앱 = 권한 데몬만, CLI = 두뇌(SSOT 겸 메인 인터페이스). CLI엔 TCC/AX 코드 없음(앱에 위임). 앱이 CLI를 강제 설치하지 않음(CLI는 README 경로로 단일 설치).
- **`.git`은 Syncthing 동기화 제외**(`.stignore`) — 양쪽 git 상태가 달라 오인 커밋/푸시 위험. 작업트리만 동기화, `.git`은 기기-로컬.
- `.claude/projects/` 폴더는 `.gitignore` + git 히스토리 제거(용량·프라이버시).
- 추적가능 로깅(5MB 회전), 실패 시 일시정지.
- 이 프로젝트 대화는 **한국어**. 직역투·군더더기 배제.

---

## 3. 결정 기록 (Decisions)

- **Homebrew Cask 배포 채택** — self-signed 코드서명 문제 회피 + 동일 cert 바이너리로 cross-cert grant 깨짐을 근본 해결.
- **소스 빌드를 bootstrap에서 제거**, 메인테이너 전용으로 분리(brew가 앱 공급).
- **bootstrap이 host면 brew cask까지 자동** 설치(“cli가 다 해버리자”).
- **1:1 연결만** — 세션공유 폐기. launch는 `claude-iterm-launch` 충실 포팅.
- **approve 키는 osascript** 통일(cliclick 합성키가 Chrome 확장 팝업에 안 먹힘).
- **persist 자동감지 로직 제외**(의도적).
- approve는 에이전트 중심 + 스킬 기반 툴 선택.
- RemotePair config는 자체 네임스페이스(`~/.remote-pair`), `.claude`는 에이전트 정체성(skill·rules·logs) 전용.
- **sync 기본 off**(동기화 없는 환경에서도 동작).
- `legacy/` 폴더 삭제.
- **세션 식별은 결정적 id 기반**(한글 경로 오염 차단) — uuid5/`--session-id` 방식은 철회.
- `claude` 실행에 `--dangerously-skip-permissions` 추가.
- 릴리스는 **m4(canonical cert)에서만** 서명. 버전 0.4.x 유지.

---

## 4. 미해결 / 열린 항목 (Open issues)

- ~~**brew cask appdir 불일치**~~ (해결됨) — Homebrew cask 기본 위치 `/Applications`에 맞춰 통일. `config.sh` `APP_PATH`·Updater·Installer 폴백·Permissions 안내·README를 모두 `/Applications`로 변경(`install.sh` 소스빌드도 `APP_PATH` 경유라 함께 정렬). 앱 자기설치 LaunchAgent는 `Bundle.main` 실제 경로를 써서 원래도 무관.
- 메인테이너 문서의 버전(0.4.10)과 실제 cask 버전(0.4.11) 불일치.
- **알려진 버그 큐** — approve 오진 경고·status pid 중복 출력·메뉴바 세션 표시·m1/m4 클린설치 — 0.4.10에 수정 목표.
- 클린설치 테스트(m1/m4)를 cron 예약으로 검증.
- 메뉴바 "활성 세션 없음" 표시가 실제 세션 상태와 불일치(앱 미기동·status.json 부재 시 ground-truth 괴리).
- README 영문 반영 지연 우려(구조는 한/영 1:1 일치 확인됨).

---

*출처: 세션 27d757a4 · 318aaabe · a26f7244 · afad7df4 · df30583d (로컬), 109edb94 · 644df73d (호스트). 4d6e9677 · a23aa692(호스트)는 approve/heartbeat 자동 실행 세션으로 사람 요구사항 없음.*
