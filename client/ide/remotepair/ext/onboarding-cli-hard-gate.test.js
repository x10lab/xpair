const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const app = fs.readFileSync(path.join(root, "onboarding-webview/src/App.tsx"), "utf8");
const bridge = fs.readFileSync(path.join(root, "onboarding-bridge.js"), "utf8");
const onboardingMain = fs.readFileSync(path.join(root, "onboarding-main.cjs"), "utf8");
const extension = fs.readFileSync(path.join(root, "extension.js"), "utf8");
const cli = fs.readFileSync(path.join(root, "../../../cli/xpair"), "utf8");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name} - CLI-dependent onboarding flow is gated on xpair availability`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name} - ${error.message.split("\n")[0]}`);
  }
}

test("Q0533/Q0534/Q0536/Q0537 xpair CLI availability is a native pre-workbench hard gate", () => {
  assert.match(
    bridge,
    /async cliReady\(\)[\s\S]*const bin = rpBinAbs\(\);[\s\S]*if \(!bin\)[\s\S]*xpair CLI not found at ~\/\.local\/bin\/xpair[\s\S]*run\(bin, \["status"\]\)/,
    "cliReady must resolve a real xpair binary and prove it with xpair status",
  );
  assert.match(
    bridge,
    /async installCli\(\)[\s\S]*shared", "install\.sh"[\s\S]*run\("bash", \[installer, "--role", "client"\][\s\S]*if \(!rpBinAbs\(\)\)/,
    "installCli must use the bundled installer and re-check that xpair actually landed",
  );

  assert.match(
    onboardingMain,
    /const cli = await probeBridge\.cliReady\(\)[\s\S]*if \(!cli \|\| cli\.ready !== true\) return START_STEP\.WELCOME/,
    "firstFailingGuard must stop at Welcome when the CLI is missing",
  );
  assert.match(
    onboardingMain,
    /catch \{\s*return START_STEP\.WELCOME\s*\}[\s\S]*probeBridge\.sshReachable\(host\)/,
    "CLI probe failures must happen before any remote host probe",
  );
  assert.doesNotMatch(
    app,
    /CLI_DEPENDENT_STEPS|cliGateActive|installCliNow|StepConnect/,
    "the redesign moved CLI gating out of the renderer and removed the old StepConnect gate",
  );

  assert.match(
    extension,
    /term\.sendText\("xpair launch", false\)/,
    "Sessions must stage xpair launch for the user to enter the launch flow",
  );
  assert.match(
    cli,
    /launch\)\s+shift; cmd_launch "\$@"[\s\S]*\*\) echo "unknown command: \$1" >&2[\s\S]*exit 2/,
    "xpair launch must route to cmd_launch and unknown commands must fail",
  );
});

console.log(`REDGREEN ${passed} ${failed}`);
process.exit(failed ? 1 : 0);
