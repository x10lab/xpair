// Host onboarding step-gating tests.
//
// Each test encodes a requirements.md-backed IDEAL (예상) and asserts it against the actual
// host onboarding source (현행). A failing test = the implementation does not yet match the ideal.
// Run: `node host/onboarding/onboarding-gate.test.js`
//
// Provenance: derived from docs/verification (flow-tree 예상 verified against docs/requirements.md).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const app = fs.readFileSync(path.join(root, "src/App.tsx"), "utf8");

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

// Q0443 / §1.5 — Permissions step must gate Next on required grants (AX + SR). [BACKED, expected GREEN]
test("permissions step gates Next on AX + SR (Q0443)", () => {
  assert.match(app, /perm\.ax === "granted" && perm\.sr === "granted"/);
  assert.match(app, /w\.index === 1 && !ready/);
});

// Q0541 / §1.3 — Engine step must gate Next on engine installed+signed-in. [BACKED, expected GREEN]
test("engine step gates Next on engineReady (Q0541)", () => {
  assert.match(app, /w\.index === 2 && !engineReady/);
});

// Q0543 / §1.5 — With NO connected client, host onboarding must HOLD at the connect step and must
// NOT report completion. The Connect step (index 3) must gate Next/complete on a connected client.
// [BACKED ideal; expected RED against current code — nextDisabled ignores index 3 → confirms defect]
test("connect step holds until a client connects, does not complete clientless (Q0543)", () => {
  assert.match(
    app,
    /w\.index === 3 &&[^)]*\b(connected|clients?\.length|hasClient)\b/i,
    "Connect step (index 3) is not gated on a connected client — clientless completion is possible",
  );
});

console.log(failed ? `\n${failed} test(s) failed` : "\nall host onboarding gate tests passed");
process.exit(failed ? 1 : 0);
