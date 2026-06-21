---
name: approve
description: Use when work is blocked by a macOS approval/permission dialog (1Password SSH approval/unlock, the Claude-for-Chrome permission window, system confirmation dialogs, etc.). Claude does not click anything itself; it only asks the Xpair app — which holds the permissions — to "allow it." Xpair detects and routes which window to allow and how.
---

# approve — get past a blocked approval dialog (request it from Xpair)

When work is blocked by a macOS approval/permission dialog, all you need is **a one-line request**:

```bash
xpair approve                       # trigger + collect result (exit 0=handled, 1=failed). Requires PATH(~/.local/bin).
xpair approve --for "1Password"     # hint about which approval window (recommended). Aliases are lenient (e.g. Chrome/Google Chrome → Claude for Chrome)
xpair approve --for "Claude for Chrome" --type "key:cmd+return|return"   # ★ specify directly how to approve
```
**Use `--type` to decide directly "how to approve" (recommended).** Look at the screen (you're already watching it via computer-use), judge how to get that window through, and pass it; the router runs it **exactly as given** (not locked into fixed rules, and it even handles short-burst multiple retries on its own):
- `--type "key:cmd+return|return"` → send keys (sequential candidates). Enter / Mac Command+Enter, etc.
- `--type "key:return"` → a single key.
- `--type "ocr:Allow this action"` → find that button text and click it (for windows where keys don't work).

**What to choose — just follow the approval shortcut/button visible on that window (you're already watching the screen via computer-use):**
- ⏎(Return) next to the "Allow…" button → `--type "key:return"`   ·   ⌘⏎(Cmd+Return) → `--type "key:cmd+return"`
- **For the Claude for Chrome permission modal, `--type "key:cmd+return|return"` is recommended** — **try Cmd+Return first because it means "Always allow" (won't ask again)**, breaking the popup that otherwise repeats on every action. If the modal doesn't accept Cmd+Return, it **automatically falls back to Return (allow once)** (the router tries the candidate keys in sequence). So first = stop the repeats, second = guarantee compatibility.
- A window with no shortcut shown or where keys don't work → `--type "ocr:<that button text>"` (e.g. `ocr:Allow this action`)
- ⚠️ Verification is based only on "did the window close" → **even if a wrong key clicks Decline and the window closes, it looks like success**. So use `key:` **only when** the Allow shortcut is certain. If unsure, the button text `ocr:` is safer (it presses only the Allow button precisely).

`--for "<what>"` is a supplementary hint (optional, aliases lenient: browser name→Claude for Chrome). If `--type` is present it takes priority; if absent it falls back to the default method of the `--for` rule.
Fallback (action without hint): `~/.xpair/host/bin/approve` or `touch /tmp/xpair.approve-request`.

That's all. From there **Xpair** (the menu bar app, with Screen Recording + Accessibility granted) takes care of it:
- Looks at the screen (OCR) and detects **which approval window** appeared
- **Routes to the action** matching that window — 1Password→click `Authorize`, Claude-for-Chrome→`Return` (Enter), generic window→its button/key
- Even if the dialog appears late, right after the trigger, it retries for a few seconds

## Order matters: trigger first, window second

The router **polls adaptively for ~18s by default after the trigger** (`RP_WAIT_SECS`), waiting for the approval window — it catches the window even if the agent raises it a few seconds *after* triggering. After clicking/keying, it **recaptures and verifies "whether the window closed"**, and retries if it didn't. The result is clear: exit 0 (success, verified) / 1 (failed to handle within the time limit).

Detection is **hybrid**: OCR rules (marker text) first → on a miss, **haiku classifies only "which known approval window this is"** (coordinates are OCR's job; haiku is routing-only). For a window not in the rules, it falls back to a generic approval label (Allow/허용/승인/확인…). haiku is a best-effort call via the subscription claude CLI — if it's missing or slow, it works with OCR rules alone (can be turned off with `RP_VISION=off`).

- **When the approval window is already up** (1Password etc. is blocking another process): just use `xpair approve` (blocking, exit 0=clicked 1=timeout) as is.
- **When the tool call has already failed with Permission denied**: the window is already gone. Running approve alone ends with "no known dialog up". You must go in this order: **non-blocking fallback (`~/.xpair/host/bin/approve` or trigger touch) → immediately (within 7s) retry the failed call**. If the retry raises the window again, the router that was polling clicks it. If you use the blocking wrapper, you can't raise the window while waiting for approve to finish, so it times out.

**Your (claude's) only job is the trigger.** Never do the "how" — clicking/keys/coordinates — yourself:
- computer-use is by default **blocked** on permission/approval windows, and
- direct osascript/System Events clicks are blocked because the identity (Automation) doesn't match, and 1Password doesn't expose its window to Accessibility.
→ So **only the permission-holding Xpair** can click, and the method is centrally managed by Xpair via rules.

## Read the result and act (judge from the log even on failure)

`xpair approve` **prints the router log for this specific request as is** and reports the result via exit code.
Even on failure, "why" is left in the log, so you (the agent) just read it and decide the next action:

- **exit 0** = `router: success [id] (verified: dialog closed)` — passed. Continue the blocked work.
- **exit 1** = branch based on the printed router log:
  - `no dialog handled within …s` → the window is (not yet) there. **Re-trigger non-blocking, then immediately retry the blocked call** (if the window appears then, the polling router catches it).
  - `[id] button not found (labels=...)` → the window is right but the button label differs from the rule → correct the action label in rules.txt.
  - `vision → UNKNOWN` or `[id] clicked but close unconfirmed` → an unknown/unusual window. Add a rule to rules.txt, or if that doesn't work, report to the user.
  - `vision claude rc=…` / `claude CLI missing → vision disabled (OCR rules only)` → vision alone failed (harmless). Working on OCR rules — check whether that window is in the rules.
- Full log: `~/.xpair/host/logs/xpair.log`.

Key point: **Don't struggle to "recover" from a failure yourself; read the log and pick one of (re-trigger / add rule / report to user).** Never click/coordinate yourself.

## When approve reports "success" but the work keeps failing (★ avoiding false positives)

approve's `success` means **the window closed**, not a guarantee that it was **allowed** (the window also closes if a wrong key pressed Decline).
Even if the work stays blocked, **don't conclude "the host died" — confirm the actual state as fact first**:

```bash
xpair status   # app alive (launchctl) + AX/SR/FDA grant (app status.json). Ground truth, not a guess.
```
- `app NOT running` & `host server down` → the app really isn't running → launch the app on the host / `xpair host`.
  ⚠ The menu bar app **runs even without permissions.** It's not dead just because `pgrep` "doesn't see it" (status judges via launchctl).
- `app running` but `AX ✗` or `SR ✗` → **launched but not granted.** Even when approve clicks, the synthetic input
  doesn't take, so it can look "closed" → turn on Accessibility/Screen Recording in System Settings (this is not "host down").
- Failing even with `AX ✓ SR ✓` → **not a Xpair problem.** It's one of two things:
  - The click pressed the **wrong button** (Decline etc.) → specify precisely with `--type "ocr:<Allow button text>"`.
  - **A block outside Xpair** — the browser extension's per-domain permission, an org policy (e.g. "Service Not Allowed"), the network. approve can't fix it (user/admin territory).

## Adding a new approval window (rules.txt)
`~/.xpair/host/rules.txt`, one tab-separated line = one window:  `id <TAB> detection-marker <TAB> action`
- detection-marker = a unique phrase that appears only in that window (OCR partial match).
- action = `ocr:Allow|허용|OK` (find the button text and click it) or `key:return` (send keys, `cmd+return`·`esc` etc.).
- e.g.: `MyApp<TAB>Grant access?<TAB>ocr:Allow|허용`  /  `Some Dialog<TAB>Confirm action<TAB>key:return`
