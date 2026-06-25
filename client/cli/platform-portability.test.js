// Single-codebase platform portability: the client CLIs must run on a Windows (WSL2/Git-Bash)
// client by branching execution only where the platform forces it (stat flavor, process listing),
// while the macOS branch stays byte-identical to the prior implementation.
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

// Run a snippet under bash with the platform helpers from <file> sourced. The helper block is the
// self-contained region between the portability banner and the end of the last helper, so we slice
// it out and source only that — sourcing the whole CLI would execute the program.
function helperBlock(src, lastFn) {
  const start = src.indexOf("# ── platform portability");
  assert.notEqual(start, -1, "portability banner must exist");
  const after = src.indexOf(`\n${lastFn}()`, start);
  assert.notEqual(after, -1, `${lastFn} must be defined in the block`);
  const close = src.indexOf("\n}", after);
  return src.slice(start, close + 2);
}
function runBash(block, body, env = {}) {
  const script = `${block}\n${body}\n`;
  return execFileSync("bash", ["-c", script], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  }).trim();
}

const launchBlock = helperBlock(launcher, "_proc_listing");
const cliBlock = helperBlock(cli, "_stat_mode");

test("both CLIs define the platform helpers inline (no dependency on optional sourced libs)", () => {
  for (const [name, src] of [["xpair-launch", launcher], ["xpair", cli]]) {
    assert.match(src, /_xpair_os\(\)\s*\{/, `${name} must define _xpair_os`);
    assert.match(src, /XPAIR_OS="\$\(_xpair_os\)"/, `${name} must resolve XPAIR_OS once`);
  }
  assert.match(launcher, /_stat_size\(\)/, "launcher needs _stat_size");
  assert.match(launcher, /_proc_listing\(\)/, "launcher needs _proc_listing");
  assert.match(cli, /_stat_mtime\(\)/, "cli needs _stat_mtime");
  assert.match(cli, /_stat_mode\(\)/, "cli needs _stat_mode");
});

test("_xpair_os maps uname/RP_OS to mac|windows|linux", () => {
  const cases = [
    ["Darwin", "mac"],
    ["mac", "mac"],
    ["MINGW64_NT-10.0", "windows"],
    ["MSYS_NT-10.0", "windows"],
    ["CYGWIN_NT-10.0", "windows"],
    ["windows", "windows"],
    ["Linux", "linux"],
  ];
  for (const [os, want] of cases) {
    const got = runBash(launchBlock, "_xpair_os", { RP_OS: os });
    assert.equal(got, want, `RP_OS=${os} → ${want}`);
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
      const isRemote = /\\\$/.test(line) || /%Su/.test(line); // escaped → REMOTE_SCRIPT heredoc; %Su runs over ssh
      if (!isHelperDef && !isRemote) offenders.push(`${name}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.equal(offenders.length, 0, `unrouted stat -f on client path:\n${offenders.join("\n")}`);
});

test("tab counting routes through _proc_listing, not a bare pgrep", () => {
  assert.match(
    launcher,
    /while \[ -n "\$\(_proc_listing "\$\{_CLIENT_PAT\}\.\*attach -d -t =\$\{base\}_\$\{n\}\( \|\\\$\)"\)" \]/,
    "_remote_next_n must count tabs via _proc_listing",
  );
  assert.match(
    launcher,
    /_proc_listing "\$_CLIENT_PAT" \| grep -E "attach -d -t =\$\{REMOTE_PROJ\}_\[0-9\]\+"/,
    "zombie cleanup must list candidates via _proc_listing",
  );
  // No bare `pgrep` call should remain at a caller site. The only allowed uses are inside the
  // _proc_listing definition itself (`command -v pgrep`, and `pgrep -fl "$1"`).
  const barePgrep = launcher
    .split("\n")
    .filter(
      (l) =>
        /(^|[^_])pgrep /.test(l) &&
        !/command -v pgrep/.test(l) &&
        !/pgrep -fl "\$1"/.test(l) &&
        !/^\s*#/.test(l),
    );
  assert.equal(barePgrep.length, 0, `bare pgrep caller left:\n${barePgrep.join("\n")}`);
});

test("_stat helpers select the BSD vs GNU flag by platform (verified with a stat shim)", () => {
  // Shim `stat` so we can prove which flag the helper passed without depending on the host's stat.
  const shimDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "statshim-"));
  fs.writeFileSync(
    path.join(shimDir, "stat"),
    `#!/usr/bin/env bash\n# echo the flag style so the test can assert the branch taken\ncase "$1" in\n  -f) echo "BSD:$2" ;;\n  -c) echo "GNU:$3" ;;\n  *) echo "?" ;;\nesac\n`,
    { mode: 0o755 },
  );
  const env = (os) => ({ RP_OS: os, PATH: `${shimDir}:${process.env.PATH}` });
  // mac → BSD -f %z
  assert.match(runBash(launchBlock, '_stat_size /tmp/x', env("mac")), /^BSD:/);
  // linux/windows → GNU -c %s
  assert.match(runBash(launchBlock, '_stat_size /tmp/x', env("linux")), /^GNU:/);
  assert.match(runBash(cliBlock, '_stat_mtime /tmp/x', env("mac")), /^BSD:/);
  assert.match(runBash(cliBlock, '_stat_mtime /tmp/x', env("linux")), /^GNU:/);
  assert.match(runBash(cliBlock, '_stat_mode /tmp/x', env("windows")), /^GNU:/);
  fs.rmSync(shimDir, { recursive: true, force: true });
});

test("_proc_listing falls back to ps when pgrep is absent (Git-Bash shape)", () => {
  // Hide pgrep by giving a PATH with only a ps shim; _proc_listing must still emit a matching line.
  const shimDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "psshim-"));
  fs.writeFileSync(
    path.join(shimDir, "ps"),
    `#!/usr/bin/env bash\necho "  PID CMD"\necho "4242 ssh -t host -- tmux attach -d -t =proj_1"\n`,
    { mode: 0o755 },
  );
  // PATH must EXCLUDE the real pgrep (which lives in /usr/bin) so `command -v pgrep` fails and the
  // ps fallback is exercised. With RP_OS set, _xpair_os never calls uname, so the only external
  // tool the fallback needs besides the ps shim is awk — symlink it into the isolated bin.
  // bash resolves via PATH too (execFileSync), so symlink it (and awk) into the isolated bin.
  for (const tool of ["awk", "bash"]) {
    const p = execFileSync("/bin/sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).trim();
    fs.symlinkSync(p, path.join(shimDir, tool));
  }
  const out = runBash(
    launchBlock,
    '_proc_listing "ssh.*attach -d -t =proj_1"',
    { PATH: shimDir, RP_OS: "windows" },
  );
  assert.match(out, /4242/, "ps fallback must surface the matching pid");
  fs.rmSync(shimDir, { recursive: true, force: true });
});

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
}
console.log("\nall platform-portability tests passed");
