const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const app = fs.readFileSync(path.join(root, "onboarding-webview/src/App.tsx"), "utf8");
const main = fs.readFileSync(path.join(root, "onboarding-main.cjs"), "utf8");
const preload = fs.readFileSync(path.join(root, "onboarding-preload.cjs"), "utf8");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name} - completion is gated on finished setup`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name} - ${error.message.split("\n")[0]}`);
  }
}

function stripLineComments(source) {
  return source
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

test("Q0369 Q0402 Q0474 client onboarding closes only after necessary setup completes", () => {
  assert.match(
    app,
    /const runLivenessCheck\s*=\s*useCallback[\s\S]*w\.goTo\(S\.DONE,\s*"next"\)/,
    "React onboarding must only land on Done after the host liveness check succeeds",
  );
  assert.match(
    app,
    /w\.index\s*===\s*S\.MAPPINGS[\s\S]{0,160}runLivenessCheck\(\)/,
    "Mappings/finish path must run liveness before Done",
  );
  assert.match(
    preload,
    /complete:\s*\(\)\s*=>\s*\{[\s\S]*ipcRenderer\.invoke\('onboarding:complete'\)/,
    "renderer completion must use the explicit onboarding:complete channel",
  );

  const uncommentedMain = stripLineComments(main);
  const closedStart = uncommentedMain.indexOf("_win.on('closed'");
  assert.notEqual(closedStart, -1, "onboarding-main.cjs must define a closed handler");
  const closedEnd = uncommentedMain.indexOf("return _win", closedStart);
  assert.notEqual(closedEnd, -1, "closed handler must appear before returning the window");
  const closedHandler = uncommentedMain.slice(closedStart, closedEnd);

  assert.doesNotMatch(
    closedHandler,
    /!\s*_completed[\s\S]*onComplete\s*\(/,
    "closing the onboarding window before completion must not call onComplete/open the workbench",
  );
});

console.log(`REDGREEN ${passed} ${failed}`);
process.exit(failed ? 1 : 0);
