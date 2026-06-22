const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const app = fs.readFileSync(path.join(__dirname, "src/App.tsx"), "utf8");
const globalTypes = fs.readFileSync(path.join(__dirname, "src/global.d.ts"), "utf8");
const stepWelcome = fs.readFileSync(
  path.join(__dirname, "src/components/onboarding/host/StepWelcome.tsx"),
  "utf8",
);
const stepDone = fs.readFileSync(
  path.join(__dirname, "src/components/onboarding/host/StepDone.tsx"),
  "utf8",
);
const consentControls = fs.readFileSync(
  path.join(__dirname, "src/components/onboarding/host/ConsentControls.tsx"),
  "utf8",
);
const onboardingWindow = fs.readFileSync(
  path.join(root, "host/app/OnboardingWindow.swift"),
  "utf8",
);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS ${name} - host onboarding exposes and persists the opt-in decision`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name} - ${error.message.split("\n")[0]}`);
  }
}

test("Q0448 host onboarding exposes telemetry and crash opt-in choices before and after completion", () => {
  assert.match(app, /w\.index === 0 && <StepWelcome \/>/);
  assert.match(app, /w\.index === 4 && <StepDone \/>/);
  assert.match(stepWelcome, /<ConsentControls variant="prompt" \/>/);
  assert.match(stepDone, /<ConsentControls variant="summary" \/>/);

  assert.match(globalTypes, /getConsent: \(\) => Promise<\{ telemetry: boolean; crash: boolean \}>/);
  assert.match(globalTypes, /setConsent: \(c: \{ telemetry: boolean; crash: boolean \}\) => Promise<void>/);

  assert.match(consentControls, /window\.xpair\.getConsent\(\)/);
  assert.match(consentControls, /setTelemetryOn\(\!\!c\.telemetry\)/);
  assert.match(consentControls, /setCrashOn\(\!\!c\.crash\)/);
  assert.match(consentControls, /window\.xpair\.setConsent\(\{ telemetry: t, crash: c \}\)/);
  assert.match(consentControls, /title="Share anonymous usage analytics"/);
  assert.match(consentControls, /title="Send anonymized crash reports"/);
  assert.match(consentControls, /onChange=\{\(v\) => persist\(v, crashOn\)\}/);
  assert.match(consentControls, /onChange=\{\(v\) => persist\(telemetryOn, v\)\}/);

  assert.match(onboardingWindow, /getConsent: \(\) => post\('getConsent', \[\]\)/);
  assert.match(onboardingWindow, /setConsent: \(c\) => post\('setConsent', \[c\]\)/);
  assert.match(onboardingWindow, /case "getConsent":[\s\S]*TelemetryClient\.consentKey[\s\S]*SentryBridge\.consentKey/);
  assert.match(onboardingWindow, /case "setConsent":[\s\S]*c\["telemetry"\][\s\S]*TelemetryClient\.consentKey/);
  assert.match(onboardingWindow, /case "setConsent":[\s\S]*c\["crash"\][\s\S]*SentryBridge\.consentKey/);
});

console.log(`${__filename}`);
console.log(`REDGREEN ${passed} ${failed}`);
process.exit(failed ? 1 : 0);
