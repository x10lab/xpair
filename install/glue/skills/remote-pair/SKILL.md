---
name: remote-pair
description: >
  RemotePair 세션(원격 mosh/ssh tmux 안의 Claude Code가 macOS computer-use 사용) 관련 동작 지침.
  스크린샷·클릭·타이핑이 필요하거나, 승인(approve) 정책·권한 토글·tmux-aqua 호스트 상태를
  다룰 때, 또는 "원격에서 화면 봐줘 / 클릭해줘 / RemotePair" 류 요청에 트리거.
metadata:
  type: reference
---

# RemotePair

원격(mosh/ssh)으로 attach한 persistent tmux(`tmux-aqua`) 세션 안에서 Claude Code가 macOS 빌트인
computer-use(스크린샷·클릭·타이핑)를 쓸 수 있게 하는 시스템. claude는 granted host 앱(RemotePair.app)이
띄운 tmux-aqua 서버의 자식이라 attach하는 client(mosh/ssh)와 무관하게 AX/SR 권한을 상속한다.

이 스킬은 **두 종류의 승인(approve)을 분리**해 다룬다. 메커니즘과 정책을 섞지 말 것.

## (A) Claude Code 자체 권한 — 선언적 정책으로 (GUI 클릭 금지)

claude 자신의 tool 승인("Allow this command?", 파일 편집 등)은 **화면 클릭으로 때우지 않는다.**
Claude Code 네이티브 권한 시스템으로 선언한다 — 이게 동기화·포터블·안전.

- 반복 승인이 필요한 안전한 작업은 `~/.claude/settings.json` 의 `permissions.allow` 에 스코프해서 추가.
  (설정 변경은 `update-config` 스킬을 사용 — settings.json/hook 은 하네스가 실행.)
- 위험·비가역 작업(rm -rf, force-push, prod 등)은 **자동 승인 금지**. 사용자 확인 유지.
- 즉 "무엇을 자동 승인할지"는 규칙으로 표현하고, 화면 클릭에 의존하지 않는다.

## (B) OS 시스템 다이얼로그 — 네이티브 클릭러(엔진)가 처리

1Password·방화벽·macOS 권한 프롬프트 등 **OS 모달**은 claude 턴 바깥에서도 뜨므로 skill이 아니라
RemotePair.app 의 네이티브 엔진이 1초 타이머로 클릭한다. 정책 데이터는 `~/.claude/auto-approve/rules.txt`
(한 줄 = `proc <TAB> mode <TAB> label|label|...`). 규칙만 고치면 재빌드 없이 다음 tick 에 반영.

> ⚠ 보안: rules.txt 에 1Password "Authorize" 자동 클릭이 들어 있으면 **어떤 프로세스든** 1Password
> 프롬프트를 자동 승인하게 된다. 신뢰 경계를 좁게 유지하고, 꼭 필요한 proc/label 만 등록할 것.

## computer-use 사용 시

- 세션당 한 번 claude 빌트인 "Allow for this session" 프롬프트에 Enter 1회 — 정상 동작.
- "computer use not granted" (claude update 후): claude 안에서 `/mcp disable computer-use && /mcp enable computer-use`
  로 현재 버전 helper 번들 재추출. (RemotePair grant 와 별개.)
- 호스트 서버 확인: `tmux-aqua -S "$AQUA_SOCK" ls` 로 `_keeper` 세션 존재 확인. 없으면 `open -a RemotePair`.

## 설정 출처

식별자·호스트·경로는 `~/.claude/remote-pair/config.env`(install.sh 가 확정) 단일 출처. 하드코딩하지 말 것.
설치/원복은 RemotePair 저장소의 `install/install.sh` · `install/uninstall.sh` (manifest 기반 가역).
