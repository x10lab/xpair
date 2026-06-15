# 입력 주입 — 중대 발견 (2026-06-15, 실앱 readback 검증)

## TL;DR
**CGEvent 키보드 주입(rp-input-inject)이 실제 Cocoa 앱에 텍스트를 전달하지 못한다.**
이전 검증(rp-input-selftest / rp-input-pipetest)은 **CGEventTap이 이벤트를 *캡쳐*** 하는 것만
확인했을 뿐, 앱이 *insert* 하는지는 검증하지 못했다(평가자 맹점). 실앱(NSTextView) readback으로
검증하니 실제로는 안 들어간다.

## 검증 (RPTarget.app = NSTextView 창, isKey/isActive/firstResponder 진단 + 내용 readback)
| 주입 방법 | 창 상태 | NSTextView 수신 |
|---|---|---|
| rp-input-inject CGEvent unicode("안녕") | isKey=true active=true fr=true | **[] 빈 값** |
| rp-input-inject CGEvent cmd+V(keycode9+cmd) | key=true | **[] 빈 값** |
| System Events `keystroke "안녕하세요 rp"` | key=true | **[ㅁㅁㅁㅁㅁ rp]** — 닿지만 한글 깨짐 |
| System Events cmd+V(클립보드=한글) | key=true | [] (paste 미발화/레이스, 미확정) |

→ **CGEvent는 앱에 키보드 전달 X. System Events(Accessibility 경로)는 전달 O.**
기존 `host/RemotePairHost/InputServer.swift`가 키 입력에 osascript System Events를 쓴 이유가
바로 이것(코멘트: 합성 CGEvent 키가 일부 웹UI에 안 먹힘 — 실제론 더 광범위).

## 수정 방향 (다음)
- 호스트 주입을 **CGEvent → Accessibility/System Events 기반**으로 전환(마우스는 CGEvent 가능성,
  키보드는 AX/System Events).
- **한글**: keystroke가 음절을 깨뜨리므로 **클립보드 + cmd+V**(정확 Unicode 보존) 또는
  **AXUIElement 텍스트 insert**(`kAXSelectedTextAttribute` 설정)로. cmd+V paste 경로를 RPTarget로
  재검증 필요(이번 1회는 미발화).
- **평가자 교체**: tap 캡쳐(거짓 pass) → **RPTarget 실앱 readback**(rp-input-target.swift)을 표준
  평가자로. autoresearch native-input-injection 미션의 evaluator를 이걸로 갱신.

## 검증된 부분(유효)
전송 체인(클라 IME캡쳐→DataChannel→호스트 stdin)·좌표·throttle·seq는 그대로 유효.
바뀌는 건 stdin 이후 **주입 백엔드**뿐(JSON 와이어 계약 불변).

## 추가 확정 (2차 검증)
- rp-input-inject `AXIsProcessTrusted=true` — **신뢰됨인데도** CGEvent 미도달. 권한 문제 아님.
- CGEvent **평범한 keycode**(code 0/1/2, modifier 없음)도 NSTextView 빈 값 → unicode경로만이 아니라
  **CGEvent 키보드 전달 자체가 NSTextView에 안 됨**(이유 불명이나 재현 일관).
- 클립보드+cmd+V paste: RPTarget에 Edit메뉴 추가했으나 하네스에서 미발화(타이밍/포커스 플레이키) —
  실앱(Edit메뉴 보유)에서 재검증 필요. System Events keystroke 도달은 확정.
- 결론 불변: 키보드 주입 백엔드 = **System Events/AX**. 한글 = 클립보드 paste 또는 AX insert(실앱 검증).

## 해결 (3차 — AX 텍스트 insert가 정답)
**`AXUIElementSetAttributeValue(focusedElement, kAXSelectedTextAttribute, text)`가 한글을
정확히 NSTextView에 넣는다.** 실증: RPTarget self-insert → `TARGET_GOT:[안녕하세요 AX 123]
rc=0`. CGEvent(미도달)·System Events(한글깨짐)와 달리 **정확 Unicode landing**.

→ `rp-input-inject.swift`의 `injectText`를 AX insert로 교체함(구현 완료).

**전제 2가지(실호스트는 자연 충족, 자동화 테스트만 미충족):**
1. 주입 바이너리가 **AX-trusted** — same-process AX는 신뢰 불요지만 cross-process는 필요.
   부모 프로세스에서 상속(iTerm 신뢰→helper 신뢰; 미신뢰 앱이 spawn하면 미신뢰). 프로덕션은
   헬퍼를 Accessibility grant(기존 InputServer/RemotePairHost처럼).
2. **타깃이 진짜 frontmost-active** — system-wide kAXFocusedUIElement는 그 순간 active 앱의
   포커스 요소를 줌. 실호스트는 사용자가 쓰는 앱이 active라 충족. 자동화 테스트는 throwaway
   창을 active로 못 만들어(에이전트/터미널이 frontmost 뺏음) cross-process 미검증.

**남은 검증(실호스트/2대):** granted 헬퍼 + 실제 포커스된 앱(TextEdit/브라우저)에 AX insert →
한글 landing. 메커니즘은 same-process로 증명됨. 단축키(cmd+s 등)는 별도 — CGEvent 미도달이라
System Events keystroke(modifier) 경로 필요. 마우스는 CGEvent 검증 별도.

## ✅ CROSS-PROCESS 확정 (4차 — 최종)
PID-타겟 AX(`AXUIElementCreateApplication(pid)`→AXTextArea→set kAXValue)로 frontmost-active
의존을 우회해 cross-process AX 주입을 증명:
```
프로세스A(rp-ax-pid): RPTarget pid 타겟 → AXTextArea 찾음 → set "안녕하세요 cross 입력 OK" rc=0
프로세스B(rp-ax-read): 같은 textarea readback → READBACK:[안녕하세요 cross 입력 OK]
```
→ **별도 프로세스가 실제 NSTextView에 한글을 정확히 cross-process AX insert**함을 독립 readback으로
확정. CGEvent(미도달)·System Events(한글깨짐)와 결정적으로 다름.

**프로덕션 injectText**: system-wide-focused AX(사용자가 *지금 포커스한* 앱 타겟)가 맞음 —
실호스트는 그 앱이 active라 동작. PID 타겟은 메커니즘 증명용. 헬퍼는 Accessibility grant 필요.
하네스: rp-ax-pid.swift(주입), rp-ax-read.swift(검증), rp-input-target.swift(NSTextView sink).

## ✅✅ 라이브 풀체인 동작 (5차 — 최종, integrated end-to-end)
브라우저→IME캡쳐→DataChannel→serve-webrtc→rp-input-inject stdin→AX insert→실 NSTextView
를 **한 번에 통합 실행**, 한글 landing 확정:
```
playwright fireKorean("안녕하세요 라이브풀체인 OK")
 → rp-input-e2e.html compositionend → DataChannel rp-ctl {t:x,s:...}
 → serve-webrtc on_message → 헬퍼 stdin (log: RPIN seq=1 t=x)
 → rp-input-inject injectText (AX, RP_INPUT_TARGET_PID)
 → RPTarget NSTextView
결과: TARGET_GOT:[안녕하세요 라이브풀체인 OK]  + 독립 rp-ax-read READBACK 동일
```
RP_INPUT_TARGET_PID는 test-only(자동화 환경이 throwaway 창을 frontmost-active로 못 만들어
system-wide-focused가 안 잡히는 것 우회). **프로덕션은 system-wide-focused AX**(사용자 포커스
앱 타겟) — 같은 AX 메커니즘, 실호스트는 그 앱이 active라 동작. 헬퍼 Accessibility grant 필요.

남은 배선: 단축키=System Events keystroke+modifier, 마우스=CGEvent landing 검증(텍스트와 별개).
