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

function requiredConst(name) {
  const match = app.match(new RegExp(`const ${name} =[\\s\\S]*?;\\n`));
  assert.ok(match, `${name} must exist`);
  return match[0];
}

test("bridge installHost supports force:true and host incompatibility kinds", () => {
  assert.match(bridge, /async installHost\(\{ host, user, password, force \} = \{\}\)/);
  assert.match(bridge, /if \(force\) args\.push\("--force"\)/);
  assert.match(bridge, /incompatibleKind = "major_mismatch"/);
  assert.match(bridge, /incompatibleKind = "below_floor"/);
  assert.match(bridge, /MIN_COMPATIBLE_HOST = "0\.5\.0a51"/);
});

test("global.d.ts exposes force installs and incompatibleKind", () => {
  assert.match(globals, /installHost: \(opts: \{ host: string; user\?: string; password\?: string; force\?: boolean \}\)/);
  assert.match(globals, /incompatibleKind: "below_floor" \| "major_mismatch" \| ""/);
});

test("StepInstalling repair mode warns first and only force-installs non-restart repairs after a click", () => {
  assert.match(stepInstalling, /isUpdate\?: boolean/);
  assert.match(stepInstalling, /forceInstall\?: boolean/);
  assert.match(stepInstalling, /repairKind\?: "missing" \| "update" \| "restart" \| "incompatible"/);
  assert.match(stepInstalling, /const useForce = repairMode && repairKind !== "restart";/);
  // installHost is opts-based now: force from useForce, plus the optional one-shot password.
  assert.match(stepInstalling, /useForce \? \{ force: true \}[\s\S]*password !== undefined \? \{ password \}/);
  assert.match(stepInstalling, /restart XpairHost/);
  assert.match(stepInstalling, /terminate any running tmux sessions on the host/);
  assert.match(stepInstalling, /without reinstalling it/);
  assert.match(
    stepInstalling,
    /\{useForce \? \([\s\S]*terminate any running tmux sessions on the host[\s\S]*\) : \([\s\S]*without reinstalling it/,
  );
  assert.match(stepInstalling, /minimum compatible host version is \$\{requiredVersion\} or newer/);
  assert.match(stepInstalling, /if \(repairMode\) return;\s*\n\s*if \(started\.current\) return;/);
  assert.match(stepInstalling, /state === "idle" && !showingPassword[\s\S]*onClick=\{\(\) => runInstall\(\)\}[\s\S]*\{repairButton\}/);
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

test("safe saved, manual, reconnect, or connect hosts render an inline repair button instead of navigating", () => {
  assert.match(
    app,
    /const hostAppLiveFalse =[\s\S]*hostApp\.installed === true &&[\s\S]*hostApp\.compatible === true &&[\s\S]*hostPerms\.alive === false/,
  );
  const canRepairHost = requiredConst("canRepairHost");
  assert.match(canRepairHost, /requiresHostApp &&/);
  assert.match(canRepairHost, /reachReady &&/);
  assert.match(canRepairHost, /\(manual \|\| startsFromSavedHost \|\| isReconnect \|\| isConnect\) &&/);
  assert.match(canRepairHost, /hostApp\.target === connectTarget &&/);
  assert.match(
    canRepairHost,
    /hostApp\.installed !== true \|\|[\s\S]*hostApp\.incompatibleKind === "below_floor"[\s\S]*\|\|[\s\S]*hostAppLiveFalse/,
  );
  assert.match(
    app,
    /const hostRepairPanel = canRepairHost \? \([\s\S]*<StepInstalling[\s\S]*forceInstall[\s\S]*repairKind=\{hostRepairKind\}[\s\S]*host=\{connectTarget\}/,
  );
  assert.match(app, /const MIN_COMPATIBLE_HOST = "0\.5\.0a51"/);
});

test("manual changed-target missing-app repair shows fingerprint/key prep before the install panel", () => {
  assert.match(app, /const \[savedHost, setSavedHost\] = useState\(""\);/);
  assert.match(app, /const hydratedHost = cfg\.remoteHost\.trim\(\);/);
  assert.match(app, /setSavedHost\(\(current\) => current \|\| hydratedHost\);/);
  assert.match(app, /setHost\(\(current\) => current \|\| hydratedHost\);/);
  assert.match(
    app,
    /const manualTargetIsSavedHost = !!savedHost && connectTarget === savedHost;/,
  );
  assert.match(
    app,
    /const manualMissingNeedsFingerprint =[\s\S]*manual && !manualTargetIsSavedHost && hostRepairKind === "missing";/,
  );
  assert.doesNotMatch(
    app,
    /manual && !startsFromSavedHost && hostRepairKind === "missing"/,
  );
  assert.match(
    app,
    /const manualMissingRepairPeer: Peer \| null = connectTarget[\s\S]*source: "ssh"[\s\S]*status: "setup"/,
  );
  assert.match(
    app,
    /manualMissingNeedsFingerprint && manualMissingRepairPeer[\s\S]*<StepSetupPassword[\s\S]*peer=\{manualMissingRepairPeer\}[\s\S]*onReady=\{setSetupReady\}/,
  );
  assert.match(
    app,
    /\{\(!manualMissingNeedsFingerprint \|\| setupReady\) && \([\s\S]*<StepInstalling/,
  );
  assert.match(
    app,
    /previousConnectTarget\.current = connectTarget;[\s\S]*setSetupReady\(false\);[\s\S]*setInstallState\("idle"\);/,
  );
});

test("below-floor hosts keep update wording while major-mismatch hosts stay blocked", () => {
  const canRepairHost = requiredConst("canRepairHost");
  assert.match(
    app,
    /const canUpdateHost =[\s\S]*hostApp\.installed &&[\s\S]*!hostApp\.compatible &&[\s\S]*hostApp\.incompatibleKind === "below_floor"/,
  );
  assert.doesNotMatch(
    canRepairHost,
    /hostApp\.compatible !== true \|\| hostAppLiveFalse/,
    "broad incompatible repair would include major_mismatch and can downgrade a newer host",
  );
  assert.doesNotMatch(canRepairHost, /major_mismatch/);
  assert.match(
    app,
    /hostApp\.compatible !== true[\s\S]*\? canUpdateHost[\s\S]*\? "update"[\s\S]*: "incompatible"/,
  );
  assert.match(
    app,
    /requiredVersion=\{hostRepairKind === "update" \? MIN_COMPATIBLE_HOST : ""\}/,
  );
});

test("successful inline repair performs hostAppStatus and liveness re-probes before opening Next", () => {
  assert.match(
    app,
    /const handleHostRepairDone = useCallback\(\(\) => \{[\s\S]*setInstallState\("idle"\);[\s\S]*setHostApp\(null\);[\s\S]*setHostPerms\(null\);[\s\S]*setHostPermChecking\(false\);[\s\S]*void checkHostApp\(connectTarget\);/,
  );
  assert.match(
    app,
    /const hostAppReady =[\s\S]*hostApp\.target === connectTarget &&[\s\S]*hostApp\.installed &&[\s\S]*hostApp\.compatible/,
  );
  assert.match(
    app,
    /hostPermissions\(\{ host: connectTarget \}\)/,
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
