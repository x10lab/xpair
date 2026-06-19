# Input Injection — Critical Findings (2026-06-15, verified by real-app readback)

## TL;DR
**CGEvent keyboard injection (rp-input-inject) fails to deliver text to real Cocoa apps.**
The earlier verifications (rp-input-selftest / rp-input-pipetest) only confirmed that **CGEventTap *captures* the event**;
they never verified whether the app actually *inserts* it (evaluator blind spot). Verifying with a real-app (NSTextView) readback shows it does not actually go in.

## Verification (RPTarget.app = NSTextView window, isKey/isActive/firstResponder diagnostics + content readback)
| Injection method | Window state | NSTextView received |
|---|---|---|
| rp-input-inject CGEvent unicode(Hangul "annyeong") | isKey=true active=true fr=true | **[] empty** |
| rp-input-inject CGEvent cmd+V(keycode9+cmd) | key=true | **[] empty** |
| System Events `keystroke "<Hangul 'annyeonghaseyo'> rp"` | key=true | **[5 garbled Hangul glyphs + " rp"]** — reaches it, but Hangul is garbled |
| System Events cmd+V(clipboard=Hangul) | key=true | [] (paste did not fire / race, inconclusive) |

→ **CGEvent does NOT deliver keyboard input to the app. System Events (the Accessibility path) DOES deliver it.**
This is exactly why the existing `host/XpairHost/InputServer.swift` uses osascript System Events for key input
(comment: synthetic CGEvent keys don't work in some web UIs — in reality the scope is much broader).

## Fix Direction (next)
- Switch host injection from **CGEvent → Accessibility/System Events based** (mouse may still work via CGEvent,
  keyboard via AX/System Events).
- **Hangul**: since keystroke garbles syllables, use **clipboard + cmd+V** (preserves exact Unicode) or
  **AXUIElement text insert** (setting `kAXSelectedTextAttribute`). The cmd+V paste path needs to be
  re-verified against RPTarget (it did not fire on this one run).
- **Replace the evaluator**: tap capture (false pass) → **RPTarget real-app readback** (rp-input-target.swift) as the standard
  evaluator. Update the evaluator of the autoresearch native-input-injection mission to use this.

## Verified Portions (still valid)
The transport chain (client IME capture → DataChannel → host stdin), coordinates, throttle, and seq remain valid as-is.
The only thing that changes is the **injection backend** after stdin (the JSON wire contract is unchanged).

## Additional Confirmations (2nd verification)
- rp-input-inject `AXIsProcessTrusted=true` — **even though trusted**, CGEvent does not reach. Not a permissions problem.
- CGEvent with **plain keycodes** (code 0/1/2, no modifier) also yields an empty NSTextView → so it's not just the unicode path;
  **CGEvent keyboard delivery itself does not reach NSTextView** (reason unknown, but consistently reproducible).
- clipboard+cmd+V paste: added an Edit menu to RPTarget, but it did not fire in the harness (timing/focus flaky) —
  needs re-verification in a real app (one that has an Edit menu). System Events keystroke delivery is confirmed.
- Conclusion unchanged: keyboard injection backend = **System Events/AX**. Hangul = clipboard paste or AX insert (verify in a real app).

## Resolution (3rd — AX text insert is the answer)
**`AXUIElementSetAttributeValue(focusedElement, kAXSelectedTextAttribute, text)` puts Hangul
into NSTextView exactly.** Proof: RPTarget self-insert → `TARGET_GOT:[<Hangul 'annyeonghaseyo'> AX 123]
rc=0`. Unlike CGEvent (does not reach) and System Events (garbles Hangul), this achieves **exact Unicode landing**.

→ Replaced `injectText` in `rp-input-inject.swift` with AX insert (implementation done).

**Two preconditions (naturally met on a real host, only unmet in automated tests):**
1. The injection binary must be **AX-trusted** — same-process AX needs no trust, but cross-process does.
   It's inherited from the parent process (iTerm trusted → helper trusted; if an untrusted app spawns it, it's untrusted). Production
   grants the helper Accessibility (like the existing InputServer/XpairHost).
2. The **target must genuinely be frontmost-active** — system-wide kAXFocusedUIElement returns the focused
   element of whichever app is active at that moment. On a real host this is met because the app the user is using is active. Automated tests
   cannot make a throwaway window active (the agent/terminal steals frontmost), so cross-process is unverified.

**Remaining verification (real host / 2 machines):** granted helper + an actually-focused app (TextEdit/browser) AX insert →
Hangul landing. The mechanism is proven via same-process. Shortcuts (cmd+s, etc.) are separate — since CGEvent does not reach,
they need the System Events keystroke (modifier) path. Mouse is a separate CGEvent verification.

## ✅ CROSS-PROCESS Confirmed (4th — final)
Using PID-targeted AX (`AXUIElementCreateApplication(pid)` → AXTextArea → set kAXValue) to bypass the frontmost-active
dependency, cross-process AX injection is proven:
```
ProcessA (rp-ax-pid): target RPTarget pid → found AXTextArea → set "<Hangul 'annyeonghaseyo'> cross <Hangul 'ipryeok'> OK" rc=0
ProcessB (rp-ax-read): readback of the same textarea → READBACK:[<Hangul 'annyeonghaseyo'> cross <Hangul 'ipryeok'> OK]
```
→ Confirmed by independent readback that **a separate process can cross-process AX insert Hangul into a real NSTextView exactly**.
Decisively different from CGEvent (does not reach) and System Events (garbles Hangul).

**Production injectText**: system-wide-focused AX (targeting the app the user has focused *right now*) is correct —
on a real host it works because that app is active. PID targeting is for proving the mechanism. The helper needs an Accessibility grant.
Harness: rp-ax-pid.swift (injection), rp-ax-read.swift (verification), rp-input-target.swift (NSTextView sink).

## ✅✅ Live Full-Chain Working (5th — final, integrated end-to-end)
The browser → IME capture → DataChannel → serve-webrtc → rp-input-inject stdin → AX insert → real NSTextView path
was **run integrated in one shot**, and Hangul landing is confirmed:
```
playwright fireKorean("<Hangul 'annyeonghaseyo'> <Hangul 'live full-chain'> OK")
 → rp-input-e2e.html compositionend → DataChannel rp-ctl {t:x,s:...}
 → serve-webrtc on_message → helper stdin (log: RPIN seq=1 t=x)
 → rp-input-inject injectText (AX, RP_INPUT_TARGET_PID)
 → RPTarget NSTextView
result: TARGET_GOT:[<Hangul 'annyeonghaseyo'> <Hangul 'live full-chain'> OK]  + independent rp-ax-read READBACK identical
```
RP_INPUT_TARGET_PID is test-only (a workaround for the automation environment not being able to make a throwaway window
frontmost-active, so system-wide-focused isn't caught). **Production uses system-wide-focused AX** (targeting the user's focused
app) — the same AX mechanism; on a real host it works because that app is active. The helper needs an Accessibility grant.

Remaining wiring: shortcuts = System Events keystroke+modifier, mouse = CGEvent landing verification (separate from text).
