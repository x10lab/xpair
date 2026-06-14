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
