const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const extension = fs.readFileSync(path.join(root, "extension.js"), "utf8");
const frontendPatch = fs.readFileSync(path.join(root, "../patches/zz-remotepair-ide-frontend.patch"), "utf8");

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL - ${name}`);
    console.error(`         ${error.message.split("\n")[0]}`);
  }
}

test("Browser shows mapped roots and only offers Add Root/Add Mapping flow from Sessions (Q0398 Q0414 Q0480)", () => {
  assert.match(extension, /function reconcileBrowserRoots\(\)/);
  assert.match(extension, /const maps = readFolderMaps\(\)/);
  assert.match(extension, /const alreadyCorrect =\s*current\.length === clientDirs\.length &&\s*clientDirs\.every\(\(d, i\) => current\[i\] === d\)/);
  assert.match(extension, /vscode\.workspace\.updateWorkspaceFolders\(\s*0,\s*current\.length,\s*\.\.\.clientDirs\.map\(\(d\) => \(\{ uri: vscode\.Uri\.file\(d\) \}\)\)\s*\)/);
  assert.match(extension, /vscode\.commands\.registerCommand\("remotepair\.openFileBrowser"/);
  assert.match(extension, /const clientDirs = reconcileBrowserRoots\(\)/);
  assert.match(extension, /vscode\.commands\.executeCommand\("workbench\.view\.explorer"\)/);

  assert.match(extension, /vscode\.commands\.registerCommand\("remotepair\.browser\.addRoot"/);
  assert.match(extension, /title: "Xpair — Add Root \(mount a host folder\)"/);
  assert.match(extension, /runXpairCli\(\["mount", host\]/);
  assert.match(extension, /runXpairCli\(\["map", "add", mountpoint, host\]/);
  assert.match(extension, /reconcileBrowserRoots\(\)/);

  assert.match(frontendPatch, /id: 'remotepair\.browser\.backToSessions'/);
  assert.match(frontendPatch, /openViewContainer\('remotepair\.terminalSidebar', true\)/);
  assert.match(frontendPatch, /DOM\.append\(rpButton, DOM\.\$\(\'span\.rp-add-root-label\'\)\)\.textContent = nls\.localize\('remotepairAddRoot', "Add Root"\)/);
  assert.match(frontendPatch, /const rpRun = \(\) => this\.commandService\.executeCommand\('remotepair\.browser\.addRoot'\)/);
  assert.match(frontendPatch, /No mapped folders yet\.\\n\[\$\(rocket\) Add Root\]\(command:remotepair\.browser\.addRoot\)\\nMounts a host folder and adds it as a Browser root\./);
  assert.match(frontendPatch, /WorkbenchStateContext\.notEqualsTo\('empty'\)/);
  assert.match(frontendPatch, /The row-1\s*\n\+ \*      "Add Mapping" action was removed/);
  assert.doesNotMatch(frontendPatch, /id: 'remotepair\.browser\.openFolder'/);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
}

console.log("\nall Browser mapping contract tests passed");
