const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const appDelegate = fs.readFileSync(path.join(root, "host/app/AppDelegate.swift"), "utf8");
const onboardingWindow = fs.readFileSync(path.join(root, "host/app/OnboardingWindow.swift"), "utf8");
const hostApp = fs.readFileSync(path.join(root, "host/onboarding/src/App.tsx"), "utf8");
const stepPermissions = fs.readFileSync(
  path.join(root, "host/onboarding/src/components/onboarding/host/StepPermissions.tsx"),
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
    passed += 1;
    console.log(`PASS ${name} - host onboarding is an in-app TCC product flow`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name} - ${error.message.split("\n")[0]}`);
  }
}

function stripLineComments(source) {
  return source
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

function completeBridgeIsTccGated(source) {
  const stripped = stripLineComments(source);
  const complete = stripped.match(/case "complete":(?<body>[\s\S]*?)(?:\n\s*case "|\n\s*default:)/);
  assert.ok(complete, 'OnboardingWindow.swift must handle the "complete" bridge message');
  const body = complete.groups.body;
  const gate = body.indexOf("Permissions.allGranted()");
  const finish = body.indexOf("finish()");
  return gate !== -1 && finish !== -1 && gate < finish;
}

test("Q0441 Q0442 Q0443 Host onboarding exists in the Host app/menu bar and cannot complete before required TCC", () => {
  assert.match(
    appDelegate,
    /if !Permissions\.allGranted\(\) \{[\s\S]*OnboardingWindow\(onComplete:[\s\S]*startServing\(\)/,
    "launch-time host serving must be gated behind the onboarding completion callback",
  );
  assert.match(appDelegate, /menu\.addItem\(withTitle: "Permissions…", action: #selector\(grantPermissions\)/);
  assert.match(appDelegate, /menu\.addItem\(withTitle: "Connect…", action: #selector\(connectClient\)/);
  assert.match(appDelegate, /menu\.addItem\(withTitle: "Set up…", action: #selector\(openSetup\)/);
  assert.match(appDelegate, /OnboardingWindow\(mode: \.grantOnly, initialStep: "permissions"/);
  assert.match(appDelegate, /OnboardingWindow\(mode: \.grantOnly, initialStep: "connect"/);
  assert.match(appDelegate, /OnboardingWindow\(mode: \.grantOnly, initialStep: nil/);

  assert.match(hostApp, /const STEP_TITLES = \["Welcome", "Permissions", "Engine", "Connect", "Done"\]/);
  assert.match(hostApp, /perm\.ax === "granted" && perm\.sr === "granted"/);
  assert.match(hostApp, /w\.index === 1 && !ready/);
  assert.match(stepPermissions, /window\.xpair\.requestPermission\(r\.key\)/);
  assert.match(stepPermissions, /window\.xpair\.openPermissionPane\(r\.key\)/);
  assert.match(stepWaiting, /window\.xpair\s*\.\s*connectedClients\(\)/);

  assert.ok(
    completeBridgeIsTccGated(onboardingWindow),
    "React complete() can call finish() without rechecking Permissions.allGranted(), so Host onboarding can end before the required TCC flow is resolved",
  );
});

console.log(`REDGREEN ${passed} ${failed}`);
process.exit(failed ? 1 : 0);
