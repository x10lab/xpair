// per-mapping-method-readback — the per-mapping access method (FOLDER_MAP_MODES) must be the
// SOURCE OF TRUTH on READ-BACK, not just on write. Regression guard for the architect-flagged gap
// where getConfig had `m.method` in hand from `map list --json` but dropped it, so the UI/gates
// silently fell back to path-convention inference (mis-classifying custom-mountpoint mounts as sync,
// making Gate 2 skip their mount verification).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const extRoot = __dirname;
const bridge = fs.readFileSync(path.join(extRoot, "onboarding-bridge.js"), "utf8");
const webview = path.join(extRoot, "onboarding-webview", "src");
const stepFileAccess = fs.readFileSync(
  path.join(webview, "components/onboarding/client/StepFileAccess.tsx"),
  "utf8",
);
const globalDts = fs.readFileSync(path.join(webview, "global.d.ts"), "utf8");
const preload = fs.readFileSync(path.join(extRoot, "onboarding-preload.cjs"), "utf8");

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

test("bridge getConfig derives folderMapModes from the json method and returns it", () => {
  assert.match(
    bridge,
    /async getConfig\(\)[\s\S]*m\.method[\s\S]*`\$\{m\.client\}::\$\{m\.method\}`/,
    "getConfig must build folderMapModes from each mapping's stored method (not drop it)",
  );
  assert.match(
    bridge,
    /return \{[\s\S]*folderMaps,[\s\S]*folderMapModes,[\s\S]*\};/,
    "getConfig must return folderMapModes alongside folderMaps",
  );
});

test("global.d.ts getConfig contract exposes folderMapModes", () => {
  assert.match(
    globalDts,
    /getConfig:[\s\S]*folderMaps: string[\s\S]*folderMapModes: string/,
    "getConfig return type must include folderMapModes",
  );
});

test("parseFolderMaps prefers the stored method over path inference", () => {
  assert.match(
    stepFileAccess,
    /export function parseFolderMaps\(raw: string, modes\?: string\)/,
    "parseFolderMaps must accept the stored modes string",
  );
  assert.match(
    stepFileAccess,
    /modeOf\.get\(clientPath\) \?\? inferMethod\(clientPath\)/,
    "stored method must win; inferMethod is only the fallback",
  );
});

test("both seed paths pass the stored modes into parseFolderMaps", () => {
  const calls = stepFileAccess.match(/parseFolderMaps\(cfg\.folderMaps, cfg\.folderMapModes\)/g) || [];
  assert.ok(
    calls.length >= 2,
    `both getConfig→parseFolderMaps call sites must pass cfg.folderMapModes (found ${calls.length})`,
  );
  assert.doesNotMatch(
    stepFileAccess,
    /parseFolderMaps\(cfg\.folderMaps\)(?!,)/,
    "no caller may parse folderMaps without the stored modes",
  );
});

test("preload bridges the method arg and hostSmbStatus to window.remotepair", () => {
  // The webview only sees what the Electron preload exposes — a bridge method missing here is
  // undefined at runtime even though global.d.ts/types compile. Guards both gate + C0 write paths.
  assert.match(
    preload,
    /addMapping: \(clientPath, hostPath, method\) => rp\('addMapping', \[clientPath, hostPath, method\]\)/,
    "preload addMapping must forward the per-mapping method (else the GUI never persists it)",
  );
  assert.match(
    preload,
    /hostSmbStatus: \(\) => rp\('hostSmbStatus', \[\]\)/,
    "preload must expose hostSmbStatus (else Gate 1's call is undefined at runtime)",
  );
});

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
}
console.log("\nall per-mapping method read-back tests passed");
