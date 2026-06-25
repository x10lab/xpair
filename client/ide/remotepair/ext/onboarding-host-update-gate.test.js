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

test("bridge installHost supports force:true → passes --force to the CLI", () => {
  assert.match(bridge, /async installHost\(\{ host, user, password, force \} = \{\}\)/);
  assert.match(bridge, /if \(force\) args\.push\("--force"\)/);
});

test("global.d.ts installHost type includes force?: boolean", () => {
  assert.match(globals, /installHost: \(opts: \{ host: string; user\?: string; force\?: boolean \}\)/);
});

test("StepInstalling has an update mode that force-reinstalls and warns about tmux", () => {
  assert.match(stepInstalling, /isUpdate\?: boolean/);
  // Update mode runs installHost with force:true; install mode keeps the plain call.
  assert.match(
    stepInstalling,
    /installHost\(isUpdate \? \{ host, force: true \} : \{ host \}\)/,
  );
  // Explicit warning that running tmux sessions on the host will be terminated.
  assert.match(stepInstalling, /terminate any running tmux sessions on the host/);
  // Says the host app is already installed.
  assert.match(stepInstalling, /XpairHost is already installed/);
});

test("App routes installed-but-incompatible hosts into StepInstalling update mode (not a dead-end)", () => {
  // A dedicated route helper that sends the wizard to the INSTALL step in update mode.
  assert.match(app, /const routeToHostUpdate = useCallback/);
  assert.match(app, /setInstallMode\("update"\)[\s\S]*w\.goTo\(S\.INSTALL, "next"\)/);
  // Connect-step gate: installed && !compatible triggers the update route.
  assert.match(
    app,
    /hostApp\.installed &&\s*!hostApp\.compatible\s*\)\s*\{\s*routeToHostUpdate\(connectTarget, hostApp\.version\)/,
  );
  // Final liveness gate: installed-but-incompatible also routes to update.
  assert.match(
    app,
    /if \(app\.installed && !app\.compatible\) \{[\s\S]*routeToHostUpdate\(target, app\.version\)/,
  );
  // StepInstalling rendered in update mode with isUpdate + force re-check on done.
  assert.match(app, /installMode === "update"[\s\S]*<StepInstalling\s*isUpdate/);
  // After update, the host app is re-checked before the gate can open (hostApp cleared + re-probe).
  assert.match(app, /onDone=\{\(\) => \{[\s\S]*setHostApp\(null\)[\s\S]*w\.goTo\(S\.CONNECT, "prev"\)/);
});

console.log(
  failed ? `\n${failed} test(s) failed` : "\nall onboarding host-update gate tests passed",
);
process.exit(failed ? 1 : 0);
