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

test("StepInstalling does NOT auto-run the forced update on mount (explicit click is the consent)", () => {
  // The mount effect bails out in update mode so the tmux-kill warning is read first.
  assert.match(stepInstalling, /if \(isUpdate\) return;\s*\n\s*if \(started\.current\) return;/);
  // An explicit "Update host" button starts the forced install only when idle.
  assert.match(stepInstalling, /state === "idle" &&[\s\S]*onClick=\{runInstall\}[\s\S]*Update host/);
});

test("App clears live=checking when routing into the host update (Next not stuck after return)", () => {
  // routeToHostUpdate resets live so a final-gate-triggered update doesn't leave Next disabled.
  assert.match(
    app,
    /const routeToHostUpdate = useCallback\(\s*\(target: string, hostVersion: string, origin: "connect" \| "final"\) => \{[\s\S]*setLive\("idle"\)/,
  );
});

test("App re-checks setup-path updates via the final liveness gate before returning to Connect", () => {
  // Update launched from the final (Mappings) gate returns to Mappings and re-runs the liveness
  // check (which performs the host-app re-check) instead of dropping setup peers back into Connect.
  assert.match(
    app,
    /updateOrigin === "final"[\s\S]*w\.goTo\(S\.MAPPINGS, "prev"\)[\s\S]*runLivenessCheck\(\)/,
  );
});

test("App routes installed-but-incompatible hosts into StepInstalling update mode (not a dead-end)", () => {
  // A dedicated route helper that sends the wizard to the INSTALL step in update mode.
  assert.match(app, /const routeToHostUpdate = useCallback/);
  assert.match(app, /setInstallMode\("update"\)[\s\S]*w\.goTo\(S\.INSTALL, "next"\)/);
  // Connect-step gate: installed && !compatible (below_floor) triggers the update route (origin
  // "connect"). The incompatibleKind guard sits between the predicate and the route (Finding A).
  assert.match(
    app,
    /hostApp\.installed &&\s*!hostApp\.compatible &&[\s\S]*?hostApp\.incompatibleKind === "below_floor"\s*\)\s*\{\s*routeToHostUpdate\(connectTarget, hostApp\.version, "connect"\)/,
  );
  // Final liveness gate: installed-but-too-old (below_floor) also routes to update (origin "final").
  assert.match(
    app,
    /if \(app\.installed && !app\.compatible && app\.incompatibleKind === "below_floor"\) \{[\s\S]*routeToHostUpdate\(target, app\.version, "final"\)/,
  );
  // StepInstalling rendered in update mode with isUpdate + force re-check on done.
  assert.match(app, /installMode === "update"[\s\S]*<StepInstalling\s*isUpdate/);
  // After update, the host app is re-checked before the gate can open (hostApp cleared + re-probe).
  assert.match(app, /onDone=\{\(\) => \{[\s\S]*setHostApp\(null\)/);
});

// --- Round 2: edge-case findings -------------------------------------------------------------

test("A — bridge surfaces incompatibleKind distinguishing below_floor from major_mismatch", () => {
  // Different/newer major is tagged major_mismatch (must NOT force-update → downgrade).
  assert.match(bridge, /incompatibleKind = "major_mismatch"/);
  // Same-major-but-too-old is tagged below_floor (safe to force-update).
  assert.match(bridge, /incompatibleKind = "below_floor"/);
  // hostAppStatus returns the field.
  assert.match(bridge, /return \{\s*installed: true,\s*version,\s*compatible,\s*incompatibleKind,/);
});

test("A — global.d.ts types incompatibleKind on hostAppStatus", () => {
  assert.match(globals, /incompatibleKind: "below_floor" \| "major_mismatch" \| ""/);
});

test("A — Connect-step auto-route only fires for below_floor (not major_mismatch/downgrade)", () => {
  assert.match(
    app,
    /!hostApp\.compatible &&[\s\S]*hostApp\.incompatibleKind === "below_floor"\s*\)\s*\{\s*routeToHostUpdate\(connectTarget/,
  );
});

test("A — final liveness gate routes below_floor to update but blocks major_mismatch as error", () => {
  // Only below_floor routes into the update flow at the final gate.
  assert.match(
    app,
    /if \(app\.installed && !app\.compatible && app\.incompatibleKind === "below_floor"\) \{[\s\S]*routeToHostUpdate\(target, app\.version, "final"\)/,
  );
  // A different/newer major falls through to a blocking host-app error (no forced reinstall).
  assert.match(
    app,
    /if \(app\.installed && !app\.compatible\) \{[\s\S]*setLive\("host-app"\)/,
  );
});

test("B — backing out of an update clears the stale host-app probe (onFail + header Back)", () => {
  // Update onFail invalidates the stale probe so the auto-route doesn't bounce the user back.
  assert.match(
    app,
    /onFail=\{\(\) => \{\s*setInstallMode\("install"\);[\s\S]*hostAppProbeId\.current \+= 1;\s*setHostApp\(null\)/,
  );
  // Header Back (onPrev) from the update step does the same.
  assert.match(
    app,
    /w\.index === S\.INSTALL && installMode === "update"\) \{[\s\S]*setHostApp\(null\)/,
  );
});

test("C — failed final-gate update preserves setup-done so the setup guard isn't re-tripped", () => {
  // Both onFail and header-Back keep installState "done" for the final-origin setup case.
  assert.match(
    app,
    /onFail=\{\(\) => \{[\s\S]*if \(updateOrigin === "final" && isSetup\) \{[\s\S]*setInstallState\("done"\)/,
  );
  assert.match(
    app,
    /w\.index === S\.INSTALL && installMode === "update"\) \{[\s\S]*if \(updateOrigin === "final" && isSetup\) \{[\s\S]*setInstallState\("done"\)/,
  );
});

test("D — successful final-gate update waits for fresh host status before re-checking", () => {
  // A polling helper retries hostAppStatus until the version moves off the stale one / becomes compatible.
  assert.match(app, /const waitForFreshHostStatus = useCallback/);
  assert.match(app, /app\.compatible \|\| !app\.version \|\| app\.version !== staleVersion/);
  // onDone (final origin) awaits the fresh-status poll BEFORE runLivenessCheck.
  assert.match(
    app,
    /await waitForFreshHostStatus\(updTarget, staleVer\);\s*await runLivenessCheck\(\)/,
  );
});

// --- Round 3: follow-on edge cases -----------------------------------------------------------

test("A3 — explicit back-out sets updateDismissed and suppresses the Connect auto-route", () => {
  // A dedicated dismissed flag exists.
  assert.match(app, /const \[updateDismissed, setUpdateDismissed\] = useState\(false\)/);
  // Both back-out paths (header Back + failed-update onFail) set it true.
  assert.match(
    app,
    /w\.index === S\.INSTALL && installMode === "update"\) \{[\s\S]*setUpdateDismissed\(true\)/,
  );
  assert.match(
    app,
    /onFail=\{\(\) => \{[\s\S]*setUpdateDismissed\(true\)/,
  );
  // The Connect-step auto-route is suppressed while dismissed, even for a still-below-floor host.
  assert.match(
    app,
    /!updateDismissed &&[\s\S]*hostApp\.incompatibleKind === "below_floor"\s*\)\s*\{\s*routeToHostUpdate\(connectTarget/,
  );
  // The flag is reset when re-initiating the update and when targeting a different host / manual.
  assert.match(app, /setInstallMode\("update"\);[\s\S]*setUpdateDismissed\(false\)/);
  // onSelectPeer and onManual both clear it for a new target.
  assert.match(
    app,
    /setInstallMode\("install"\);\s*\n\s*\/\/[^\n]*\n\s*setUpdateDismissed\(false\);\s*\n\s*setReconnectReady/,
  );
});

test("B3 — connect-path update success waits for fresh host status before returning to Connect", () => {
  // The connect (non-final) onDone branch runs the same freshness poll as the final gate before
  // navigating back to Connect, so the Connect re-probe doesn't read the stale status.json.
  assert.match(
    app,
    /setInstallState\("idle"\);\s*\n\s*setLive\("checking"\);[\s\S]*await waitForFreshHostStatus\(updTarget, staleVer\);\s*\n\s*setLive\("idle"\);\s*\n\s*w\.goTo\(S\.CONNECT, "prev"\)/,
  );
});

test("C3 — Next stays blocked during the freshness-poll window on both origins", () => {
  // Final-gate return sets live="checking" before navigating to Mappings + polling.
  assert.match(
    app,
    /setInstallState\("done"\);\s*\n[\s\S]*setLive\("checking"\);[\s\S]*w\.goTo\(S\.MAPPINGS, "prev"\)/,
  );
  // Connect-path return likewise sets live="checking" during the poll.
  assert.match(
    app,
    /setLive\("checking"\);[\s\S]*await waitForFreshHostStatus\(updTarget, staleVer\);\s*\n\s*setLive\("idle"\)/,
  );
  // live === "checking" disables Next globally (WizardShell), gating it during the whole window.
  assert.match(app, /nextDisabled=\{nextDisabled \|\| live === "checking"\}/);
});

console.log(
  failed ? `\n${failed} test(s) failed` : "\nall onboarding host-update gate tests passed",
);
process.exit(failed ? 1 : 0);
