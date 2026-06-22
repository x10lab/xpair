const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const app = fs.readFileSync(path.join(root, "onboarding-webview/src/App.tsx"), "utf8");
const stepDiscover = fs.readFileSync(
  path.join(root, "onboarding-webview/src/components/onboarding/client/StepDiscover.tsx"),
  "utf8",
);
const xpair = fs.readFileSync(path.join(root, "../../..", "cli/xpair"), "utf8");

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

function assertPatternBefore(source, first, second, message) {
  const a = source.search(first);
  const b = source.search(second);
  assert.notEqual(a, -1, `missing first pattern: ${first}`);
  assert.notEqual(b, -1, `missing second pattern: ${second}`);
  assert.ok(a < b, message);
}

test("first connection scans Bonjour LAN first and offers discovered host rows (Q0382/Q0384)", () => {
  assert.match(app, /WELCOME: 0,[\s\S]*CONSENT: 1,[\s\S]*DISCOVER: 2,[\s\S]*CONNECT: 3,/);
  assert.match(app, /const onSelectPeer = useCallback\([\s\S]*setPeer\(p\);[\s\S]*w\.goTo\(S\.CONNECT, "next"\);/);
  assert.match(app, /w\.index === S\.DISCOVER &&[\s\S]*<StepDiscover onSelect=\{onSelectPeer\} onManual=\{onManual\} \/>/);

  assert.match(stepDiscover, /window\.remotepair\.discover\(\)/);
  assertPatternBefore(
    stepDiscover,
    /Scanline label="Bonjour .*same Wi-Fi"/,
    /Scanline label="Tailscale .*your tailnet"/,
    "Bonjour LAN scan must be presented before Tailscale fallback scan",
  );
  assertPatternBefore(
    stepDiscover,
    /if \(!scannedOnce\) return <Scanning \/>;/,
    /if \(peers\.length === 0\) return <EmptyDiagnose onManual=\{onManual\} \/>;/,
    "fallback UI must wait until the LAN scan has completed once",
  );
  assert.match(stepDiscover, /connect: "Connect"/);
  assert.match(stepDiscover, /reconnect: "Reconnect"/);
  assert.match(stepDiscover, /onClick=\{\(\) => onSelect\(peer\)\}/);

  assert.match(xpair, /RP_BONJOUR_TYPE="_xpair\._tcp"/);
  assert.match(xpair, /dns-sd -t "\$timeout" -B "\$RP_BONJOUR_TYPE"/);
  assertPatternBefore(
    xpair,
    /LAN: Bonjour browse/,
    /Tailscale: parse `tailscale status --json` peers/,
    "xpair discover must collect Bonjour LAN candidates before Tailscale candidates",
  );
});

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
}

console.log("\nall LAN-first onboarding tests passed");
