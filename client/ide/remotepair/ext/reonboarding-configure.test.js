const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const testFile = path.relative(process.cwd(), __filename);
const extRoot = __dirname;
const repoRoot = path.resolve(extRoot, "../../../..");

const extension = fs.readFileSync(path.join(extRoot, "extension.js"), "utf8");
const onboardingMainPath = path.join(extRoot, "onboarding-main.cjs");
const appDelegate = fs.readFileSync(path.join(repoRoot, "host/app/AppDelegate.swift"), "utf8");
const onboardingWindow = fs.readFileSync(path.join(repoRoot, "host/app/OnboardingWindow.swift"), "utf8");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name} - intended behavior is asserted`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name} - ${error && error.message ? error.message.split("\n")[0] : error}`);
  }
}

function withTempHome(fn) {
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "xpair-reonboard-test-"));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  delete require.cache[require.resolve(onboardingMainPath)];
  try {
    return fn(tmpHome, require(onboardingMainPath));
  } finally {
    delete require.cache[require.resolve(onboardingMainPath)];
    process.env.HOME = previousHome;
    process.env.USERPROFILE = previousUserProfile;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
}

function fakeElectron() {
  class BrowserWindow {
    constructor() {
      this.webContents = {
        setWindowOpenHandler() {},
      };
      this.closedHandlers = {};
    }
    once() {}
    on(event, fn) {
      this.closedHandlers[event] = fn;
    }
    loadFile() {}
    show() {}
    focus() {}
    close() {}
    isDestroyed() {
      return false;
    }
  }

  return {
    app: {
      dock: { show() {} },
      focus() {},
    },
    BrowserWindow,
    ipcMain: { handle() {} },
    shell: { openExternal() {} },
  };
}

test("Q0473/Q0493/Q0494 force-onboarding sentinel reopens onboarding once without clearing sessions", () => {
  withTempHome((home, onboardingMain) => {
    const rpDir = path.join(home, ".xpair/host");
    fs.mkdirSync(rpDir, { recursive: true });
    fs.writeFileSync(path.join(rpDir, "client.env"), "REMOTE_HOST=host-mac\nFOLDER_MAPS=/c::/h\n");
    assert.equal(onboardingMain.shouldOnboard([]), false, "configured clients should normally open workbench");

    const sentinel = path.join(rpDir, ".force-onboarding");
    fs.writeFileSync(sentinel, "");
    assert.equal(onboardingMain.shouldOnboard([]), true, "sentinel must force setup on next launch");

    onboardingMain.openOnboardingWindow({ electron: fakeElectron(), onComplete() {} });
    assert.equal(fs.existsSync(sentinel), false, "forced setup must be one-shot after onboarding opens");
    assert.match(fs.readFileSync(path.join(rpDir, "client.env"), "utf8"), /REMOTE_HOST=host-mac/);
  });
});

test("Q0473/Q0493/Q0494 extension Re-run setup schedules next-launch onboarding and asks for restart", () => {
  assert.match(extension, /vscode\.commands\.registerCommand\("remotepair\.runSetup", \(\) => runSetup\(\)\)/);
  assert.match(extension, /fs\.writeFileSync\(path\.join\(os\.homedir\(\), "\.xpair\/host", "\.force-onboarding"\), ""\)/);
  assert.match(extension, /Xpair setup will run when you restart the app\./);
  assert.match(extension, /"Restart now"/);
  assert.match(extension, /vscode\.commands\.executeCommand\("workbench\.action\.quit"\)/);
});

test("Q0473/Q0493/Q0494 status Configure preserves sessions while reserving setup again", () => {
  assert.match(extension, /vscode\.commands\.registerCommand\("remotepair\.endSessionReonboard", \(\) => endSessionReonboard\(\)\)/);
  assert.match(extension, /Set up Xpair again\? Your sessions stay attached\./);
  assert.match(extension, /choice !== "Set up again"/);
  assert.match(extension, /endSessionReonboard: re-onboarding on next launch \(sessions persist\)/);
  assert.match(extension, /vscode\.commands\.executeCommand\("workbench\.action\.quit"\)/);
});

test("Q0473/Q0493/Q0494 host Set up action opens onboarding from scratch, not a disconnected settings pane", () => {
  assert.match(appDelegate, /menu\.addItem\(withTitle: "Set up…", action: #selector\(openSetup\), keyEquivalent: ","\)/);
  assert.match(appDelegate, /@objc func openSetup\(\) \{[\s\S]*OnboardingWindow\(mode: \.grantOnly, initialStep: nil,/);
  assert.match(onboardingWindow, /nil = start at Welcome \(the whole flow from scratch\), so inject nothing/);
  assert.match(onboardingWindow, /if let step = initialStep \{[\s\S]*window\.__rp_initialStep/);
});

console.log(`${testFile} REDGREEN ${passed} ${failed}`);
process.exitCode = failed ? 1 : 0;
