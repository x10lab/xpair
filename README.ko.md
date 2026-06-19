<p align="center">
  <img src="assets/icon/AppIcon-1024.png" alt="Xpair" width="128">
</p>

<h1 align="center">Xpair</h1>

<p align="center"><a href="README.md">English</a> · <b>한국어</b></p>

<p align="center"><i>노트북을 닫아도, 멈추지 않는 업무.</i></p>

**Xpair**는 당신이 이미 구독 중인 Claude(또는 Codex·Gemini)를 **전용 원격 Mac**에서, macOS **Computer Use**(스크린샷·클릭·타이핑)를 살린 채로 — 자리를 비워도, 모든 동작이 눈에 보이게 — 돌려, 긴 작업을 끝까지 굴려주는 도구입니다. 노트북이나 폰에서 mosh/SSH로 붙습니다.

> **이름 안내:** *Xpair*는 제품 브랜드명입니다. 실제 출하 소프트웨어는 아직 **`RemotePair`** 이름을 씁니다 — 호스트 앱(`RemotePairHost.app`), 클라이언트 IDE(`RemotePair`), `remote-pair` CLI — 저장소는 [`x10lab/xpair`](https://github.com/x10lab/xpair)에 있습니다. Xpair 브랜드로의 전면 리네임은 진행 중이며, 아래 식별자들은 지금 실제로 통하는 값입니다.

![Xpair 아키텍처](assets/architecture.png)

- **호스트 Mac** — `claude`를 영속 tmux 세션 안에서, Computer Use가 살아 있는 채로 24/7 돌립니다.
- **클라이언트** — **Xpair IDE**(VSCodium 포크) 또는 `remote-pair` CLI로, 노트북에서 Finder 우클릭 한 번으로 붙습니다.
- **모바일** — 폰의 Claude Code에서 같은 세션에 들어갑니다.

### 왜 Xpair인가

1. **내 컴퓨터를 뺏기지 않는다.** 작업은 전용(원격) Mac에서 돌아가서 내 노트북은 자유롭습니다 — 평소처럼 쓰고, 뚜껑을 닫아도 세션은 계속됩니다.
2. **승인 대기로 멈추지 않는다.** Auto-Approve가, headless·무인 세션을 막아 세웠을 권한 프롬프트를 알아서 통과시켜, 자는 동안에도 작업이 이어집니다.
3. **블랙박스가 아니다.** 원격 데스크톱을 스트리밍해 모든 동작을 눈으로 봅니다. 엔진은 풀파워 **Claude Code** — 내 구독 그대로, 중간에 끼는 제3자 wrapper 없음.

**과금:** 이미 결제 중인 Claude / Codex / Gemini 구독을 그대로 연결하면 됩니다. Xpair가 따로 청구하는 AI 크레딧은 **0원**. 코어는 오픈소스(AGPL-3.0)이며, 관리형 **Hosted** 티어(Mac 환경까지 제공)는 출시 예정입니다.

---

## 빠른 시작 — Claude Code에게 설치 맡기기

이미 Claude Code가 있다면? **설정하려는 Mac에서** 세션을 열고 아래 블록을 붙여넣으면 — 역할 판단, 설치, SSH 연결, 유일한 수동 권한 단계 안내까지 전 과정을 알아서 진행해 줍니다.

```text
Set up Xpair / RemotePair (https://github.com/x10lab/xpair) on this Mac. Fetch and read its README, then follow it. Figure out whether this Mac is the host or the client, explain each command before you run it, and stop for anything that needs my input or my physical screen (like the one-time permission grant). Finish with remote-pair doctor and a summary of what's left for me to do.
```

직접 하고 싶다면? 아래 [설치](#설치)를 참고하세요.

---

## 기능

각 기능은 구체적인 문제 하나를 해결합니다. 아래 **코어**는 지금 작동하고, 일부 표면은 아직 **진행 중**이며 그렇게 표시했습니다.

### 원격으로 가도 살아남는 Computer Use
**문제:** `claude`를 SSH로 띄우면 macOS가 손쉬운 사용(AX)·화면 기록(SR) 권한을 떼어버려, 스크린샷·클릭·타이핑이 조용히 멈춥니다.
**해결:** 권한을 쥔 메뉴바 앱(`RemotePairHost.app`)이 그 권한을 소유하고 `claude`를 자기 프로세스 하위 트리 안에 두기 때문에, 어떤 클라이언트가 붙어 있든 Computer Use가 계속 작동합니다. 내 Claude가 앱과 브라우저를 사람처럼 직접 다룹니다 — 복잡한 대시보드를 배울 필요 없이, 원하는 것만 입력하면 됩니다.

### 전용 원격 Mac — 내 컴퓨터를 계속 쓴다
**문제:** 컴퓨터를 다루려면 에이전트에게도 컴퓨터가 필요합니다. 내 것을 빌려 쓰면 정작 나는 잠깁니다 — 마우스도, 화면도, 작업도 못 합니다.
**해결:** 모든 게 자기 Mac에서 돌아갑니다. 내 노트북은 자유롭고, 뚜껑을 닫아도 아무것도 멈추지 않습니다. 데스크톱이든 폰이든 원할 때 가볍게 확인만 하세요.

### 연결이 끊겨도 살아남는 세션
**문제:** 노트북을 닫거나 Wi-Fi가 끊기면 오래 돌던 `claude` 세션이 연결과 함께 죽습니다.
**해결:** 패치된 tmux(`tmux-aqua`)가 모든 세션을 호스트에 살려둡니다. 언제든 다시 붙으세요 — 붙어 있으면 `Attached`, 떠나 있으면 `Detached`, 어느 쪽이든 세션은 24/7 돌아갑니다.

### 잠든 사이에도 계속 — 대신 답해주는 승인
**문제:** headless·무인 호스트에서 "허용?" 대화상자(또는 1Password 잠금 해제 프롬프트)가 세션을 막아 세우는데, 곁에 yes를 눌러줄 사람이 없습니다.
**해결:** on-demand approve 라우터(OCR + 클릭, miss 시 Claude 분류 fallback)가 대화상자를 감지해 올바른 버튼을 눌러줘서, headless 세션이 멈추지 않고 밤새 작업이 이어집니다.

### 우클릭 한 번으로 시작
**문제:** 늘 호스트 Mac 앞에 앉아 있는 건 아니고, 특정 프로젝트 폴더에 묶인 세션을 원합니다.
**해결:** 폴더를 우클릭하면(Finder → 빠른 동작 → *Launch Remote Pair*) 거기서 바로, 그 폴더의 호스트 경로에 attach된 세션이 시작됩니다. 폴더별로 하나씩 돌리고, 한 곳에서 관리하세요.

### 핸드폰 속의 내 책상
**문제:** 자리를 떠도 일은 굴러가야 합니다.
**해결:** **폰의 Claude Code**에서 같은 세션에 닿습니다 — 호스트에서 돌고 있는 바로 그 tmux 세션에 SSH/mosh로 붙습니다. 따로 깔 앱 없이, 일은 굴러가고 통제권은 내 손에 있습니다.

### 진행 중
연결은 돼 있지만 아직 여물어 가는 것들(scaffold / spike)입니다 — 거친 부분이 있을 수 있습니다:

- **Xpair IDE**(VSCodium 포크): *Sessions* 사이드바와 *Browser* 컨테이너는 출하됐고, 임베디드 익스텐션 번들링·인-IDE **Remote Desktop** 스트리밍·**code-server 에디터**는 아직 배선 중입니다. [Xpair IDE](#xpair-ide-클라이언트) 참고.
- **라이브 원격 데스크톱 스트리밍**: 현재 `remote-pair desktop`은 macOS 화면 공유(VNC)를 엽니다; 저지연 자체 엔진(`host/rd`, JPEG → WebRTC)은 spike 단계입니다.
- **Electron 온보딩 창**(호스트 + 클라이언트)을 처음부터 다시 만드는 중입니다 — [온보딩](#온보딩-진행-중) 참고.
- **Hosted 티어**(원격 Mac까지 제공)는 출시 예정입니다.

---

## 요구 사항

- Apple Silicon Mac(호스트와 클라이언트)
- macOS Sequoia 이상 권장
- 클라이언트와 호스트 사이 SSH 키 인증
- 양쪽 모두 `mosh`(순수 SSH도 되지만, 연결이 끊기면 라이브 attach가 죽습니다)
- **호스트:** Homebrew(앱 cask용) + git. 빌드 안 함 — tmux-aqua는 앱에 임베드돼 있어 Xcode 불필요. (소스 빌드는 메인테이너만 해당)
- **클라이언트:** Xpair IDE cask(`remote-pair`) 또는 `remote-pair` CLI + Finder 빠른 동작.

---

## 설치

### 호스트 — 항상 켜져 있는 Mac

명령 하나로 호스트가 셋업됩니다. `remote-pair` CLI + approve 규칙·스킬(데몬 glue)을 깔고, 이어서 앱(`RemotePairHost.app`)을 Homebrew Cask로 설치합니다:

```bash
curl -fsSL https://raw.githubusercontent.com/x10lab/xpair/main/shared/bootstrap.sh | ROLE=host bash
```

첫 실행 시 앱이 **데몬**(LaunchAgent, `~/.remote-pair`, tmux-aqua 링크, watchdog)을 스스로 설치합니다. 앱은 self-signed이고 공증되지 않았지만, Homebrew가 quarantine 플래그를 떼어주므로 정상 실행되고 손쉬운 사용·화면 기록 권한도 안정적인 서명 정체성에 묶여 유지됩니다(TCC는 공증이 필요 없습니다 — quarantine만 없고 서명이 안정적이면 됨).

> Homebrew가 없다면? 스크립트가 알려주고 멈춥니다 — 설치([brew.sh](https://brew.sh)) 후 다시 실행하면 cask까지 알아서 깝니다. 앱 바이너리는 Homebrew가, 나머지는 스크립트가 담당합니다.

> 앱만 필요하고 CLI는 안 쓴다면? `brew tap x10lab/xpair https://github.com/x10lab/xpair && brew install --cask remote-pair-host`. (소스 빌드는 [메인테이너용](#메인테이너용) 참고.)

설치했으면 아래 **일회성 권한 부여**로 마무리하세요.

#### 일회성 권한 부여 — 물리적 화면 또는 VNC 필요

이건 유일한 수동 단계이고, 호스트 화면에서만 할 수 있습니다(SIP가 켜진 비-MDM Mac에서는 TCC를 SSH로 부여할 수 없습니다). **시스템 설정 → 개인정보 보호 및 보안**을 열고 `RemotePairHost`를 세 권한에 대해 ON 하세요(어떤 창에 목록이 없으면 `+`를 눌러 `/Applications/RemotePairHost.app`을 추가):

| 권한 | 이유 | 필요? |
|---|---|---|
| **손쉬운 사용(Accessibility)** | Computer Use를 위한 합성 입력(클릭/타이핑) | **필수** |
| **화면 기록(Screen Recording)** | Computer Use를 위한 스크린샷 | **필수** |
| **전체 디스크 접근(Full Disk Access)** | *headless* 호스트가 원격으로 답할 수 없는 macOS 폴더 프롬프트가 뜨는 것을 예방합니다(답하지 않은 프롬프트는 세션을 멈춤). trade-off: 이 권한을 실제로 쓰는 건 Xpair 로직이 아니라 **그 안에서 띄운 Claude Code 세션**입니다(Xpair 자체는 설치를 제외하면 디스크 접근을 쓰지 않음) — 그래서 그 세션이 디스크 전체(메일·메시지·브라우저 포함)를 조용히 읽을 수 있습니다. | **권장** |

앱 안의 **Grant Permissions…** 메뉴가 세 창을 모두 열고 각 항목의 실시간 ✓/✗ 상태를 보여줍니다. 켠 뒤 아래 명령으로 권한을 반영합니다:

```bash
launchctl kickstart -k gui/$(id -u)/com.x10lab.remote-pair-host   # 또는: 메뉴바 → Restart tmux host
```

> 전체 디스크 접근을 주기 싫다면? 프로젝트 폴더를 **보호되지 않은 루트**(예: `~/Desktop`/`~/Documents`/`~/Downloads`가 아닌 `~/Spaces`) 아래에 두세요 — 그러면 세션이 보호된 폴더에 닿지 않아 프롬프트가 뜨지 않으면서도, 디스크 전체를 열 필요가 없습니다.

### 클라이언트 — 직접 쓰는 노트북

클라이언트는 **Xpair IDE**(Sessions 사이드바가 있는 VSCodium 기반 앱)로 쓸 수도, **CLI + Finder 빠른 동작**으로 쓸 수도 있습니다 — 둘은 같은 `remote-pair` 설정과 호스트를 공유합니다.

#### SSH 접근 — 호스트에 키 기반 로그인

Xpair는 호스트를 SSH로 제어하므로, 필요한 건 비밀번호 없는 로그인이 되는 상태뿐입니다. 확인:

```bash
ssh gh-mac-m1   # 프롬프트 없이 호스트 셸로 들어가면 성공
```

아직 안 된다면? 호스트에서 **원격 로그인**을 켜고(시스템 설정 → 일반 → 공유 — [Apple 가이드](https://support.apple.com/ko-kr/guide/mac-help/allow-a-remote-computer-to-access-your-mac-mchlp1066/mac)), 클라이언트에서 평범하게 키 인증을 설정하세요(키가 없으면 `ssh-keygen`, 그다음 `ssh-copy-id 계정@호스트`). 호스트에 `~/.ssh/config` 별칭을 `gh-mac-m1`처럼 짧게 달아두면 — 그 별칭이 나중에 `remote-pair config set host`에 넣는 값입니다.

<p align="center">
  <img src="assets/remote-login.png" alt="호스트에서 원격 로그인 켜기: 시스템 설정 → 일반 → 공유" width="640">
</p>

> LAN 밖에서 호스트에 붙어야 하나요? **[Tailscale](https://tailscale.com)** 같은 메시 VPN이 어디서나 통하는 안정적인 이름을 호스트에 줍니다. `mosh`와 함께 쓰면 네트워크가 끊겨도 attach가 살아남습니다.

#### 클라이언트 설치

**Xpair IDE (cask):**

```bash
brew tap x10lab/xpair https://github.com/x10lab/xpair && brew install --cask remote-pair
```

**CLI + Finder 빠른 동작 (IDE 없이):**

```bash
curl -fsSL https://raw.githubusercontent.com/x10lab/xpair/main/shared/bootstrap.sh | ROLE=client bash
```

CLI 설치는 Finder 빠른 동작 + `remote-pair` CLI를 깔고, 이어서 `remote-pair onboard`(호스트 주소, 터미널 앱, 폴더 매핑)를 자동 실행합니다.

### 되돌릴 수 있는 제거

```bash
~/.local/share/remote-pair/shared/uninstall.sh          # 설치된 파일 제거(manifest 추적)
~/.local/share/remote-pair/shared/uninstall.sh --purge  # ~/.remote-pair 상태까지 제거
```

> Homebrew로 설치했다면 앱은 `brew uninstall --cask remote-pair-host`(IDE는 `remote-pair`)로 제거하세요(`--zap`을 붙이면 `~/.remote-pair`도 함께 정리).

---

## 폴더 매핑 (먼저 해야 함)

Xpair는 `claude`를 **호스트에서**, **호스트의 파일**을 대상으로 실행합니다. 그래서 노트북에서 실행하는 프로젝트는 호스트에 이미 존재해야 합니다 — Xpair는 파일을 복사하지 않고, 호스트 경로에 attach합니다. 양쪽 동기화는 **Google Drive, Syncthing, iCloud 등 파일 동기화 도구**로 직접 유지하거나(또는 `remote-pair mount`로 호스트 폴더를 직접 마운트 — [docs/m-mount.md](docs/m-mount.md) 참고), 그러면 같은 프로젝트가 기기마다 (다를 수 있는) 절대 경로에 존재하게 됩니다.

**매핑**은 주어진 클라이언트 경로가 어떤 호스트 경로에 대응하는지 Xpair에게 알려줍니다. 동기화 루트는 기기마다 부모 경로가 다르지만(`ghyeong` vs `rpi/Desktop`), **그 아래는 동일해야** 합니다 — Xpair는 호스트의 같은 하위 폴더 구조에 attach합니다:

<p align="center">
  <img src="assets/folder-mapping.png" alt="폴더 매핑: 호스트와 클라이언트의 동기화 루트는 부모 경로가 다르지만 하위 폴더는 동일" width="720">
</p>

```bash
remote-pair map add ~/Drive/proj /Users/me/proj   # 한 번 등록
remote-pair launch ~/Drive/proj                   # → 호스트의 /Users/me/proj에 attach
```

- **양쪽 경로가 같다면?** (예: `~/Spaces/proj`가 동일하게 존재) — 매핑 불필요, 실행 시 바로 해석됩니다.
- **경로가 다르다면?** 한 번 매핑을 등록하세요. 그 뒤로는 CLI와 Finder 빠른 동작 모두 자동으로 해석합니다.
- **매핑 안 됨 + 경로 다름?** `remote-pair launch`가 대화형 탐색을 돌립니다(호스트 경로 존재 확인 후 등록/생성/취소 제안). Finder GUI는 물어볼 수 없으므로 매핑이 미리 필요합니다.

> **작업 트리만** 동기화하고 `.git`은 제외하세요 — 활성 `.git`을 기기 간 동기화하면 저장소가 손상됩니다. 각 기기가 자기 `.git`을 두고, 소스 파일만 공유하세요.

---

## 사용법

```bash
# 경로가 다르면 폴더를 한 번 매핑(클라이언트 경로 → 호스트 경로)
remote-pair map add ~/Drive/proj /Users/me/proj

# 세션 실행 / attach
remote-pair launch ~/Drive/proj
remote-pair launch ~/Drive/proj --fresh   # 항상 새 세션
remote-pair launch ~/Drive/proj --yes     # 비대화형

# 또는: Finder → 폴더 우클릭 → 빠른 동작 → Launch Remote Pair
```

세션마다 유일한 상호작용은 claude 자체의 **"Allow for this session"** 프롬프트뿐 — Enter 한 번이면 됩니다.

### Finder에서 실행 (GUI) — 폴더 매핑 필요

폴더 우클릭 → **서비스 → "Launch Remote Claude"** 로 그 폴더의 호스트 세션에 붙습니다.

<p align="center">
  <img src="assets/usage-finder-launch.png" alt="Finder 우클릭 → 서비스 → Launch Remote Claude" width="420">
</p>

**폴더가 먼저 매핑돼 있어야** 합니다(GUI는 호스트 경로를 대화형으로 물어볼 수 없음):
- **매핑됨**(`remote-pair map add`로 등록했거나, 클라이언트==호스트 동일 경로) → 바로 attach/생성.
- **매핑 안 됨** → GUI가 호스트 경로를 풀 수 없어 아무것도 하지 않습니다. 먼저 한 번 등록하세요:
  `remote-pair map add <폴더> <호스트경로>` 또는 `remote-pair launch <폴더>`(매핑 안 됐을 때 등록을 물음). 그 뒤로는 그 폴더에 대해 GUI가 작동합니다.

### 전체 명령

```bash
remote-pair launch <dir>     # 폴더의 세션 실행 / attach (매핑 안 됐으면 등록을 물음)
remote-pair ls               # 호스트 세션 + 폴더 매핑
remote-pair map add|rm|list  # 클라이언트 경로 ↔ 호스트 경로 매핑
remote-pair onboard          # 다시 실행 가능한 클라이언트 설정(호스트, 터미널, 매핑, doctor)
remote-pair open-gui <dir>   # 설정된 터미널 앱을 열고 새 탭/창에서 <dir> 실행
remote-pair status           # 앱 PID, 호스트 서버, heartbeat 경과
remote-pair doctor           # SSH 인증, 호스트 앱, 호스트의 tmux-aqua 점검
remote-pair desktop open     # macOS 화면 공유(vnc://)로 호스트 화면 열기 — 진행 중 참고
remote-pair editor start     # loopback에서 code-server 에디터 시작(기본 :8080) — scaffold
remote-pair mount            # 호스트 폴더 직접 마운트(Syncthing 대안; smb/sshfs) — docs/m-mount.md
remote-pair logs [--host -f] # 런처/앱 로그 tail (--host = SSH로 호스트 로그)
remote-pair self-update      # 클라이언트(런처/CLI)를 GitHub 최신으로 업데이트
remote-pair update           # .app/tmux는 건드리지 않고 glue 레이어(CLI/approve/hooks) 핫스왑 (M6 L1)
remote-pair config set host my-mac-mini
remote-pair config set terminal iterm2     # 또는: terminal
```

---

## Xpair IDE (클라이언트)

클라이언트는 **VSCodium 포크**(`remote-pair` cask)로 출하됩니다 — 원격 페어링을 중심으로 재구성한 익숙한 에디터입니다. 이전의 브라우저 기반 "Web UI"(`remote-pair web` localhost 브리지)의 후계이며, 그 web UI는 **제거**됐습니다. 기본 VSCodium에 더해진 것:

- **Sessions 사이드바** — 호스트 세션(Attached / Detached)을 나열하는 유일한 고정 사이드바, 세션 피커 포함. IDE의 홈 베이스입니다.
- **Browser 컨테이너** — 폴더/Search/Extensions 컨테이너로, 폴더별 즐겨찾기(hover 별 + `+`)를 제공하며 기본 Explorer 크롬을 대체합니다.
- **Remote Desktop 패널** *(진행 중)* — IDE 안에서 호스트 화면을 보고 조작합니다(v1 JPEG, v2 WebRTC). 현재 스트리밍 엔진(`host/rd`)은 spike이고, `remote-pair desktop open`은 macOS 화면 공유(VNC)로 fallback합니다.
- **에디터(code-server)** *(scaffold)* — `remote-pair-editor`가 loopback에서 code-server를 돌립니다; 인-IDE 탭과 Claude Code 익스텐션 배선은 WIP입니다.

IDE는 기본 VSCodium을 **불가침**으로 유지합니다: RemotePair 변경은 `client/ide/remotepair/`에만(프론트엔드 패치 1개 + 임베디드 익스텐션 + product 오버레이) 살아 있어, 업스트림 VSCodium pull이 충돌 없이 깨끗합니다. [`client/ide/remotepair/REMOTEPAIR.md`](client/ide/remotepair/REMOTEPAIR.md) 참고.

### 온보딩 *(진행 중)*

첫 실행 온보딩을 **Electron 창 2개** — 하나는 `RemotePairHost`(호스트 앱)에, 하나는 Xpair IDE(클라이언트)에 임베드 — 로 처음부터 다시 만드는 중입니다. 역할 선택·권한 부여·SSH/호스트 설정·폴더 매핑을 다룹니다. 이전의 web 마법사는 폐기됐고, 새 창들은 아직 완성 전입니다.

<p align="center">
  <img src="client-onboarding-v2.png" alt="클라이언트 온보딩 스토리보드: 호스트 연결, 네트워크/Tailscale 검색, 페어링 코드, SSH 설정, 연결 완료" width="720">
</p>

### 알림 포워딩 (host → client)

**호스트**에 알림 훅을 설치하면 Claude Code의 Stop/Notification 이벤트가 클라이언트로 전달됩니다:

```bash
# 호스트에서 — bootstrap이 이미 설치; 필요 시 수동 재설치:
~/.local/share/remote-pair/host/hooks/manage-claude-hooks.py install
```

훅(`host/hooks/remote-pair-notify.sh`)이 이벤트를 `~/.remote-pair/notifications/queue.jsonl`에 기록합니다. 클라이언트가 SSH로 이 파일을 폴링하고(`remote-pair notify`) 알림을 표시합니다. `~/.remote-pair/notify.conf`(`host/hooks/notify.conf.example` 참고)의 `ENABLED_TYPES`(기본 `notification,stop`)로 포워딩할 이벤트 종류를 선택할 수 있습니다.

### 정체성 안내

현재 출하 정체성은 **`RemotePairHost`**(`com.x10lab.remote-pair-host`, 호스트 앱)와 **`RemotePair`**(`com.x10lab.remote-pair`, 클라이언트 IDE)입니다. *Xpair* 제품 브랜드를 이 위에 입히는 중이며, 위 식별자들이 지금 실제 값입니다. 직접 설치하지 않은 정체성의 앱에는 권한을 부여하지 마세요.

---

## 참고 및 주의

> ⚠️ **보안과 책임 — 반드시 읽으세요.** Xpair는 의도적으로 호스트에서 macOS의 안전장치를 낮춥니다: 손쉬운 사용 + 화면 기록(그리고 켰다면 **전체 디스크 접근**)을 쥐고, 자율 `claude` 에이전트를 그 권한 있는 프로세스 하위 트리 *안에서* 24/7 원격 접근 가능한 상태로 돌립니다. 사실상 호스트의 에이전트가 화면을 보고, 클릭·키 입력을 합성하고, 전체 디스크 접근이 있으면 디스크 전체(메일, 메시지, 브라우저 데이터, SSH 키 전부)를 조용히 읽고 쓸 수 있습니다. (이 권한들을 실제로 행사하는 주체는 Xpair 로직이 아니라 그 안에서 도는 `claude` 세션입니다 — Xpair 자체는 설치를 제외하면 디스크를 건드리지 않습니다.) 그게 이 도구의 본질이며, 당신이 의도적으로 받아들이는 trade-off입니다. **호스트에서 무엇이 돌아가는지는 전적으로 당신 책임입니다.** 잘못된 설정, 부주의한 지시, 프롬프트 인젝션, 방치된 세션으로 인한 데이터 손실·유출·손상은 전적으로 운영자 책임입니다. 본인 소유의 개인 기기에서만 돌리고, 실제로 필요한 최소 권한만 부여하고(전체 디스크 접근보다 보호되지 않은 프로젝트 루트를 선호), 잃어선 안 되는 것에 연결하지 마세요. 소프트웨어는 **있는 그대로, 어떤 보증도 없이** 제공됩니다([LICENSE](LICENSE) 참고).

---

## 텔레메트리 — 기본 꺼짐, 동의 시에만

Xpair는 **기본으로 켜진 텔레메트리가 없습니다.** 아래 두 보고 채널은 모두 **옵트인**입니다 —
당신이 명시적으로 켜기 전에는 완전히 침묵하며, 켜더라도 당신이나 당신의 작업을 식별할 수 있는 것은
절대 보내지 않습니다. 코드는 공개돼 있으니 직접 감사하세요.

**독립된 두 스위치, 둘 다 기본 꺼짐:**

| 스위치 | 하는 일 | 켰을 때 |
|---|---|---|
| 제품 분석 (`telemetry_consent` → PostHog) | 익명 활성화 퍼널 이벤트 — 셋업이 어디서 막히는지 파악 | 익명 이벤트 7종(예: "온보딩 시작", "호스트 연결", "첫 세션 시작")을 타이밍과 함께 전송 |
| 크래시 리포트 (`crash_report_consent` → Sentry) | 마스킹된 크래시/오류 리포트 업로드 | 크래시 시 마스킹된 스택 트레이스를 전송(로컬 크래시 덤프는 어느 쪽이든 항상 기록) |

둘은 서로 독립적이라 한쪽만 켤 수 있습니다. 첫 실행 시(체크 안 된 체크박스 2개) 선택하고, 이후
설정에서 각각 다시 토글할 수 있습니다.

**수집되는 것(옵트인했을 때만):** 익명 랜덤 설치 id(이 기기에서 한 번 생성되는 UUID — 어떤 계정과도
연결되지 않음), 앱 버전, OS 버전, CPU 아키텍처, 그리고 타이밍이 붙은 소수의 퍼널 이벤트. 실패는 원시
오류 텍스트가 아니라 고정된 사유 코드(`timeout`, `auth_denied`, `host_unreachable`, …)로 보고됩니다.

**절대 수집하지 않는 것:** 저장소 이름, 파일 경로, 명령 내용, IP 주소, 호스트명·ssh 별칭, 그 어떤
개인정보도 보내지 않습니다. 모든 페이로드는 기기를 떠나기 전 로컬 로그와 동일한 `redact()` 필터를
거치며, 크래시 리포트는 Apple/Sentry의 PII 수집을 끈 상태로 보냅니다.

**기본 꺼짐 = 네트워크 호출 0** — 두 스위치 모두 꺼져 있으면 Xpair는 어떤 분석·크래시 엔드포인트에도
연결하지 않습니다. 현재 분석은 PostHog Cloud(EU 리전), 크래시 리포트는 Sentry로 향합니다. 엔드포인트는
설정 가능하며, 분석은 추후 자체 호스팅 인프라로 옮길 계획입니다. 전체 이벤트 카탈로그와 프라이버시
계약은 [docs/logging.md §11](docs/logging.md)을 참고하세요.

---

## 문제 해결 & 버그 신고

뭔가 안 되나요? 신고 전에 먼저 이걸 거쳐보세요:

1. **doctor 실행.** `remote-pair doctor`가 SSH 인증·호스트 앱·호스트의 tmux-aqua를 점검합니다 — 대부분의 설정 문제를 잡아주고 어느 쪽이 잘못됐는지 알려줍니다.
2. **status + 로그 확인.** `remote-pair status`는 앱 PID·호스트 서버·heartbeat 경과를 보여줍니다. 로그는 `~/.remote-pair/logs/`에 있습니다(`remote-pair.log`가 메인).
3. **`claude` 업데이트 후 Computer Use가 멈췄다면?** MCP 서버를 토글하세요: `/mcp disable computer-use` 후 `/mcp enable computer-use`. (TCC 재부여는 불필요.)
4. **권한은 켜진 것 같은데 Computer Use가 실패?** 권한을 다시 반영하세요: `launchctl kickstart -k gui/$(id -u)/com.x10lab.remote-pair-host`.

그래도 막히면 **[이슈를 열어주세요](https://github.com/x10lab/xpair/issues)**. 아래를 함께 넣어주세요:

- 버전(`remote-pair status` 또는 앱 메뉴바 **About**)과 macOS 버전.
- `remote-pair doctor` 출력과 `~/.remote-pair/logs/remote-pair.log`의 관련 부분.
- 기대한 동작 vs 실제 동작, 그리고 재현 단계.

> 비밀값은 붙여넣지 마세요 — 로그에서 SSH 호스트명·키·토큰을 지우고 첨부하세요.

---

## 메인테이너용

단일 **모노레포**(`host/` + `client/` + `shared/`)이며, lockstep으로 빌드됩니다:

```bash
./host/build-tmux-aqua.sh              # 패치된 tmux → ~/.local/bin/tmux-aqua (tmux 3.6)
./host/make-signing-cert.sh            # 안정 self-signed cert "RemotePair Local Signing" (멱등)
./host/build-host.sh                   # → build/RemotePairHost.app (서명 + 검증)
./host/build-host.sh --deploy [host]   # 빌드 + rsync + 호스트에 설치
./client/ide/build.sh                  # → Xpair IDE (VSCodium 포크) 앱
shared/identity/check-identity.sh      # 브랜드/버전 일관성(SoT: shared/identity/)
```

버전은 `shared/identity/versions.json`에 한 번 선언되고(host **0.5.0**, ide / screen-engine **0.1.0**), 소비처(casks, product.json, Cargo, Config.swift) 전반에서 검증됩니다. 릴리스 자산은 실행 중인 설치와 **같은** 안정 cert로 서명돼야 합니다 — 인앱 업데이터가 leaf CN을 검증해 불일치 교체를 막습니다. 릴리스(호스트 앱 + IDE)는 `.github/workflows/release.yml`로 함께 발행됩니다.

저장소 구조([docs/monorepo-structure.md](docs/monorepo-structure.md) 참고):

- `host/` — `app/`(메뉴바 Swift 앱), `rd/`(자체 원격 데스크톱 엔진: `screen/` Rust + `rpmedia/` Swift), `hooks/`, `skills/`, approve 라우터, 빌드 glue.
- `client/` — `cli/`(`remote-pair*` 스크립트 + Finder 서비스)와 `ide/`(VSCodium 포크: `remotepair/` = 우리 코드, `vendor/vscodium/` = pristine 업스트림 subtree).
- `shared/` — install 라이브러리, config SSOT, `identity/`·`screen-protocol/` 단일 진실원천, bootstrap.
- `docs/`, `tests/`, `assets/`, `Casks/`.

---

## 라이선스

AGPL-3.0-or-later. [LICENSE](LICENSE) 참고. (상용/dual 라이선스 문의 가능)

개인용 도구이며 macOS(Apple Silicon)에서 테스트되었습니다. Apple과 무관합니다. 기여 환영 — 큰 변경 전에는 이슈를 먼저 열어주세요.
