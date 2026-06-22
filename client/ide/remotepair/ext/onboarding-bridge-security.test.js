const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");

const bridge = require("./onboarding-bridge.js");

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
    await withSpawnSpy(async (calls) => {
      const result = await bridge.sshReachable("test-host_1.example");
      assert.equal(result.reachable, true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].cmd, "ssh");
      assert.ok(calls[0].args.includes("test-host_1.example"));
    });
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) FAILED`);
    process.exit(1);
  }
  console.log("\nall onboarding bridge security tests passed");
})();
