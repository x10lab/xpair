const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const repoRoot = path.join(root, "..", "..", "..", "..");
const app = fs.readFileSync(path.join(root, "onboarding-webview/src/App.tsx"), "utf8");
const stepEngine = fs.readFileSync(
  path.join(root, "onboarding-webview/src/components/onboarding/client/StepEngine.tsx"),
  "utf8",
);
const bridge = fs.readFileSync(path.join(root, "onboarding-bridge.js"), "utf8");
const hostEngineGuard = fs.readFileSync(path.join(repoRoot, "host/app/EngineGuard.swift"), "utf8");

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(`         ${error.message.split("\n")[0]}`);
  }
}

test("Q0545 host setup probes, installs, authenticates, and gates supported engines on the host", () => {
  assert.match(app, /"Find your host"[\s\S]*"Connect"[\s\S]*"Set up host"[\s\S]*"Grant permissions"[\s\S]*"Choose engine"/);
  assert.match(app, /w\.index === S\.ENGINE && !engineReady/);
  assert.match(app, /<StepEngine engine=\{engine\} setEngine=\{setEngine\} onReady=\{setEngineReady\}/);

  assert.match(stepEngine, /const ENGINES:[\s\S]*id: "claude"[\s\S]*id: "codex"[\s\S]*id: "opencode"/);
  assert.match(stepEngine, /window\.remotepair\.hostEngineStatus\(e\)/);
  assert.match(stepEngine, /onReady\(r\.installed && r\.authed\)/);
  assert.match(stepEngine, /window\.remotepair\.installHostEngine\(engine\)/);
  assert.match(stepEngine, /window\.remotepair\.setHostEngineAuth\(engine, apiKey\.trim\(\)\)/);
  assert.match(stepEngine, /await probe\(engine\)/);

  assert.match(bridge, /const ENGINES = new Set\(\["claude", "codex", "opencode"\]\)/);
  assert.match(bridge, /const host = String\(parseEnv\(CLIENT_ENV\)\.REMOTE_HOST \|\| ""\)\.trim\(\)/);
  assert.match(bridge, /const probe = ENGINE_PROBE\[e\]/);
  assert.match(bridge, /run\("ssh", \[\.\.\.sshProbeOpts\(6\), host, probe\]\)/);
  assert.match(bridge, /const PATH_PERSIST =/);
  assert.match(bridge, /# >>> xpair PATH >>>/);
  assert.match(bridge, /if \(!ENGINE_INSTALL\[e\]\) return \{ ok: false, err: `unknown engine: \$\{e\}` \}/);
  assert.match(bridge, /run\("ssh", \[\.\.\.sshProbeOpts\(20\), host, cmd\]/);
  assert.match(bridge, /const r = await runSecretStdin\("ssh", \[\.\.\.sshProbeOpts\(15\), host, writer\], apiKey\)/);

  assert.match(hostEngineGuard, /static func isKnown\(_ engine: String\) -> Bool \{\s*engine == "claude" \|\| engine == "codex" \|\| engine == "opencode"\s*\}/);
  assert.match(hostEngineGuard, /static func status\(_ engine: String\) -> Status/);
  assert.match(hostEngineGuard, /static func install\(_ engine: String\) -> Result/);
  assert.match(hostEngineGuard, /private static let pathPersistScript/);
  assert.match(hostEngineGuard, /static func setAuth\(_ engine: String, key: String\) -> Result/);
  assert.match(hostEngineGuard, /static func persist\(_ engine: String\) -> Result/);
});

console.log(failed ? `\n${failed} test(s) failed` : "\nall Q0545 engine host setup tests passed");
process.exit(failed ? 1 : 0);
