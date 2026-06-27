const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const patch = fs.readFileSync(
  path.join(root, "..", "patches", "zz-remotepair-ide-frontend.patch"),
  "utf8",
);

function addedFileSection(fileName) {
  const marker = `diff --git a/${fileName} b/${fileName}`;
  const start = patch.indexOf(marker);
  assert.notEqual(start, -1, `missing patch section for ${fileName}`);
  const next = patch.indexOf("\ndiff --git ", start + marker.length);
  return patch.slice(start, next === -1 ? patch.length : next);
}

const sessionManager = addedFileSection(
  "src/vs/workbench/contrib/terminal/browser/remotePairSessionManager.ts",
);
const terminalSidebar = addedFileSection(
  "src/vs/workbench/contrib/terminal/browser/remotePairTerminalSidebar.ts",
);

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(`         ${error.message.split("\n")[0]}`);
  }
}

test("terminal tabs restore saved sessions after client relaunch (Q0546/Q0547)", () => {
  assert.match(
    terminalSidebar,
    /private launchReattach\(name: string\): void[\s\S]*xpair attach/,
    "restore must reuse the real reattach path that opens a terminal and runs xpair attach",
  );
  assert.match(
    sessionManager,
    /HISTORY_STORAGE_KEY[\s\S]*StorageScope\.WORKSPACE/,
    "terminal/session state must be persisted across workbench launches",
  );
  assert.doesNotMatch(
    sessionManager,
    /display-only rather than wiring a reattach/,
    "persisted sessions are currently display-only, so closed/reopened terminal tabs cannot restore",
  );
  assert.match(
    sessionManager,
    /const persisted = this\.readHistory\(\);[\s\S]*for \(const name of persisted\)[\s\S]*this\.addCard\(name, \(\) => reattach\(name\)\)/,
    "saved terminal/session entries must reattach to the same tmux session, not come back as inert history",
  );
});

console.log(failed ? `\n${failed} test(s) failed` : "\nall terminal restore tests passed");
process.exit(failed ? 1 : 0);
