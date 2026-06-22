const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const stepConnect = fs.readFileSync(
  path.join(root, "onboarding-webview/src/components/onboarding/client/StepConnect.tsx"),
  "utf8",
);

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

test("Q0384 SSH failure shows the error and offers a local fallback path", () => {
  const failureMarker = '{(state === "failed" || state === "rekeyed") && (';
  const start = stepConnect.indexOf(failureMarker);
  assert.notEqual(start, -1, "StepConnect must render a dedicated SSH failure state");

  const failureBlock = stepConnect.slice(start);
  assert.match(failureBlock, /state === "rekeyed"\s*\?\s*"Host identity changed"\s*:\s*"Couldn't reach host"/);
  assert.match(failureBlock, /err \|\| "SSH probe failed\."/);

  assert.match(
    failureBlock,
    /Re-discover|Enter manually|local fallback|Use local|Use reachable SSH host|Back to discovery/i,
    "SSH failure UI should offer a non-retry local fallback after Tailscale/manual correction cannot connect",
  );
});

console.log(`REDGREEN ${passed} ${failed}`);
process.exit(failed ? 1 : 0);
