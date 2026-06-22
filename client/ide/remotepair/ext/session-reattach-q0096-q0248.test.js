const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { normalizeSessionList } = require("./session-list.js");

const extRoot = __dirname;
const repoRoot = path.resolve(extRoot, "../../..", "..");
const patch = fs.readFileSync(
  path.join(extRoot, "../patches/zz-remotepair-ide-frontend.patch"),
  "utf8",
);
const cli = fs.readFileSync(path.join(repoRoot, "client/cli/xpair"), "utf8");

function extract(source, start, end) {
  const a = source.indexOf(start);
  assert.notEqual(a, -1, `missing section start: ${start}`);
  const b = source.indexOf(end, a + start.length);
  assert.notEqual(b, -1, `missing section end: ${end}`);
  return source.slice(a, b);
}

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

test("named sessions remain distinct and exact-name attachable (Q0096 Q0248)", () => {
  assert.deepStrictEqual(
    normalizeSessionList({
      sessions: [
        { name: "host_repo_1", attached: "0" },
        { name: "host_repo_2", attached: 1 },
        { name: "host repo 3", attached: 0 },
        { name: "bad;touch-pwn", attached: 0 },
      ],
    }),
    {
      sessions: [
        { name: "host_repo_1", attached: 0 },
        { name: "host_repo_2", attached: 1 },
      ],
    },
    "session list normalization must preserve exact safe names and reject display/path text",
  );

  assert.match(
    patch,
    /function cachedDetachedSessions\(\): readonly string\[\] \{[\s\S]*attached === 0[\s\S]*\.map\(s => s\.name\)/,
    "detached cards must come from real unattached session names",
  );
  assert.match(
    patch,
    /function cachedHistorySessions\(\): readonly string\[\] \{[\s\S]*attached > 0[\s\S]*\.map\(s => s\.name\)/,
    "live attached history must keep real session names separate from display titles",
  );
  assert.match(
    patch,
    /function reattach\(name: string\): void \{[\s\S]*SESSION_NAME_RE\.test\(name\)[\s\S]*reattacher\(name\);/,
    "reattach must pass only a validated selected session name",
  );
  assert.match(
    patch,
    /instance\.sendText\('xpair attach ' \+ shellSingleQuote\(name\), true\)/,
    "the Sessions UI must attach exactly the selected quoted name",
  );
  assert.match(
    patch,
    /const persisted = this\.readHistory\(\);[\s\S]*this\.addDisplayCard\(name/,
    "persisted display-only titles must not become attach targets",
  );

  const attach = extract(cli, "cmd_attach() {", "\ncmd_host() {");
  assert.match(attach, /attach requires exactly one session name/);
  assert.match(attach, /case "\$session" in \*\[!A-Za-z0-9_.-\]\*\|''\)/);
  assert.match(attach, /has-session -t \$\(sh_quote "=\$session"\)/);
  assert.match(attach, /attach -d -t "=\$session"/);
  assert.doesNotMatch(attach, /new-session|tmux new\b/, "xpair attach must never create a fresh session");
});

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
}

console.log("\nall Q0096/Q0248 session reattach tests passed");
