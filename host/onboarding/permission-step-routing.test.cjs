const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const app = fs.readFileSync(path.join(root, "src/App.tsx"), "utf8");
const permissions = fs.readFileSync(
  path.join(root, "src/components/onboarding/host/StepPermissions.tsx"),
  "utf8",
);
const appDelegate = fs.readFileSync(path.join(root, "../app/AppDelegate.swift"), "utf8");
const onboardingWindow = fs.readFileSync(path.join(root, "../app/OnboardingWindow.swift"), "utf8");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS ${name} - permission onboarding exposes separate retryable TCC steps`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name} - ${error.message.split("\n")[0]}`);
  }
}

test("Q0183 Q0443 Q0473 permission steps are separated, retryable, and gate progress", () => {
  assert.match(app, /STEP_TITLES\s*=\s*\[[\s\S]*"Permissions"/);
  assert.match(app, /deepLink === "permissions" \? 1/);
  assert.match(app, /perm\.ax === "granted" && perm\.sr === "granted"/);
  assert.match(app, /w\.index === 1 && !ready/);

  assert.match(permissions, /key: "ax"[\s\S]*name: "Accessibility \(required\)"/);
  assert.match(permissions, /key: "sr"[\s\S]*name: "Screen Recording \(required\)"/);
  assert.match(permissions, /key: "fda"[\s\S]*name: "Full Disk Access \(recommended\)"/);
  assert.match(permissions, /const s = await window\.xpair\.getStatus\(\);/);
  assert.match(permissions, /if \(current === "opening"\) return "retry"/);
  assert.match(permissions, /ax: nextStatus\(s\.ax, cur\.ax\)/);
  assert.match(permissions, /sr: nextStatus\(s\.sr, cur\.sr\)/);
  assert.match(permissions, /fda: nextStatus\(s\.fda, cur\.fda\)/);
  assert.match(
    permissions,
    /window\.xpair\.requestPermission\(r\.key\);[\s\S]*window\.xpair\.openPermissionPane\(r\.key\);[\s\S]*setState\(\{ \.\.\.stateRef\.current, \[r\.key\]: "opening" \}\);/,
  );
  assert.match(permissions, /setState\(\{ \.\.\.stateRef\.current, \[r\.key\]: "failed" \}\);/);
  assert.doesNotMatch(permissions, /disabled=\{status === "opening"\}/);

  assert.match(
    appDelegate,
    /OnboardingWindow\(mode: \.grantOnly, initialStep: "permissions"/,
    "Host permissions/settings actions must reopen the onboarding Permissions step",
  );
  assert.match(onboardingWindow, /"ax": "x-apple\.systempreferences:com\.apple\.preference\.security\?Privacy_Accessibility"/);
  assert.match(onboardingWindow, /"sr": "x-apple\.systempreferences:com\.apple\.preference\.security\?Privacy_ScreenCapture"/);
});

console.log(`REDGREEN ${passed} ${failed}`);
process.exit(failed ? 1 : 0);
