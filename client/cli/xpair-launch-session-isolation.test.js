const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const launch = fs.readFileSync(path.join(__dirname, "xpair-launch"), "utf8");

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL - ${name}`);
    console.error(`         ${error && error.message ? error.message.split("\n")[0] : error}`);
  }
}

test("new folder/path sessions are path-scoped and never use provider-global resume (Q0157)", () => {
  assert.match(
    launch,
    /printf '%s_%s' "\$name" "\$\(printf '%s' "\$dir" \| shasum -a 256 \| cut -c1-5\)"/,
    "session base must include a hash of the full project path",
  );
  assert.match(
    launch,
    /_K="\$\(printf '%s' "\$PWD" \| shasum -a 256 \| cut -c1-16\)"/,
    "Claude resume lookup must be keyed by the exact project path",
  );
  assert.match(launch, /\[ "\$RN" -gt 1 \] && RCONT=0/, "new numbered remote sessions must start fresh");
  assert.match(launch, /\[ "\$FRESH" = 1 \] && RCONT=0/, "--fresh must force a fresh agent shell");
  assert.doesNotMatch(
    launch,
    /^\s*codex .*resume --last/m,
    "Codex must not resume the provider-global last session for a new folder/path",
  );
  assert.doesNotMatch(
    launch,
    /^\s*opencode --continue/m,
    "OpenCode must not resume the provider-global last session for a new folder/path",
  );
});

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
}

console.log("\nall xpair launch session isolation tests passed");
