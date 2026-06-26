const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "../../../..");
const ext = path.join(root, "client/ide/remotepair/ext");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const webview = read("client/ide/remotepair/ext/media/remote-desktop.js");
const injector = read("host/rd/rpmedia/rp-input-inject.swift");
const sidecar = read("host/rd/screen/src/serve_webrtc.rs");
const onboardingBridge = read("client/ide/remotepair/ext/onboarding-bridge.js");
const screenServer = read("host/app/ScreenServer.swift");
const captureControl = read("host/app/CaptureControl.swift");
const captureEngine = read("host/app/CaptureEngine.swift");
const buildHost = read("host/build-host.sh");
const installer = read("host/app/Installer.swift");
const contracts = JSON.parse(fs.readFileSync(path.join(ext, "generated/contracts.json"), "utf8"));
const constants = JSON.parse(read("shared/screen-protocol/constants.json"));

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL - ${name}`);
    console.error(`         ${error.message.split("\n")[0]}`);
  }
}

test("SoT and generated contract both enable RD input", () => {
  assert.equal(constants.remoteInput.supported, true);
  assert.equal(contracts.screen.remoteInputSupported, true);
});

test("rp-input-inject is built, bundled, signed, and installed like screen helpers", () => {
  assert.match(buildHost, /compile_helper host\/rd\/rpmedia\/rp-input-inject\.swift\s+"\$HELP\/rp-input-inject"/);
  assert.match(buildHost, /for b in screen rp-screencap rp-input-inject/);
  assert.match(installer, /linkBundledBinaries\(\["screen", "rp-screencap", "rp-input-inject"\]\)/);
});

test("serve-webrtc resolves input helper by explicit bundle/install paths and relays readiness", () => {
  assert.match(sidecar, /fn input_helper_path\(\) -> Result<String, String>/);
  assert.match(sidecar, /sibling_helper\("rp-input-inject"\)/);
  assert.match(sidecar, /\.xpair\/host\/bin\/rp-input-inject/);
  assert.doesNotMatch(sidecar, /"rp-input-inject"\.to_string\(\)/);
  assert.match(sidecar, /InputReady/);
  assert.match(sidecar, /InputFailed/);
  assert.match(sidecar, /status_from_input_helper_line/);
  assert.match(sidecar, /command\.env\("RP_CAPTURE_DISPLAY_ID", display_id\.to_string\(\)\)/);
  assert.match(sidecar, /capture_display_id_for_input/);
  assert.match(sidecar, /on_data_channel/);
  assert.match(sidecar, /wire_input_data_channel/);
});

test("injector supports wheel, pointer lifecycle, key lifecycle, and capture-aligned display selection", () => {
  assert.match(injector, /case "w":/);
  assert.match(injector, /injectWheel/);
  assert.match(injector, /case "d":/);
  assert.match(injector, /case "u":/);
  assert.match(injector, /rightMouseDragged|leftMouseDragged/);
  assert.match(injector, /"action":"down"\|"up"|action/);
  assert.match(injector, /configuredDisplayID\(\) \?\? activeDisplayIDs\(\)\.first/);
  assert.match(injector, /RP_CAPTURE_DISPLAY_ID/);
  assert.match(captureEngine, /case started\(displayID: UInt32, width: Int, height: Int\)/);
  assert.match(captureEngine, /display\.displayID/);
  assert.match(captureControl, /case started\(StartedInfo\)/);
  assert.match(captureControl, /"displayId": NSNumber\(value: info\.displayID\)/);
  assert.match(screenServer, /result: \.started\(info\)/);
  assert.doesNotMatch(injector, /let\s+\w*Bounds\s*=\s*CGDisplayBounds\(CGMainDisplayID\(\)\)/);
  assert.match(injector, /RPINPUT/);
});

test("input protocol hardening releases held state and preserves ordering", () => {
  assert.match(injector, /var heldButtons = Set<String>\(\)/);
  assert.match(injector, /var heldKeys: \[Int: UInt64\] = \[:\]/);
  assert.match(injector, /func releaseHeldInputs\(reason: String\)/);
  assert.match(injector, /injectMouse\(p, down: false, right: btn == "r"\)/);
  assert.match(injector, /postKeyEvent\(code, down: false, flags: 0\)/);
  assert.match(injector, /releaseHeldInputs\(reason: exitReason\)/);

  assert.match(injector, /case 36: if injectText\("\\n"\) \{ return \}/);
  assert.match(injector, /case 48: if injectText\("\\t"\) \{ return \}/);
  assert.match(injector, /If Return\/Tab have no AX text target[\s\S]*fall through to the normal keycode path/);

  assert.match(sidecar, /fn should_forward_input_message\(json: &\[u8\], last_applied_seq: &mut u64\) -> bool/);
  assert.match(sidecar, /kind == Some\("m"\) && seq <= \*last_applied_seq/);
  assert.match(sidecar, /\*last_applied_seq = \(\*last_applied_seq\)\.max\(seq\)/);
  assert.match(sidecar, /drop\(stdin\);[\s\S]*child\.wait\(\)/);
  assert.doesNotMatch(sidecar, /while let Ok\(json\) = input_rx\.recv\(\)[\s\S]{0,400}child\.kill\(\)/);
});

test("RD token requirement bumps the onboarding host compatibility floor", () => {
  assert.match(onboardingBridge, /const MIN_COMPATIBLE_HOST = "0\.5\.0a49"/);
  assert.match(onboardingBridge, /a49 RD session-token requirement/);
  assert.match(onboardingBridge, /rd-session-token and serve-webrtc --token mandatory/);
});

test("webview gates input on helper readiness and sends down/up/drag/key-up events", () => {
  assert.match(webview, /inputReady/);
  assert.match(webview, /input-ready/);
  assert.match(webview, /input-failed/);
  assert.match(webview, /addEventListener\("pointerdown"/);
  assert.match(webview, /addEventListener\("pointerup"/);
  assert.match(webview, /addEventListener\("pointermove"/);
  assert.match(webview, /\bt:\s*"d"/);
  assert.match(webview, /\bt:\s*"u"/);
  assert.match(webview, /\bt:\s*"m"/);
  assert.match(webview, /addEventListener\("keyup"/);
  assert.match(webview, /action:\s*"up"/);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
}

console.log("\nall RD input-supported tests passed");
