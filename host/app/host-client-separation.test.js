const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const appDelegate = fs.readFileSync(path.join(__dirname, "AppDelegate.swift"), "utf8");
const config = fs.readFileSync(path.join(__dirname, "Config.swift"), "utf8");
const onboardingWindow = fs.readFileSync(path.join(__dirname, "OnboardingWindow.swift"), "utf8");
const screenServer = fs.readFileSync(path.join(__dirname, "ScreenServer.swift"), "utf8");
const captureEngine = fs.readFileSync(path.join(__dirname, "CaptureEngine.swift"), "utf8");
const bonjourAdvertiser = fs.readFileSync(path.join(__dirname, "BonjourAdvertiser.swift"), "utf8");
const stepWaiting = fs.readFileSync(
  path.join(root, "host/onboarding/src/components/onboarding/host/StepWaiting.tsx"),
  "utf8",
);
const clientBridge = fs.readFileSync(
  path.join(root, "client/ide/remotepair/ext/onboarding-bridge.js"),
  "utf8",
);
const clientExtension = fs.readFileSync(
  path.join(root, "client/ide/remotepair/ext/extension.js"),
  "utf8",
);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS ${name} - host and client responsibilities remain separated`);
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

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notStrictEqual(start, -1, `missing ${signature}`);
  const brace = source.indexOf("{", start);
  assert.notStrictEqual(brace, -1, `missing body for ${signature}`);
  let depth = 0;
  for (let i = brace; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") depth--;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated body for ${signature}`);
}

test("Q0343 host onboarding does not install, open, or operate the client workbench", () => {
  assert.match(config, /let ROLE_FILE = .*host\|client\|both/);
  assert.match(config, /var isHostRole: Bool \{[\s\S]*return role == "host" \|\| role == "both" \|\| role\.isEmpty[\s\S]*\}/);
  assert.match(config, /var isClientRole: Bool \{ currentRole\(\) == "client" \}/);

  assert.match(appDelegate, /if isHostRole \{ advertiser\.ensureAdvertising\(\) \}/);
  assert.match(bonjourAdvertiser, /txt\["role"\] = role\.isEmpty \? "host" : role/);
  assert.match(screenServer, /Screen sharing belongs to the host app, not the client\./);

  assert.match(stepWaiting, /window\.xpair\s*\.\s*connectedClients\(\)/);
  assert.match(stepWaiting, /On your other Mac, open Xpair/);
  assert.doesNotMatch(stepWaiting, /installHost|openRemoteDesktop|vscode\.openFolder|xpair onboard/);

  const bridgeShim = extractFunction(onboardingWindow, "private static let bridgeShim");
  assert.doesNotMatch(bridgeShim, /installHost|openRemoteDesktop|connectHost|openFileBrowser|vscode\.openFolder/);

  const completeCase = stripLineComments(onboardingWindow).match(
    /case "complete":(?<body>[\s\S]*?)(?:\n\s*default:)/,
  );
  assert.ok(completeCase, 'OnboardingWindow.swift must handle the "complete" bridge message');
  assert.match(completeCase.groups.body, /finish\(\)/);

  const finishBody = extractFunction(stripLineComments(onboardingWindow), "private func finish()");
  assert.doesNotMatch(finishBody, /NSWorkspace\.shared\.open|Process\(\)|installHost|openRemoteDesktop|vscode\.openFolder/);

  assert.match(clientBridge, /async installHost\(\{ host, user, password \} = \{\}\)/);
  assert.match(clientExtension, /vscode\.commands\.registerCommand\("remotepair\.openRemoteDesktop"/);
  // The client (not the host) operates the workbench's folder roots. Per round-1
  // decision #3 (Xpair Sessions only — native workbench surfaces stay hidden during
  // owned Xpair flows) the connect flow routes through Xpair surfaces and reconciles
  // Browser roots via updateWorkspaceFolders, rather than opening a separate
  // open-remote-ssh window. See ssh-connect-flow-requirement.test.js, which asserts
  // the client extension must NOT contain vscode.openFolder.
  assert.match(clientExtension, /vscode\.workspace\.updateWorkspaceFolders/);
  assert.doesNotMatch(clientExtension, /vscode\.openFolder/);
});

test("RD capture failures are forwarded as structured sidecar diagnostics", () => {
  assert.match(captureEngine, /enum CaptureFailureKind/);
  assert.match(captureEngine, /case startFailed = "start-failed"/);
  assert.match(captureEngine, /case encoderFailed = "encoder-failed"/);
  assert.match(captureEngine, /eventSink: \(\(CaptureEvent\) -> Void\)\? = nil/);
  assert.match(captureEngine, /reportCaptureError\(\s*kind: \.startFailed/);
  assert.match(screenServer, /handleCaptureEvent\(_ event: CaptureEngine\.CaptureEvent\)/);
  assert.match(screenServer, /writeSidecarControl\(\["capture": "error", "kind": kind\.rawValue, "reason": reason\]\)/);
});

console.log(`${__filename}`);
console.log(`REDGREEN ${passed} ${failed}`);
process.exit(failed ? 1 : 0);
