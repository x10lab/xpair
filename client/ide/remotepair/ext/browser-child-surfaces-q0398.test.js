const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const patch = fs.readFileSync(
  path.join(root, "../patches/zz-remotepair-ide-frontend.patch"),
  "utf8",
);
const extension = fs.readFileSync(path.join(root, "extension.js"), "utf8");

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

test("Search and Extensions are Browser child surfaces without breaking mapping SSOT (Q0398)", () => {
  assert.match(extension, /function reconcileBrowserRoots\(\)[\s\S]*const maps = readFolderMaps\(\)/);
  assert.match(extension, /Target == FOLDER_MAPS clientDirs only/);
  assert.match(extension, /vscode\.commands\.registerCommand\("remotepair\.browser\.addRoot"/);

  assert.match(patch, /export const REMOTEPAIR_SEARCH_VIEW_ID = 'remotepair\.browser\.search'/);
  assert.match(patch, /registerViews\(\[remotePairSearchViewDescriptor\], VIEW_CONTAINER\)/);
  assert.match(patch, /routeToSearch\(accessor\);/);
  assert.doesNotMatch(
    patch.match(/id: 'remotepair\.browser\.search'[\s\S]*?run\(accessor: ServicesAccessor\): void \{[\s\S]*?\n\+\t\}/)?.[0] || "",
    /workbench\.action\.findInFiles|workbench\.view\.search|openViewContainer\(/,
    "Search must stay inside the Browser frame instead of opening the global Search surface",
  );

  assert.match(patch, /id: 'remotepair\.browser\.extensions'/);
  assert.doesNotMatch(
    patch.match(/id: 'remotepair\.browser\.extensions'[\s\S]*?run\(accessor: ServicesAccessor\): void \{[\s\S]*?\n\+\t\}/)?.[0] || "",
    /workbench\.view\.extensions|openViewContainer\(/,
    "Extensions must be a Browser child/helper surface, not a global viewlet escape",
  );
});

if (failed > 0) {
  console.error(`\n${failed} test(s) FAILED`);
  process.exit(1);
}

console.log("\nall Q0398 Browser child-surface tests passed");
