const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const launcher = fs.readFileSync(path.join(root, "xpair-launch"), "utf8");

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

test("launcher leaves host tmux sessions detached and reattachable (Q0061/Q0062/Q0063)", () => {
  assert.match(
    launcher,
    /tm_local new-session -d -s "\$SESS" -c "\$PROJECT_DIR" "bash \$T"/,
    "local host sessions must be created detached before attach",
  );
  assert.match(
    launcher,
    /tm new-session -d -x \$\{COLS\} -y \$\{LINES\} -s "\\\$SESSION" -c \$\{HOST_DIR_Q\} "bash \\\$T"/,
    "remote host sessions must be created detached before attach",
  );
  assert.match(
    launcher,
    /tm_local has-session -t "=\$SESS" 2>\/dev\/null && NEED_CREATE=0\s+# detached .* re-attach/,
    "existing local host sessions should be reattached rather than recreated",
  );
  assert.match(
    launcher,
    /if tm has-session -t "=\\\$SESSION" 2>\/dev\/null; then NEED_CREATE=0; fi/,
    "existing remote host sessions should be reattached rather than recreated",
  );
  assert.match(
    launcher,
    /attach -d -t "=\$SESS"/,
    "reattach must use tmux attach -d so stale clients are dropped but the session remains",
  );
  assert.match(
    launcher,
    /detach-client -s \$\(sh_quote "=\$ACTUAL_SESSION"\)/,
    "closing the client tab should detach the client, not terminate the tmux session",
  );
  assert.doesNotMatch(
    launcher,
    /kill-session/,
    "launcher must not kill tmux sessions as part of normal detached/orphan handling",
  );
});

console.log(failed ? `\n${failed} test(s) failed` : "\nall xpair launch detached-session tests passed");
process.exit(failed ? 1 : 0);
