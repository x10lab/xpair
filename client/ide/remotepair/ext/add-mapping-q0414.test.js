const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const extension = fs.readFileSync(path.join(root, "extension.js"), "utf8");
const idePatch = fs.readFileSync(
  path.resolve(root, "../patches/zz-remotepair-ide-frontend.patch"),
  "utf8",
);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS ${name} - Browser maps host folders through Xpair Add Root`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name} - ${error.message.split("\n")[0]}`);
  }
}

function extractFunction(source, name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") depth--;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name} body could not be parsed`);
}

test("Q0414 Client Browser uses Add Mapping/Add Root, not generic Open Folder", () => {
  assert.match(
    idePatch,
    /only the RemotePair Add Root welcome shows/,
    "Native empty Browser Open Folder welcome must be suppressed",
  );
  assert.match(
    idePatch,
    /command:remotepair\.browser\.addRoot/,
    "Empty Browser state must route users to the Xpair Add Root command",
  );
  assert.match(
    idePatch,
    /ContextKeyExpr\.false\(\)[\s\S]*hide the stock "Open Folder"/,
    "Native File > Open Folder must be hidden for the Xpair Browser flow",
  );
  assert.match(
    idePatch,
    /executeCommand\('remotepair\.browser\.addRoot'\)/,
    "The Browser Add Root affordance must execute the Xpair mapping command",
  );

  assert.match(
    extension,
    /registerCommand\("remotepair\.browser\.addRoot"/,
    "The extension must register the command used by the Browser Add Root affordance",
  );
  const addRoot = extractFunction(extension, "addRoot");
  assert.match(addRoot, /showInputBox\(\{[\s\S]*HOST folder path/, "Add Root must ask for a host path");
  assert.match(
    addRoot,
    /runXpairCli\(\["mount", host\]/,
    "Add Root must mount the host folder first",
  );
  assert.match(
    addRoot,
    /runXpairCli\(\["map", "add", mountpoint, host\]/,
    "Add Root must register the mountpoint as a folder mapping",
  );
  assert.match(
    addRoot,
    /reconcileBrowserRoots\(\)/,
    "Add Root must add the mapped mountpoint to Browser roots",
  );
  assert.doesNotMatch(
    addRoot,
    /vscode\.openFolder|workbench\.action\.addRootFolder/,
    "Add Root must not fall back to arbitrary local Open Folder",
  );
});

console.log(`REDGREEN ${passed} ${failed}`);
process.exit(failed ? 1 : 0);
