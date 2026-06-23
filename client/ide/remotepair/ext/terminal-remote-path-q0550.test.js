const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const patch = fs.readFileSync(path.join(__dirname, "../patches/zz-remotepair-ide-frontend.patch"), "utf8");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS ${name} - terminal input stays on the active remote session path`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name} - ${error.message.split("\n")[0]}`);
  }
}

function assertOrdered(source, first, second, message) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  assert.notEqual(firstIndex, -1, `${message}: missing ${first}`);
  assert.notEqual(secondIndex, -1, `${message}: missing ${second}`);
  assert.ok(firstIndex < secondIndex, message);
}

// §1.8 Q0550: terminal interaction over the remote path must not regress below
// iTerm: cmd+v/multiline paste must enter the active remote terminal session,
// cmd+c must copy terminal selection, and the session close control must work.
test("Q0550 cmd+v multiline paste is delivered to the existing active terminal", () => {
  assert.match(patch, /import \{ getWindow, scheduleAtNextAnimationFrame, addDisposableListener, EventType \}/);
  assert.match(patch, /IClipboardService/);
  assert.match(patch, /container, EventType\.KEY_DOWN, \(e\) => this\.handleTerminalShortcut\(e as KeyboardEvent\)/);
  assert.match(patch, /private handleTerminalShortcut\(e: KeyboardEvent\): void/);
  assert.match(patch, /if \(!e\.metaKey \|\| e\.ctrlKey \|\| e\.altKey \|\| e\.shiftKey\)/);
  assert.match(patch, /const instance = this\.activeTerminalInstance\(\);/);
  assert.match(patch, /if \(key === 'v'\) \{/);
  assert.match(patch, /this\.clipboardService\.readText\(\)\.then\(text => \{/);
  assert.match(patch, /if \(this\.activeTerminalInstance\(\) === instance\) \{/);
  assert.match(patch, /instance\.sendText\(text, false, true\);/);
  assertOrdered(
    patch,
    "this.clipboardService.readText().then(text => {",
    "instance.sendText(text, false, true);",
    "clipboard paste must be read before bracketed/multiline sendText",
  );
});

test("Q0550 cmd+c and close controls remain usable on remote terminal sessions", () => {
  assert.match(patch, /if \(key === 'c'\) \{/);
  assert.match(patch, /instance\.hasSelection\(\)/);
  assert.match(patch, /instance\.(?:xterm\?\.)?copySelection\(\)/);
  assert.match(patch, /addDisposableListener\(close, EventType\.MOUSE_DOWN, \(e\) => \{/);
  assert.match(patch, /e\.preventDefault\(\);\n\+\s*e\.stopPropagation\(\);/);
  assert.match(patch, /addDisposableListener\(close, EventType\.CLICK, \(e\) => \{/);
  assert.match(patch, /addDisposableListener\(close, EventType\.KEY_DOWN, \(e\) => \{/);
  assert.match(patch, /KeyCode\.Enter/);
  assert.match(patch, /KeyCode\.Space/);
});

console.log(`REDGREEN ${passed} ${failed}`);
process.exit(failed ? 1 : 0);
