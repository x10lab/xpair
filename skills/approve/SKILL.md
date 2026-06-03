---
name: approve
description: macOS 승인/권한 다이얼로그(1Password SSH 승인·잠금, Claude-for-Chrome 권한창, 시스템 확인창 등)에 막혀 작업이 진행되지 않을 때 사용. claude 가 직접 누르지 않고, 권한을 가진 RemotePair 앱에 "허용해줘"를 요청만 한다. 어떤 창을 어떻게 허용할지는 RemotePair 가 감지·라우팅한다.
---

# approve — 막힌 승인창 통과 (RemotePair 에 요청)

작업이 macOS 승인/권한 다이얼로그에 막혔을 때, **요청 한 줄**만 하면 된다:

```bash
remote-pair approve     # 트리거 + 클릭 결과 회수 (exit 0=눌림, 1=타임아웃). PATH(~/.local/bin) 필요.
```
폴백(같은 동작): `~/.claude/bin/approve` 또는 `touch /tmp/remote-pair.approve-request`.

그게 전부다. 이후는 **RemotePair**(메뉴바 앱, 화면기록+손쉬운사용 granted)가 알아서 한다:
- 화면을 보고(OCR) **어떤 승인창**이 떴는지 감지
- 그 창에 맞는 **액션으로 라우팅** — 1Password→`Authorize` 클릭, Claude-for-Chrome→`Cmd+Return`, 일반창→해당 버튼/키
- 트리거 직후 다이얼로그가 늦게 떠도 몇 초간 재시도

**너(claude)가 할 일은 트리거뿐.** 클릭/키/좌표 같은 "방법"은 절대 직접 하지 마라:
- computer-use 는 권한/승인창에 기본적으로 **막혀있고**,
- osascript/System Events 직접 클릭은 신원(Automation)이 안 맞아 막히며 1Password 는 접근성에 창을 안 보여준다.
→ 그래서 **권한 가진 RemotePair 만** 누를 수 있고, 방법은 RemotePair 가 rules 로 중앙 관리한다.

## 확인
- 결과 로그: `~/.claude/logs/remote-pair.log`  (`router: [id] click (x,y)` 또는 `router: [id] key cmd+return`).
- 안 눌렸으면 그 창이 rules 에 없는 것 → 아래로 추가(즉시 반영, 재빌드 불필요).

## 새 승인창 추가 (rules.txt)
`~/.claude/auto-approve/rules.txt`, 탭 구분 한 줄 = 한 창:  `id <TAB> 감지마커 <TAB> action`
- 감지마커 = 그 창에만 나오는 고유 문구(OCR 부분일치).
- action = `ocr:Allow|허용|OK`(버튼 텍스트 찾아 클릭) 또는 `key:return`(키 전송, `cmd+return`·`esc` 등).
- 예: `MyApp<TAB>Grant access?<TAB>ocr:Allow|허용`  /  `Some Dialog<TAB>Confirm action<TAB>key:return`
