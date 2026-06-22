const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const appDelegate = fs.readFileSync(path.join(root, "host/app/AppDelegate.swift"), "utf8");
const hostApp = fs.readFileSync(path.join(root, "host/onboarding/src/App.tsx"), "utf8");
const stepWelcome = fs.readFileSync(
  path.join(root, "host/onboarding/src/components/onboarding/host/StepWelcome.tsx"),
  "utf8",
);
const stepPermissions = fs.readFileSync(
  path.join(root, "host/onboarding/src/components/onboarding/host/StepPermissions.tsx"),
  "utf8",
);
const stepEngine = fs.readFileSync(
  path.join(root, "host/onboarding/src/components/onboarding/host/StepEngine.tsx"),
  "utf8",
);
const stepWaiting = fs.readFileSync(
  path.join(root, "host/onboarding/src/components/onboarding/host/StepWaiting.tsx"),
  "utf8",
);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS ${name} - Host onboarding exists and owns setup`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name} - ${error.message.split("\n")[0]}`);
  }
}

test("§1.2 Q0441 Host onboarding exists for permissions, engine, and connect setup", () => {
  assert.match(
    appDelegate,
    /if !Permissions\.allGranted\(\) \{[\s\S]*Permissions\.request\("ax"\)[\s\S]*Permissions\.request\("sr"\)[\s\S]*let ob = OnboardingWindow/,
    "launch must show Host onboarding and pre-register required TCC permissions when AX/SR are unresolved",
  );
  assert.match(
    appDelegate,
    /menu\.addItem\(withTitle: "Permissions…", action: #selector\(grantPermissions\)/,
    "Host menu must reopen the permissions onboarding step",
  );
  assert.match(
    appDelegate,
    /OnboardingWindow\(mode: \.grantOnly, initialStep: "permissions"/,
    "Permissions menu action must deep-link to the Host permissions step",
  );
  assert.match(
    appDelegate,
    /menu\.addItem\(withTitle: "Connect…", action: #selector\(connectClient\)/,
    "Host menu must expose the client connection onboarding guide",
  );
  assert.match(
    appDelegate,
    /OnboardingWindow\(mode: \.grantOnly, initialStep: "connect"/,
    "Connect menu action must deep-link to the Host client-connection step",
  );
  assert.match(
    appDelegate,
    /menu\.addItem\(withTitle: "Set up…", action: #selector\(openSetup\)/,
    "Host menu must expose the full setup onboarding flow",
  );
  assert.match(
    appDelegate,
    /OnboardingWindow\(mode: \.grantOnly, initialStep: nil/,
    "Set up menu action must start Host onboarding from Welcome",
  );
  assert.match(
    hostApp,
    /const STEP_TITLES = \["Welcome", "Permissions", "Engine", "Connect", "Done"\]/,
    "Host onboarding must include Welcome, Permissions, Engine, Connect, and Done steps",
  );
  assert.match(
    hostApp,
    /perm\.ax === "granted" && perm\.sr === "granted"/,
    "Host onboarding permission readiness must require Accessibility and Screen Recording",
  );
  assert.match(
    hostApp,
    /w\.index === 1 && !ready/,
    "Host onboarding must gate the permissions step",
  );
  assert.match(
    hostApp,
    /w\.index === 2 && !engineReady/,
    "Host onboarding must gate the engine step",
  );
  assert.match(stepWelcome, /Set up XpairHost/);
  assert.match(stepWelcome, /accept connections from your\s+client/);
  assert.match(stepPermissions, /key: "ax"[\s\S]*Accessibility \(required\)/);
  assert.match(stepPermissions, /key: "sr"[\s\S]*Screen Recording \(required\)/);
  assert.match(stepPermissions, /window\.xpair\.requestPermission\(r\.key\)/);
  assert.match(stepPermissions, /window\.xpair\.openPermissionPane\(r\.key\)/);
  assert.match(stepEngine, /window\.xpair\.engineStatus\(e\)/);
  assert.match(stepEngine, /onReady\(r\.installed && r\.authed\)/);
  assert.match(stepWaiting, /window\.xpair[\s\S]*\.connectedClients\(\)/);
  assert.match(stepWaiting, /open Xpair/);
});

console.log(`REDGREEN ${passed} ${failed}`);
process.exit(failed ? 1 : 0);
