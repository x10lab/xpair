const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const app = fs.readFileSync(path.join(root, "onboarding-webview/src/App.tsx"), "utf8");
const stepConnect = fs.readFileSync(
  path.join(root, "onboarding-webview/src/components/onboarding/client/StepConnect.tsx"),
  "utf8",
);
const stepReconnect = fs.readFileSync(
  path.join(root, "onboarding-webview/src/components/onboarding/client/StepReconnect.tsx"),
  "utf8",
);

function test(name, fn) {
  try {
    fn();
    console.log(`  ok  - ${name}`);
  } catch (error) {
    console.error(`  fail - ${name}`);
    throw error;
  }
}

test("discovered connect peers use the SSH connect flow, not install setup", () => {
  assert.match(app, /peer\?\.status === "connect"/);
  assert.match(app, /const isSetup = !!peer && !isReconnect && !isConnect;/);
  assert.match(app, /manual \|\| isConnect \|\| !peer \?/);
  assert.match(app, /setHost\(p\.status === "connect"/);
});

test("manual SSH connect separates host-key mismatch from generic failure", () => {
  assert.match(stepConnect, /"rekeyed"/);
  assert.match(stepConnect, /REMOTE HOST IDENTIFICATION/);
  assert.match(stepConnect, /setState\(isHostKeyMismatch/);
  assert.match(stepConnect, /Host identity changed/);
});

test("reconnect separates host-key mismatch from offline", () => {
  assert.match(stepReconnect, /"rekeyed"/);
  assert.match(stepReconnect, /REMOTE HOST IDENTIFICATION/);
  assert.match(stepReconnect, /isHostKeyMismatch\(r\.err \|\| ""\)/);
  assert.match(stepReconnect, /Host identity changed/);
});

console.log("\nall onboarding routing tests passed");
