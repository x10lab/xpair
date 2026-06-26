const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const main = fs.readFileSync(path.join(root, "onboarding-main.cjs"), "utf8");
const preload = fs.readFileSync(path.join(root, "onboarding-preload.cjs"), "utf8");
const app = fs.readFileSync(path.join(root, "onboarding-webview/src/App.tsx"), "utf8");
const electronMainPatch = fs.readFileSync(
  path.join(root, "../patches/zz-remotepair-ide-electron-main.patch"),
  "utf8",
);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS ${name} - client onboarding controls workbench entry`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name} - ${error.message.split("\n")[0]}`);
  }
}

function stripLineComments(source) {
  return source
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

test("Q0369 client onboarding appears before the IDE workbench and only completion opens it", () => {
  assert.match(electronMainPatch, /private async openFirstWindow/);
  assert.match(electronMainPatch, /typeof ob\.resolveOnboarding === 'function'/);
  assert.match(electronMainPatch, /const handled = await ob\.resolveOnboarding\(/);
  assert.match(electronMainPatch, /return \[\];/);
  assert.match(electronMainPatch, /onComplete: \(\) => \{ this\.doOpenFirstWindow\(accessor, initialProtocolUrls\); \}/);

  assert.match(main, /new BrowserWindow\(\{/);
  assert.match(main, /loadFile\(WEBVIEW_INDEX, \{ query: \{ startStep: normalizedStartStep, engine: configuredEngine\(\) \} \}\)/);
  assert.doesNotMatch(main, /\bapp\.quit\(/, "IDE-hosted onboarding must not use the old second-app quit/relaunch flow");
  assert.match(preload, /complete: \(\) => \{[\s\S]*ipcRenderer\.invoke\('onboarding:complete'\)/);

  assert.match(app, /new URLSearchParams\(window\.location\.search\)\.get\("startStep"\)/);
  assert.match(app, /const w = useWizard\(9, initialStep\)/);
  assert.match(app, /autoCheck=\{initialStep === S\.CONNECT\}/);
  assert.match(app, /<StepDiscover onSelect=\{onSelectPeer\} onManual=\{onManual\} \/>/);
  assert.match(app, /const onManual = useCallback/);
  assert.match(app, /<StepConnect[\s\S]*state=\{connState\}[\s\S]*setState=\{setConnState\}/);
  assert.match(app, /<Button size="sm" onClick=\{\(\) => window\.remotepair\.complete\(\)\}>/);

  const uncommented = stripLineComments(main);
  assert.doesNotMatch(
    uncommented,
    /_win\.on\('closed'[\s\S]*!_completed[\s\S]*onComplete\(\)/,
    "Closing onboarding without completing setup must not open the workbench",
  );
});

console.log(`REDGREEN ${passed} ${failed}`);
process.exit(failed ? 1 : 0);
