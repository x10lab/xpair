// Single-codebase platform portability: the client CLIs must run on a Windows (WSL2) client by
// branching execution only where the platform forces it (the BSD-vs-GNU `stat` flavor), while the
// macOS branch stays byte-identical to the prior implementation. Transport selection (mosh/ssh) and
// tab counting live in xpair-launch's own logic and are covered elsewhere.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = __dirname;
const launcher = fs.readFileSync(path.join(root, "xpair-launch"), "utf8");
const cli = fs.readFileSync(path.join(root, "xpair"), "utf8");

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

// Slice the platform-helper region (banner → end of the named one-liner helper) so we can source
// ONLY the helpers under bash — sourcing the whole CLI would execute the program.
function helperBlock(src, lastFn) {
  const start = src.indexOf("# ── platform portability");
  assert.notEqual(start, -1, "portability banner must exist");
  const at = src.indexOf(`\n${lastFn}()`, start);
  assert.notEqual(at, -1, `${lastFn} must be defined in the block`);
  const eol = src.indexOf("\n", at + 1);
  return src.slice(start, eol);
}
function runBash(block, body, env = {}) {
  return execFileSync("bash", ["-c", `${block}\n${body}\n`], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  }).trim();
}

const launchBlock = helperBlock(launcher, "_stat_size");
const cliBlock = helperBlock(cli, "_stat_mode");

test("both CLIs define _xpair_os inline (no dependency on optional sourced libs)", () => {
  for (const [name, src] of [["xpair-launch", launcher], ["xpair", cli]]) {
    assert.match(src, /_xpair_os\(\)\s*\{/, `${name} must define _xpair_os`);
    assert.match(src, /XPAIR_OS="\$\(_xpair_os\)"/, `${name} must resolve XPAIR_OS once`);
  }
  assert.match(launcher, /_stat_size\(\)/, "launcher needs _stat_size");
  assert.match(cli, /_stat_mtime\(\)/, "cli needs _stat_mtime");
  assert.match(cli, /_stat_mode\(\)/, "cli needs _stat_mode");
});

test("_xpair_os maps uname/RP_OS to mac|windows|linux", () => {
  const cases = [
    ["Darwin", "mac"], ["mac", "mac"],
    ["MINGW64_NT-10.0", "windows"], ["MSYS_NT-10.0", "windows"], ["CYGWIN_NT-10.0", "windows"],
    ["windows", "windows"], ["Linux", "linux"],
  ];
  for (const [os, want] of cases) {
    assert.equal(runBash(launchBlock, "_xpair_os", { RP_OS: os }), want, `RP_OS=${os} → ${want}`);
  }
});

test("client paths no longer call BSD `stat -f` directly (routed through helpers)", () => {
  // The only `stat -f` left in either CLI must be inside a helper definition or the REMOTE_SCRIPT
  // (which always runs on the macOS host). Caller sites must use _stat_*.
  const offenders = [];
  for (const [name, src] of [["xpair-launch", launcher], ["xpair", cli]]) {
    src.split("\n").forEach((line, i) => {
      if (!/stat -f/.test(line)) return;
      const isHelperDef = /_stat_(size|mtime|mode)\(\)/.test(line);
      const isRemote = /\\\$/.test(line) || /%Su/.test(line); // escaped → REMOTE_SCRIPT heredoc; %Su over ssh
      if (!isHelperDef && !isRemote) offenders.push(`${name}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.equal(offenders.length, 0, `unrouted stat -f on client path:\n${offenders.join("\n")}`);
});

test("_stat helpers select the BSD vs GNU flag by platform (verified with a stat shim)", () => {
  const shimDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "statshim-"));
  fs.writeFileSync(
    path.join(shimDir, "stat"),
    `#!/usr/bin/env bash\ncase "$1" in\n  -f) echo "BSD:$2" ;;\n  -c) echo "GNU:$2" ;;\n  *) echo "?" ;;\nesac\n`,
    { mode: 0o755 },
  );
  const env = (os) => ({ RP_OS: os, PATH: `${shimDir}:${process.env.PATH}` });
  assert.match(runBash(launchBlock, "_stat_size /tmp/x", env("mac")), /^BSD:/);
  assert.match(runBash(launchBlock, "_stat_size /tmp/x", env("linux")), /^GNU:/);
  assert.match(runBash(cliBlock, "_stat_mtime /tmp/x", env("mac")), /^BSD:/);
  assert.match(runBash(cliBlock, "_stat_mtime /tmp/x", env("linux")), /^GNU:/);
  assert.match(runBash(cliBlock, "_stat_mode /tmp/x", env("windows")), /^GNU:/);
  fs.rmSync(shimDir, { recursive: true, force: true });
});

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
}
console.log("\nall platform-portability tests passed");
