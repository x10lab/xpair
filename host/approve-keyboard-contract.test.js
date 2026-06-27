const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const router = fs.readFileSync(path.join(root, "xpair-approve-router.sh"), "utf8");
const skill = fs.readFileSync(path.join(root, "skills/approve/SKILL.md"), "utf8");
const rules = fs.readFileSync(path.join(root, "rules.txt"), "utf8");

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

test("approve keyboard handling tries Cmd+Return then Return through System Events (Q0142)", () => {
  assert.match(skill, /xpair approve --for "Claude for Chrome" --type "key:cmd\+return\|return"/);
  assert.match(skill, /try Cmd\+Return first because it means "Always allow"/);
  assert.match(skill, /automatically falls back to Return \(allow once\)/);

  assert.match(rules, /^Claude for Chrome\tNew permissions required\tkey:cmd\+return\|return$/m);

  assert.match(router, /HINT_TYPE="\$\{RP_TYPE:-\}"/);
  assert.match(router, /\[ -n "\$HINT_TYPE" \] && haction="\$HINT_TYPE"/);
  assert.match(router, /case "\$key" in\s*return\|enter\) kc=36/);
  assert.match(router, /cmd\|command\) parts="\$parts command down,"/);
  assert.match(router, /osascript -e "tell application \\"System Events\\" to key code \$kc\$mod"/);
  assert.match(router, /key:\*\\\|\*/);
  assert.match(router, /IFS='\|' read -ra _KC <<< "\$\{action#key:\}"/);
  assert.match(router, /for combo in "\$\{_KC\[@\]\}"; do/);
  assert.match(router, /if dialog_gone "\$marker"; then log "success \[\$id\] \(key=\$combo #\$t, dialog closed\)"; return 0; fi/);
  assert.match(router, /log "\[\$id\] key=\$combo unconfirmed after \$\{tries\} tries → next candidate key"/);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
}

console.log("\nall approve keyboard contract tests passed");
