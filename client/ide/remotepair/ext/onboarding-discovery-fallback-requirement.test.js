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
const bridge = fs.readFileSync(path.join(root, "onboarding-bridge.js"), "utf8");
const cli = fs.readFileSync(path.join(root, "../../../cli/xpair"), "utf8");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name} - ${error && error.message ? error.message.split("\n")[0] : error}`);
  }
}

test("Q0383/Q0384 no LAN host guides to Tailscale or manual fallback path", () => {
  assert.match(cli, /RP_BONJOUR_TYPE="_xpair\._tcp"/, "discovery must include LAN Bonjour");
  assert.match(cli, /rp_tailscale_bin\(\)/, "discovery must include Tailscale fallback probing");
  assert.match(bridge, /cli\(\["discover", "--json"\]\)/, "onboarding bridge must call real xpair discovery");

  assert.match(stepDiscover, /<Scanline label="Bonjour · same Wi-Fi" \/>/);
  assert.match(stepDiscover, /<Scanline label="Tailscale · your tailnet" \/>/);
  assert.match(stepDiscover, /Empty: scanned, nothing found → diagnosis FIRST, then fallbacks/);
  assert.match(stepDiscover, /On the same Wi-Fi\?/);
  assert.match(stepDiscover, /use\s+Tailscale below/s);
  assert.match(stepDiscover, /title="Connect over Internet \(Uses Tailscale\)"/);
  assert.match(stepDiscover, /title="Enter host manually"/);
  assert.ok(
    (stepDiscover.match(/onClick={onManual}/g) || []).length >= 2,
    "both Tailscale and manual fallback choices should continue through the manual connect path",
  );

  assert.match(app, /const onManual = useCallback\(\(\) => \{/);
  assert.match(app, /setManual\(true\);/);
  assert.match(app, /setPeer\(null\);/);
  assert.match(app, /w\.goTo\(S\.CONNECT, "next"\);/);
  assert.match(app, /manual \|\| isConnect \|\| !peer \?/);
  assert.match(app, /<StepConnect[\s\S]*host={host}[\s\S]*setHost={setHost}/);

  assert.match(stepConnect, /window\.remotepair\.tailscaleStatus\(\)/);
  assert.match(stepConnect, /Install Tailscale for zero-config reachability, or use a reachable SSH host below\./);
});

console.log(`REDGREEN ${passed} ${failed}`);
process.exit(failed ? 1 : 0);
