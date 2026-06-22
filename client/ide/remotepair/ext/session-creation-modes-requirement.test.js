const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const repoRoot = path.resolve(root, "../../..");
const patch = fs.readFileSync(
  path.join(root, "../patches/zz-remotepair-ide-frontend.patch"),
  "utf8",
);
const cli = fs.readFileSync(path.join(repoRoot, "cli/xpair"), "utf8");
const launcher = fs.readFileSync(path.join(repoRoot, "cli/xpair-launch"), "utf8");

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

check("Q0261 Q0262 Q0540 Q0541 New Session supports Claude, Shell, and Codex session creation", () => {
  assert.match(cli, /xpair launch \[<dir>\][^\n]+--engine <claude\|claudecode\|codex\|opencode>/);
  assert.match(cli, /canonical_engine\(\) \{[\s\S]+claude\|claudecode\|claude-code[\s\S]+codex\|opencode/);
  assert.match(launcher, /respawn_body\(\) \{[\s\S]+codex\)[\s\S]+respawn_body_codex[\s\S]+\*\)[\s\S]+respawn_body_claude/);
  assert.match(launcher, /choose_engine\(\) \{[\s\S]+Claude Code[\s\S]+Codex/);

  assert.match(patch, /export type SessionKind = 'claude' \| 'shell' \| 'codex'/);
  assert.match(patch, /REMOTEPAIR_SESSIONS_DETACHED_ID/);
  assert.match(patch, /instance\.sendText\('xpair attach ' \+ shellSingleQuote\(name\), true\)/);

  const missing = [];
  if (!/sendText\('xpair launch --engine claude(?: |')/.test(patch)) {
    missing.push("Claude launch branch");
  }
  if (!/sendText\('xpair launch --engine codex(?: |')/.test(patch)) {
    missing.push("Codex launch branch");
  }
  if (!/(case 'shell'|kind === 'shell'|kind !== 'shell'[\s\S]+xpair launch)/.test(patch)) {
    missing.push("Shell/plain terminal branch");
  }
  assert.deepEqual(missing, [], `missing New Session mode branches: ${missing.join(", ")}`);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
}

console.log("\nall session creation mode requirement tests passed");
