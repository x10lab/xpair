const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const stepConnectPin = fs.readFileSync(path.join(root, "StepConnectPin.tsx"), "utf8");
const stepSetupPassword = fs.readFileSync(path.join(root, "StepSetupPassword.tsx"), "utf8");

const panel = stepConnectPin.slice(
  stepConnectPin.indexOf("export function FingerprintPanel"),
  stepConnectPin.length,
);

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   - ${name}`);
  } catch (error) {
    failed++;
    console.error(`  FAIL - ${name}`);
    console.error(`         ${error.message.split("\n")[0]}`);
  }
}

test("host key fingerprint stays hidden by default and is revealed only on expansion (Q0430)", () => {
  assert.notEqual(panel.length, 0, "FingerprintPanel must exist in StepConnectPin.tsx");

  assert.match(stepConnectPin, /<FingerprintPanel host=\{peer\.name\} fp=\{fp\}/);
  assert.match(stepSetupPassword, /<FingerprintPanel host=\{peer\.name\} fp=\{fp\} firstTime/);
  assert.match(stepConnectPin, /hostKeyFingerprint\(peer\.addrs\[0\] \|\| peer\.name\)/);
  assert.match(stepSetupPassword, /hostKeyFingerprint\(peer\.addrs\[0\] \|\| peer\.name\)/);

  const hasRevealControl =
    /<details\b/.test(panel) ||
    /aria-expanded/.test(panel) ||
    /(showFingerprint|showFp|expanded|setShowFingerprint|setShowFp|setExpanded)/.test(panel);
  assert.ok(
    hasRevealControl,
    "FingerprintPanel must have an explicit disclosure control so the fingerprint is hidden by default",
  );

  assert.doesNotMatch(
    panel,
    /\{\s*fp\s*\|\|\s*"fetching\.\.\."\s*\}/,
    "FingerprintPanel currently renders the fingerprint immediately instead of only inside the expanded branch",
  );
});

console.log(failed ? `\n${failed} test(s) failed` : "\nhost key fingerprint tests passed");
process.exit(failed ? 1 : 0);
