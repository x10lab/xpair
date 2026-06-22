const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const extension = fs.readFileSync(path.join(root, "extension.js"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL - ${name}\n        ${error && error.message ? error.message : error}`);
  }
}

check("Q0183 Q0261 Q0474 Connect routes host selection through Xpair surfaces", () => {
  assert.ok(pkg.contributes.commands.some((cmd) => cmd.command === "remotepair.connectHost"));
  assert.match(extension, /vscode\.commands\.registerCommand\("remotepair\.connectHost", \(\) => connectHost\(panel\)\)/);

  assert.match(extension, /async function _doConnectHost\(host, panel\) \{[\s\S]+sshRun\(host, "true", \{ timeoutMs: 6000 \}\)/);
  assert.match(extension, /let clientDirs = reconcileBrowserRoots\(\);/);
  assert.match(extension, /vscode\.commands\.executeCommand\("remotepair\.terminalSidebar"\)/);
  assert.match(extension, /vscode\.commands\.executeCommand\("remotepair\.sessions\.attached\.view\.focus", \{ preserveFocus: true \}\)/);
  assert.match(extension, /if \(clientDirs\.length === 0\) \{[\s\S]+vscode\.commands\.executeCommand\("workbench\.view\.explorer"\)[\s\S]+await addRoot\(\);/);
  assert.match(extension, /launchRemoteClaude\(\);/);
  assert.match(extension, /await panel\.reveal\(\);[\s\S]+panel\.refresh\(\);/);
  assert.match(extension, /detail: `Recover Xpair connection, mappings, sessions, and RD for \$\{host\}`/);
  assert.match(extension, /await _doConnectHost\(picked\.host, panel\);/);
  assert.doesNotMatch(extension, /vscode\.openFolder/);
  assert.doesNotMatch(extension, /openremotessh\.openEmptyWindow/);

  assert.match(extension, /let hostReachable = null;/);
  assert.match(extension, /const probeHost = async \(\) => \{[\s\S]+const r = await sshRun\(host, "true", \{ timeoutMs: 6000 \}\);[\s\S]+hostReachable = ok;[\s\S]+renderHostButton\(\);/);
  assert.match(extension, /telemetry\.EVENTS\.HOST_CONNECTED/);

  assert.match(extension, /panel\.reveal\(\)[\s\S]+setupLayout\(context, false\)/);
  assert.match(extension, /vscode\.commands\.executeCommand\("remotepair\.terminalSidebar"\);/);
  assert.match(extension, /reconcileBrowserRoots\(\);/);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
}

console.log("\nall SSH connect flow requirement tests passed");
