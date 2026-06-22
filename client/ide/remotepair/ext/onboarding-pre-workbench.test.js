const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const onboardingMain = fs.readFileSync(path.join(root, "onboarding-main.cjs"), "utf8");
const onboardingPreload = fs.readFileSync(path.join(root, "onboarding-preload.cjs"), "utf8");
const extension = fs.readFileSync(path.join(root, "extension.js"), "utf8");

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

test("Q0369 Q0421 Q0424 Q0426 onboarding is a consumed-sentinel pre-workbench BrowserWindow", () => {
  assert.match(onboardingMain, /PRE-WORKBENCH BrowserWindow INSTEAD of creating the workbench window/);
  assert.match(onboardingMain, /const FORCE_ONBOARDING_SENTINEL = path\.join\(os\.homedir\(\), '\.xpair\/host', '\.force-onboarding'\)/);
  assert.match(onboardingMain, /function shouldOnboard\(argv = process\.argv\)[\s\S]*forceOnboardingSentinelExists\(\)[\s\S]*return !isOnboarded\(\)/);
  assert.match(onboardingMain, /function openOnboardingWindow\(\{ electron, onComplete \}\)[\s\S]*clearForceOnboardingSentinel\(\)[\s\S]*new BrowserWindow\(/);
  assert.match(onboardingMain, /preload: PRELOAD/);
  assert.match(onboardingMain, /_win\.loadFile\(WEBVIEW_INDEX\)/);
  assert.match(onboardingMain, /ipcMain\.handle\('onboarding:complete'[\s\S]*_completed = true[\s\S]*onComplete\(\)/);
  assert.match(onboardingMain, /module\.exports = \{ isOnboarded, shouldOnboard, openOnboardingWindow \}/);
  assert.doesNotMatch(onboardingMain, /createWebviewPanel/);

  assert.match(onboardingPreload, /ipcRenderer\.invoke\('onboarding:complete'\)/);
  assert.match(extension, /fs\.writeFileSync\(path\.join\(os\.homedir\(\), "\.xpair\/host", "\.force-onboarding"\), ""\)/);
  assert.match(extension, /vscode\.commands\.executeCommand\("workbench\.action\.quit"\)/);
});

console.log(failed ? `\n${failed} test(s) failed` : "\nall Q0369 Q0421 Q0424 Q0426 pre-workbench onboarding tests passed");
process.exit(failed ? 1 : 0);
