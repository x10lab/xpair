const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const app = fs.readFileSync(path.join(root, "src/App.tsx"), "utf8");
const stepWaiting = fs.readFileSync(
  path.join(root, "src/components/onboarding/host/StepWaiting.tsx"),
  "utf8",
);
const onboardingWindow = fs.readFileSync(
  path.resolve(root, "../app/OnboardingWindow.swift"),
  "utf8",
);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name} - host-first waits without reporting completion`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name} - ${error.message.split("\n")[0]}`);
  }
}

test("Q0543 host-first onboarding holds until a connected client exists", () => {
  assert.match(
    onboardingWindow,
    /connectedClients:\s*\(\)\s*=>\s*post\('connectedClients',\s*\[\]\)/,
    "host bridge must expose connectedClients() so no-client state is observable",
  );
  assert.match(
    stepWaiting,
    /window\.xpair\s*\.\s*connectedClients\(\)/,
    "Connect/Waiting step must poll the real connected-client list",
  );
  assert.match(
    stepWaiting,
    /const connected\s*=\s*clients\.length\s*>\s*0/,
    "Connect/Waiting step must derive connected state from the client list",
  );

  const appUsesClientStateBeforeDone =
    /connectedClients\(\)[\s\S]{0,500}(?:w\.goTo\([^)]*4|w\.next\(\)|complete\(\))/.test(app) ||
    /w\.index\s*===\s*3[\s\S]{0,300}(?:clients?\.length|connected|hasClient|clientReady)/.test(app);

  assert.ok(
    appUsesClientStateBeforeDone,
    "App.tsx can advance from Connect to Done without checking connectedClients()/client state",
  );
});

console.log(`REDGREEN ${passed} ${failed}`);
process.exit(failed ? 1 : 0);
