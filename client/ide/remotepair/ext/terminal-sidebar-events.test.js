const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const patch = fs.readFileSync(path.join(__dirname, "../patches/zz-remotepair-ide-frontend.patch"), "utf8");

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL - ${name}\n        ${error && error.message ? error.message : error}`);
  }
}

check("session card close shields mousedown before parent card click", () => {
  assert.match(patch, /close\.tabIndex = 0/);
  assert.match(patch, /addDisposableListener\(close, EventType\.MOUSE_DOWN, \(e\) => \{/);
  assert.match(patch, /e\.preventDefault\(\);\n\+\s*e\.stopPropagation\(\);/);
});

check("session card close is click and keyboard accessible", () => {
  assert.match(patch, /addDisposableListener\(close, EventType\.CLICK, \(e\) => \{/);
  assert.match(patch, /addDisposableListener\(close, EventType\.KEY_DOWN, \(e\) => \{/);
  assert.match(patch, /KeyCode\.Enter/);
  assert.match(patch, /KeyCode\.Space/);
});

check("embedded terminal sidebar imports clipboard and DOM event helpers", () => {
  assert.match(patch, /import \{ getWindow, scheduleAtNextAnimationFrame, addDisposableListener, EventType \}/);
  assert.match(patch, /IClipboardService/);
});

check("embedded terminal sidebar handles local macOS copy and paste", () => {
  assert.match(patch, /private handleTerminalShortcut\(e: KeyboardEvent\): void/);
  assert.match(patch, /e\.metaKey/);
  assert.match(patch, /instance\.hasSelection\(\)/);
  assert.match(patch, /instance\.(?:xterm\?\.)?copySelection\(\)/);
  assert.match(patch, /this\.clipboardService\.readText\(\)/);
  assert.match(patch, /instance\.sendText\(text, false, true\)/);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
}

console.log("\nall terminal sidebar event tests passed");
