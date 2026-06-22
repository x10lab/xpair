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

check("Q0183 Q0261 Q0474 Connect opens a new SSH remote window and continues into Xpair status surfaces", () => {
  assert.ok(pkg.contributes.commands.some((cmd) => cmd.command === "remotepair.connectHost"));
  assert.match(extension, /vscode\.commands\.registerCommand\("remotepair\.connectHost", \(\) => connectHost\(\)\)/);

  assert.match(extension, /async function _doConnectHost\(host\) \{[\s\S]+scheme: "vscode-remote"[\s\S]+authority: `ssh-remote\+\$\{host\}`/);
  assert.match(extension, /await vscode\.commands\.executeCommand\("vscode\.openFolder", uri, \{ forceNewWindow: true \}\);/);
  assert.match(extension, /detail: `Connect to \$\{host\} via Open Remote - SSH`/);
  assert.match(extension, /await _doConnectHost\(picked\.host\);/);

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
