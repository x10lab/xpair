const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const xpair = fs.readFileSync(path.join(root, "xpair"), "utf8");
const launcher = fs.readFileSync(path.join(root, "xpair-launch"), "utf8");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name} - session launcher exposes every required session kind`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name} - ${error.message.split("\n")[0]}`);
  }
}

function functionBody(source, name) {
  const start = source.indexOf(`${name}() {`);
  assert.notStrictEqual(start, -1, `${name}() must exist`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (depth === 0) return source.slice(bodyStart + 1, i);
  }
  assert.fail(`${name}() body is unterminated`);
}

test("Q0261 terminal/session creation supports Claude, Shell, and Codex", () => {
  for (const source of [xpair, launcher]) {
    const canonical = functionBody(source, "canonical_engine");
    assert.match(canonical, /claude\|claudecode\|claude-code/, "Claude must be accepted as a launch engine");
    assert.match(canonical, /codex/, "Codex must be accepted as a launch engine");
    assert.match(canonical, /shell/, "Shell must be accepted as a launch engine");
  }

  const choose = functionBody(launcher, "choose_engine");
  assert.match(choose, /Claude Code/, "interactive picker must offer Claude Code");
  assert.match(choose, /Codex/, "interactive picker must offer Codex");
  assert.match(choose, /Shell/, "interactive picker must offer Shell");

  const dispatch = functionBody(launcher, "respawn_body");
  assert.match(dispatch, /claude\)\s+respawn_body_claude/, "launcher must dispatch Claude sessions");
  assert.match(dispatch, /codex\)\s+respawn_body_codex/, "launcher must dispatch Codex sessions");
  assert.match(dispatch, /shell\)\s+respawn_body_shell/, "launcher must dispatch Shell sessions");
  assert.match(launcher, /respawn_body_shell\(\) \{/, "Shell sessions need a concrete respawn body");

  const usageText = xpair + "\n" + launcher;
  assert.match(usageText, /--engine <[^>]*shell[^>]*>/, "CLI help must document the Shell engine option");
});

console.log(`REDGREEN ${passed} ${failed}`);
process.exit(failed ? 1 : 0);
