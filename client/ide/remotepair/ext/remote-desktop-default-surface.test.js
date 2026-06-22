const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const extension = fs.readFileSync(path.join(root, "extension.js"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const productOverlay = JSON.parse(
  fs.readFileSync(path.join(root, "../product.overlay.json"), "utf8"),
);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS ${name} - Remote Desktop is the default reusable editor surface`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name} - ${error.message.split("\n")[0]}`);
  }
}

function indexOfOrThrow(source, needle) {
  const index = source.indexOf(needle);
  assert.notStrictEqual(index, -1, `missing ${needle}`);
  return index;
}

test("Q0402 Q0474 startup opens one reusable Remote Desktop editor tab instead of a welcome screen", () => {
  assert.ok(pkg.activationEvents.includes("onStartupFinished"));
  assert.equal(pkg.contributes.configurationDefaults["workbench.startupEditor"], "none");
  assert.equal(productOverlay.configurationDefaults["workbench.startupEditor"], "none");

  const constructPanel = indexOfOrThrow(
    extension,
    "const panel = new RemoteDesktopPanel(context.extensionUri);",
  );
  const autoReveal = indexOfOrThrow(extension, "panel.reveal().catch");
  const layoutReveal = indexOfOrThrow(extension, "panel\n    .reveal()\n    .then(() => setupLayout");
  assert.ok(constructPanel < autoReveal, "activate() must create the RD panel before startup reveal");
  assert.ok(constructPanel < layoutReveal, "layout must be chained after RD reveal");

  assert.match(extension, /vscode\.window\.createWebviewPanel\(\s*"remotepair\.remoteDesktop",\s*"RD",\s*\{ viewColumn: vscode\.ViewColumn\.Active, preserveFocus: false \}/);
  assert.match(extension, /vscode\.commands\.registerCommand\("remotepair\.openRemoteDesktop", \(\) => panel\.reveal\(\)\)/);
  assert.match(extension, /vscode\.window\.registerWebviewPanelSerializer\("remotepair\.remoteDesktop"/);

  const reuseExistingPanel = indexOfOrThrow(extension, "if (this.panel) {");
  const createPanel = indexOfOrThrow(extension, "vscode.window.createWebviewPanel");
  assert.ok(reuseExistingPanel < createPanel, "reveal() must reuse its live singleton before creating a panel");
  assert.match(extension, /this\.panel\.reveal\(this\.panel\.viewColumn \|\| vscode\.ViewColumn\.Active, false\)/);
  assert.match(extension, /for \(const g of vscode\.window\.tabGroups\.all\)/);
  assert.match(extension, /vt\.indexOf\("remotepair\.remoteDesktop"\) !== -1/);
  assert.match(extension, /RD: an RD tab already exists[\s\S]*return;/);
  assert.match(extension, /if \(this\.panel && this\.panel !== panel\) \{[\s\S]*panel\.dispose\(\);[\s\S]*return;[\s\S]*\}/);
});

console.log(`${__filename}`);
console.log(`REDGREEN ${passed} ${failed}`);
process.exit(failed ? 1 : 0);
