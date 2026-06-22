const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const app = fs.readFileSync(path.join(root, "onboarding-webview/src/App.tsx"), "utf8");
const bridge = fs.readFileSync(path.join(root, "onboarding-bridge.js"), "utf8");
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

test("Q0533/Q0534/Q0536/Q0537 xpair CLI availability is a hard gate before CLI-dependent flows", () => {
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
    app,
    /const CLI_DEPENDENT_STEPS:[\s\S]*S\.DISCOVER,[\s\S]*S\.CONNECT,[\s\S]*S\.ENGINE,[\s\S]*S\.MAPPINGS,/,
    "Discover, Connect, Engine, and Mappings must be marked CLI-dependent",
  );
  assert.match(
    app,
    /const cliGateActive = CLI_DEPENDENT_STEPS\.has\(w\.index\) && cliMissing;/,
    "CLI gate must activate only on CLI-dependent steps when xpair is missing",
  );
  assert.match(
    app,
    /const nextDisabled =[\s\S]*cliGateActive[\s\S]*w\.index === S\.DISCOVER[\s\S]*w\.index === S\.CONNECT/,
    "Next must be disabled by the CLI gate before manual/connect work can proceed",
  );
  assert.match(
    app,
    /waiting for xpair CLI/,
    "blocked CLI-dependent steps must show a waiting reason",
  );
  assert.match(
    app,
    /xpair CLI install failed/,
    "failed CLI install must show a failure reason",
  );
  assert.match(
    app,
    /onClick=\{\(\) => void installCliNow\(\)\}/,
    "failed CLI install must wire Retry back to installCliNow",
  );
  assert.match(
    app,
    />\s*Retry\s*<\/Button>/,
    "failed CLI install must expose a retry path instead of silently continuing",
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
