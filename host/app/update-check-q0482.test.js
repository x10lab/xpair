const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const appDelegate = fs.readFileSync(path.join(root, "AppDelegate.swift"), "utf8");
const updater = fs.readFileSync(path.join(root, "Updater.swift"), "utf8");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS ${name} - update check routes through the gated app updater`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name} - ${error.message.split("\n")[0]}`);
  }
}

function indexOfOrThrow(source, needle) {
  const index = source.indexOf(needle);
  assert.notEqual(index, -1, `missing ${needle}`);
  return index;
}

// §2 Q0482: "Check for updates..." should verify release availability and
// branch into failure, latest, or consent-gated update/restart.
test("Q0482 menu Check for updates invokes interactive release check", () => {
  assert.match(
    appDelegate,
    /menu\.addItem\(withTitle:\s*"Check for Updates…",\s*action:\s*#selector\(checkUpdates\),\s*keyEquivalent:\s*""\)/,
  );
  assert.match(
    appDelegate,
    /@objc func checkUpdates\(\) \{ Updater\.checkForUpdates\(interactive: true\) \}/,
  );
});

test("Q0482 release check branches to failed/latest/update-apply states", () => {
  assert.match(updater, /static func checkForUpdates\(interactive: Bool\)/);
  assert.match(updater, /fetchLatest \{ result in/);
  assert.match(updater, /case \.failure\(let err\):/);
  assert.match(updater, /if interactive \{ info\("Update check failed", msg\) \}/);
  assert.match(updater, /if isNewer\(rel\.tag, than: APP_VERSION\) \{/);
  assert.match(updater, /promptAndApply\(rel\)/);
  assert.match(updater, /else if interactive \{/);
  assert.match(updater, /info\("Latest version"/);
});

test("Q0482 restart is warned and gated by user consent before relaunch", () => {
  const sessionsIndex = indexOfOrThrow(updater, "let liveCount = Sessions.liveSessionCount()");
  const alertIndex = indexOfOrThrow(updater, "let a = NSAlert()");
  const guardIndex = indexOfOrThrow(updater, "guard a.runModal() == .alertFirstButtonReturn else");
  const relaunchIndex = indexOfOrThrow(updater, "relaunch()");

  assert.ok(sessionsIndex < alertIndex, "live sessions must be counted before prompting");
  assert.ok(alertIndex < guardIndex, "the user must see an update/restart alert before consent is checked");
  assert.ok(guardIndex < relaunchIndex, "relaunch must happen only after consent gate passes");
  assert.match(updater, /You currently have \\?\(liveCount\) tmux-aqua session\(s\) running/);
  assert.match(updater, /interrupt computer-use \(screen control\) and may require re-attach/);
  assert.match(updater, /running claude session may lose its Accessibility inheritance until re-attach/);
});

console.log(`REDGREEN ${passed} ${failed}`);
process.exit(failed ? 1 : 0);
