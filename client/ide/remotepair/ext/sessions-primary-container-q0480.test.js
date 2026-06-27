const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const extension = fs.readFileSync(path.join(root, "extension.js"), "utf8");
const patch = fs.readFileSync(
  path.join(root, "../patches/zz-remotepair-ide-frontend.patch"),
  "utf8",
);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS ${name} - Sessions is the primary container`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name} - ${error.message.split("\n")[0]}`);
  }
}

test("§1.8 Q0480 routes startup and session creation through Sessions first", () => {
  assert.match(
    extension,
    /vscode\.commands\.executeCommand\("remotepair\.terminalSidebar"\)/,
    "activation must force the Sessions sidebar as the primary sidebar container",
  );
  assert.match(
    extension,
    /vscode\.commands\.executeCommand\("remotepair\.sessions\.attached\.view\.focus"/,
    "activation must force the Session Manager Attached tab open for session status",
  );
  assert.match(
    patch,
    /export const REMOTEPAIR_TERMINAL_SIDEBAR_ID = 'remotepair\.terminalSidebar'/,
    "frontend patch must define the Sessions sidebar container id",
  );
  assert.match(
    patch,
    /name:\s*localize2\('remotepairTerminalSidebarView', "Sessions"\)/,
    "the primary sidebar view must be user-facing Sessions",
  );
  assert.match(
    patch,
    /id:\s*'remotepair\.terminalSidebar\.newSession'[\s\S]*?openViewContainer\(BROWSER_VIEWLET_ID, true\)/,
    "New Session must open Browser from the Sessions flow for folder/Add Root selection",
  );
  assert.match(
    patch,
    /id:\s*'remotepair\.terminalSidebar\.openSessionInFolder'[\s\S]*?title:\s*localize2\('remotepairOpenSessionInFolder', "New Session Here"\)/,
    "folder-based session start must be the Browser's New Session Here action",
  );
  assert.match(
    patch,
    /registerSessionTab\(REMOTEPAIR_SESSIONS_ATTACHED_ID,\s*localize2\('remotepairAttached', "Attached"\)/,
    "Session Manager must expose Attached",
  );
  assert.match(
    patch,
    /registerSessionTab\(REMOTEPAIR_SESSIONS_DETACHED_ID,\s*localize2\('remotepairDetached', "Detached"\)/,
    "Session Manager must expose Detached",
  );
  assert.match(
    patch,
    /registerSessionTab\(REMOTEPAIR_SESSIONS_HISTORY_ID,\s*localize2\('remotepairHistory', "History"\)/,
    "Session Manager must expose History",
  );
});

console.log(`REDGREEN ${passed} ${failed}`);
process.exit(failed ? 1 : 0);
