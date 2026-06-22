const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const app = fs.readFileSync(path.join(root, "src/App.tsx"), "utf8");
const stepEngine = fs.readFileSync(
  path.join(root, "src/components/onboarding/host/StepEngine.tsx"),
  "utf8",
);
const hostAppRoot = path.resolve(root, "../app");
const engineGuard = fs.readFileSync(path.join(hostAppRoot, "EngineGuard.swift"), "utf8");
const onboardingWindow = fs.readFileSync(path.join(hostAppRoot, "OnboardingWindow.swift"), "utf8");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS ${name} - selected engine is gated on installed+authed`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name} - ${error.message.split("\n")[0]}`);
  }
}

test("Q0541 host onboarding checks, installs, authenticates, and rechecks selected engines", () => {
  assert.match(
    app,
    /w\.index === 2 && !engineReady/,
    "Engine step Next must remain disabled until the selected engine reports ready",
  );
  assert.match(
    stepEngine,
    /onReady\(r\.installed && r\.authed\)/,
    "Engine probe must mark ready only when installed and authenticated are both true",
  );
  assert.match(
    stepEngine,
    /catch \(err\) \{[\s\S]*onReady\(false\);[\s\S]*\}/,
    "Probe errors must keep engine ready false and surface a reason",
  );
  assert.match(
    stepEngine,
    /window\.xpair\.installEngine\(engine\)[\s\S]*await probe\(engine\)/,
    "Install action must re-check the same selected engine after installation",
  );
  assert.match(
    stepEngine,
    /window\.xpair\.setEngineAuth\(engine, apiKey\.trim\(\)\)[\s\S]*await probe\(engine\)/,
    "API key sign-in must re-check the same selected engine after auth setup",
  );
  assert.ok(
    stepEngine.includes('re-check') && stepEngine.includes("onClick={() => void probe(engine)}"),
    "External login path must offer a re-check action for the same selected engine",
  );

  for (const engine of ["claude", "codex", "opencode"]) {
    assert.ok(stepEngine.includes(`id: "${engine}"`), `${engine} must be selectable in host onboarding`);
    assert.ok(engineGuard.includes(`engine == "${engine}"`), `${engine} must be accepted by the host guard`);
    assert.ok(engineGuard.includes(`command -v ${engine}`), `${engine} install probe must check the real binary`);
  }
  assert.match(engineGuard, /RP_ENGINE_AUTHED=1/, "The host guard must report an authenticated state");
  assert.match(engineGuard, /brew install --quiet claude/, "Claude install guidance/action must exist");
  assert.match(engineGuard, /brew install --quiet codex/, "Codex install guidance/action must exist");
  assert.match(engineGuard, /brew install --quiet opencode/, "opencode install guidance/action must exist");
  assert.match(
    onboardingWindow,
    /case "engineStatus":[\s\S]*EngineGuard\.status\(engine\)/,
    "WK bridge must wire engineStatus to the real host guard",
  );
  assert.match(
    onboardingWindow,
    /case "installEngine":[\s\S]*EngineGuard\.install\(engine\)/,
    "WK bridge must wire installEngine to the real host guard",
  );
  assert.match(
    onboardingWindow,
    /case "setEngineAuth":[\s\S]*EngineGuard\.setAuth\(engine, key: key\)/,
    "WK bridge must wire setEngineAuth to the real host guard",
  );
});

console.log(`REDGREEN ${passed} ${failed}`);
process.exit(failed ? 1 : 0);
