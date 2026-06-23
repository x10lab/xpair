const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const patch = fs.readFileSync(
  path.join(root, "../patches/zz-remotepair-ide-frontend.patch"),
  "utf8",
);
const cli = fs.readFileSync(path.join(root, "../../../cli/xpair"), "utf8");

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   - ${name}`);
  } catch (error) {
    failed++;
    console.error(`  FAIL - ${name}`);
    console.error(`         ${error.message.split("\n")[0]}`);
  }
}

test("remote terminal copy/paste/close stay on the attached tmux path (Q0550/Q0551)", () => {
  assert.match(patch, /private handleTerminalShortcut\(e: KeyboardEvent\): void/);
  assert.match(patch, /if \(key === 'c'\)[\s\S]*instance\.hasSelection\(\)[\s\S]*instance\.(?:xterm\?\.)?copySelection\(\)/);
  assert.match(patch, /if \(key === 'v'\)[\s\S]*this\.clipboardService\.readText\(\)[\s\S]*instance\.sendText\(text, false, true\)/);
  assert.match(patch, /close\.tabIndex = 0[\s\S]*EventType\.MOUSE_DOWN[\s\S]*e\.stopPropagation\(\);[\s\S]*EventType\.CLICK[\s\S]*onClose\(\);/);
  assert.match(patch, /close: \(id\) => \{[\s\S]*v\.instance\.dispose\(\);/);

  assert.match(cli, /cmd_attach\(\)[\s\S]*has-session[\s\S]*attach -d -t/);
  assert.doesNotMatch(
    cli.match(/cmd_attach\(\)[\s\S]*?\n\}/)?.[0] || "",
    /kill-session|new-session/,
    "attach/close path must not remove or create a host tmux session",
  );
});

if (failed > 0) {
  console.error(`\n${failed} test(s) FAILED`);
  process.exit(1);
}

console.log("\nall Q0550/Q0551 terminal remote-path tests passed");
