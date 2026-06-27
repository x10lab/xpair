const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const app = fs.readFileSync(path.join(root, "onboarding-webview/src/App.tsx"), "utf8");
const stepDiscover = fs.readFileSync(
  path.join(root, "onboarding-webview/src/components/onboarding/client/StepDiscover.tsx"),
  "utf8",
);
const stepConnect = fs.readFileSync(
  path.join(root, "onboarding-webview/src/components/onboarding/client/StepConnect.tsx"),
  "utf8",
);

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL - ${name}`);
    console.error(`         ${error && error.message ? error.message.split("\n")[0] : error}`);
  }
}

test("manual host input remains available when Tailscale is only a fallback (Q0383)", () => {
  assert.match(app, /const onManual = useCallback\(\(\) => \{[\s\S]*setManual\(true\);[\s\S]*setPeer\(null\);[\s\S]*w\.goTo\(S\.CONNECT, "next"\);[\s\S]*\}, \[w\]\);/);
  assert.match(stepDiscover, /if \(peers\.length === 0\) return <EmptyDiagnose onManual=\{onManual\} \/>;/);
  assert.match(stepDiscover, /title="Connect over Internet \(Uses Tailscale\)"[\s\S]*onClick=\{onManual\}/);
  assert.match(stepDiscover, /title="Enter host manually"[\s\S]*onClick=\{onManual\}/);

  assert.match(stepConnect, /const ts = await window\.remotepair\.tailscaleStatus\(\);/);
  assert.match(stepConnect, /setTailscale\(\{ installed: false, up: false \}\);/);
  assert.match(stepConnect, /disabled=\{state === "checking" \|\| !host\.trim\(\)\}/);
  assert.doesNotMatch(
    stepConnect,
    /disabled=\{[^}]*tailscale[^}]*\}/,
    "manual SSH check must not be disabled by Tailscale install/run state",
  );
});

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
}

console.log("\nall Tailscale fallback onboarding tests passed");
