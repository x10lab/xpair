const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const app = fs.readFileSync(path.join(root, "onboarding-webview/src/App.tsx"), "utf8");
const stepInstalling = fs.readFileSync(
  path.join(root, "onboarding-webview/src/components/onboarding/client/StepInstalling.tsx"),
  "utf8",
);
const bridge = fs.readFileSync(path.join(root, "onboarding-bridge.js"), "utf8");
const globals = fs.readFileSync(path.join(root, "onboarding-webview/src/global.d.ts"), "utf8");

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

test("bridge installHost supports force:true and host incompatibility kinds", () => {
  assert.match(bridge, /async installHost\(\{ host, user, password, force \} = \{\}\)/);
  assert.match(bridge, /if \(force\) args\.push\("--force"\)/);
  assert.match(bridge, /incompatibleKind = "major_mismatch"/);
  assert.match(bridge, /incompatibleKind = "below_floor"/);
  assert.match(bridge, /MIN_COMPATIBLE_HOST = "0\.5\.0a49"/);
});

test("global.d.ts exposes force installs and incompatibleKind", () => {
  assert.match(globals, /installHost: \(opts: \{ host: string; user\?: string; password\?: string; force\?: boolean \}\)/);
  assert.match(globals, /incompatibleKind: "below_floor" \| "major_mismatch" \| ""/);
});

test("StepInstalling update mode warns first and only force-installs after Update host click", () => {
  assert.match(stepInstalling, /isUpdate\?: boolean/);
  assert.match(stepInstalling, /force: true[\s\S]*password !== undefined \? \{ password \}/);
  assert.match(stepInstalling, /restart XpairHost/);
  assert.match(stepInstalling, /terminate any running tmux sessions on the host/);
  assert.match(stepInstalling, /minimum compatible host version is \$\{requiredVersion\} or newer/);
  assert.match(stepInstalling, /if \(isUpdate\) return;\s*\n\s*if \(started\.current\) return;/);
  assert.match(stepInstalling, /state === "idle" && !showingPassword[\s\S]*onClick=\{\(\) => runInstall\(\)\}[\s\S]*Update host/);
});

test("password bootstrap states are surfaced through bridge and StepInstalling", () => {
  assert.match(bridge, /NEEDS_PASSWORD: "needs_password"/);
  assert.match(bridge, /PASSWORD_DENIED: "password_denied"/);
  assert.match(bridge, /PROMPT_PASSWORD: "prompt_password"/);
  assert.match(bridge, /cliWithPasswordStdin\(args, pw\)/);
  assert.match(stepInstalling, /r\.state === "needs_password"/);
  assert.match(stepInstalling, /r\.state === "password_denied"/);
  assert.match(stepInstalling, /I Understand/);
  assert.match(stepInstalling, /Host account password/);
});

test("App keeps automatic host detection but removes update auto-navigation machinery", () => {
  assert.match(
    app,
    /if \(requiresHostApp && reachReady && connectTarget\) \{\s*void checkHostApp\(connectTarget\);/,
  );
  assert.doesNotMatch(app, /routeToHostUpdate/);
  assert.doesNotMatch(app, /updateDismissed/);
  assert.doesNotMatch(app, /waitForFreshHostStatus/);
  assert.doesNotMatch(app, /updateCompletionId/);
  assert.doesNotMatch(app, /setInstallMode\("update"\)/);
  assert.doesNotMatch(app, /w\.goTo\(S\.INSTALL, "next"\)/);
});

test("below-floor hosts render an inline Update host button instead of navigating", () => {
  assert.match(
    app,
    /const canUpdateHost =[\s\S]*hostApp\.installed &&[\s\S]*!hostApp\.compatible &&[\s\S]*hostApp\.incompatibleKind === "below_floor"/,
  );
  assert.match(
    app,
    /const hostUpdatePanel = canUpdateHost \? \([\s\S]*<StepInstalling\s*isUpdate[\s\S]*host=\{connectTarget\}[\s\S]*requiredVersion=\{MIN_COMPATIBLE_HOST\}/,
  );
  assert.match(app, /const MIN_COMPATIBLE_HOST = "0\.5\.0a49"/);
});

test("major-mismatch hosts stay blocked with an error and no update button", () => {
  assert.match(app, /hostApp\.incompatibleKind === "below_floor"/);
  assert.doesNotMatch(app, /hostApp\.incompatibleKind === "major_mismatch"[\s\S]*<StepInstalling\s*isUpdate/);
  assert.match(
    app,
    /requiresHostApp && reachReady && hostApp && !hostAppReady && !hostAppChecking[\s\S]*hostApp\.err \|\| "Host version is incompatible with this client\."/,
  );
});

test("successful inline update performs one hostAppStatus re-probe and opens the existing Next gate", () => {
  assert.match(
    app,
    /const handleHostUpdateDone = useCallback\(\(\) => \{[\s\S]*setInstallState\("idle"\);[\s\S]*setHostApp\(null\);[\s\S]*void checkHostApp\(connectTarget\);/,
  );
  assert.match(
    app,
    /const hostAppReady =[\s\S]*hostApp\.target === connectTarget &&[\s\S]*hostApp\.installed &&[\s\S]*hostApp\.compatible/,
  );
  assert.match(app, /const connectReady = reachReady && hostAppReady && hostPermReady/);
  assert.match(app, /!connectReady \|\| hostAppChecking/);
});

test("final liveness reports incompatibility without launching a host-update route", () => {
  assert.match(
    app,
    /if \(app\.installed && !app\.compatible\) \{[\s\S]*setLiveErr\(app\.err \|\| "Host version is incompatible with this client\."\);[\s\S]*setLive\("host-app"\)/,
  );
  assert.doesNotMatch(app, /routeToHostUpdate\(target/);
});

console.log(
  failed ? `\n${failed} test(s) failed` : "\nall onboarding host-update gate tests passed",
);
process.exit(failed ? 1 : 0);
