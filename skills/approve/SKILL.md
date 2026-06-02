---
name: approve
description: macOS 승인/권한 다이얼로그(1Password 잠금해제, TCC "허용/확인" 권한 프롬프트, 키체인 등)에 막혀 작업이 진행되지 않을 때 사용. claude 가 직접 클릭하지 않고, 화면 권한(Accessibility)을 가진 RemotePair 앱에 클릭을 요청한다.
---

# approve — RemotePair 에 다이얼로그 클릭 요청

## 언제 쓰나
- 명령/작업이 macOS 승인 다이얼로그에 막혔을 때: 1Password unlock, "허용/확인" 권한 프롬프트, 키체인 접근 등.
- **claude 는 그 버튼을 직접 누를 수 없다**: osascript/System Events 로 클릭하려면 Automation 권한 신원이
  claude/osascript 라 차단된다. 반드시 **granted 신원(RemotePair)** 이 눌러야 한다.

## 방법 (요청만 한다)
```bash
touch /tmp/remote-pair.approve-request
```
RemotePair(메뉴바 앱, Accessibility+화면기록 granted)가 이를 감지해 **약 10초간** `~/.claude/auto-approve/rules.txt`
에 정의된 대상 앱들의 창을 스캔하여 매칭되는 버튼(확인/허용/Unlock 등)을 클릭한다.

## 확인 / 재시도
- 클릭 로그: `~/.claude/logs/remote-pair.log`  (`clicked [proc] label` 또는 `coord [...]`).
- 안 사라지면(늦게 떴거나 라벨 미등록): 다시 `touch` 하거나 rules.txt 에 규칙 추가 —
  `프로세스명<TAB>ax<TAB>버튼라벨1|버튼라벨2`  (`#` 주석. 저장 즉시 반영, 재빌드 불필요).
- RemotePair 가 안 떠 있으면: `~/Applications/RemotePair.app` 실행 + grant 확인.

## 주의
- 이 스킬은 **요청**만 한다 — 실제 클릭은 RemotePair 가 수행(권한 분리가 핵심).
- rules.txt 에 등록된 다이얼로그만 눌린다(무차별 클릭 방지 — 의도된 설계). 필요한 것만 등록할 것.
- 상시 폴링이 아니라 요청받은 10초 동안만 AX 스캔하므로, 1Password 같은 느린 AX 트리로 인한 상시 지연(-1712)이 없다.
