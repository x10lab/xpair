const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");

const bridge = require("./onboarding-bridge.js");
const onboardingMain = fs.readFileSync(path.join(__dirname, "onboarding-main.cjs"), "utf8");
const extension = fs.readFileSync(path.join(__dirname, "extension.js"), "utf8");
const xpairCli = fs.readFileSync(path.join(__dirname, "../../../cli/xpair"), "utf8");

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok  - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL - ${name}\n        ${error && error.message ? error.message : error}`);
  }
}

function withSpawnSpy(fn) {
  const original = childProcess.spawn;
  const calls = [];
  childProcess.spawn = (cmd, args) => {
    calls.push({ cmd, args });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    process.nextTick(() => child.emit("close", 0));
    return child;
  };
  return Promise.resolve()
    .then(() => fn(calls))
    .finally(() => {
      childProcess.spawn = original;
    });
}

(async () => {
  await check("sshReachable rejects option-like hosts before spawning ssh", async () => {
    await withSpawnSpy(async (calls) => {
      const result = await bridge.sshReachable("-oProxyCommand=touch-pwn");
      assert.deepEqual(calls, []);
      assert.equal(result.reachable, false);
      assert.match(result.err, /invalid host/);
    });
  });

  await check("sshReachable allows valid configured host names", async () => {
    const previousTag = process.env.RP_SSH_CM_TAG;
    process.env.RP_SSH_CM_TAG = "testlaunch";
    try {
      await withSpawnSpy(async (calls) => {
        const result = await bridge.sshReachable("test-host_1.example");
        assert.equal(result.reachable, true);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].cmd, "ssh");
        assert.ok(calls[0].args.includes("test-host_1.example"));
        assert.ok(calls[0].args.includes("ControlMaster=auto"));
        assert.ok(calls[0].args.includes("ControlPersist=300"));
        const controlPath = calls[0].args.find((arg) => String(arg).startsWith("ControlPath="));
        assert.match(controlPath, /rp-cm-testlaunch-%C$/, "ControlPath must include the per-launch tag and OpenSSH %C");
      });
    } finally {
      if (previousTag === undefined) delete process.env.RP_SSH_CM_TAG;
      else process.env.RP_SSH_CM_TAG = previousTag;
    }
  });

  await check("SSH ControlMaster scope is tagged once per app launch", async () => {
    assert.match(onboardingMain, /if \(!process\.env\.RP_SSH_CM_TAG\) process\.env\.RP_SSH_CM_TAG = String\(process\.pid\)/);
    assert.match(extension, /`rp-cm-\$\{process\.env\.RP_SSH_CM_TAG \|\| "x"\}-%C`/);
  });

  await check("host-permissions CLI probe shares the session ControlMaster", async () => {
    assert.match(xpairCli, /rp_ssh_control_path\(\)[\s\S]*rp-cm-%s-%%C[\s\S]*\$\{RP_SSH_CM_TAG:-x\}/);
    assert.match(
      xpairCli,
      /cmd_host_permissions\(\)[\s\S]*cm="\$\(rp_ssh_control_path\)"[\s\S]*ControlMaster=auto[\s\S]*"ControlPath=\$cm"[\s\S]*ControlPersist=300/,
    );
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) FAILED`);
    process.exit(1);
  }
  console.log("\nall onboarding bridge security tests passed");
})();
