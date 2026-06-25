const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const extension = fs.readFileSync(path.join(root, "extension.js"), "utf8");
const webview = fs.readFileSync(path.join(root, "media", "remote-desktop.js"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL - ${name}`);
    console.error(`         ${error && error.message ? error.message.split("\n")[0] : error}`);
  }
}

test("Q0438 Remote Desktop check keeps the RD screen view-only after refresh", () => {
  const refreshCommand = pkg.contributes.commands.find(
    (entry) => entry.command === "remotepair.remoteDesktop.refresh",
  );
  assert.ok(refreshCommand, "package.json must expose RD refresh");
  assert.equal(refreshCommand.title, "Xpair: Refresh Remote Desktop");
  assert.match(extension, /registerCommand\("remotepair\.remoteDesktop\.refresh", \(\) => panel\.refresh\(\)\)/);
  assert.match(extension, /if \(msg\.type === "refresh"\) \{[\s\S]*this\._stopAll\(\);[\s\S]*this\._startStream\(\);/);

  assert.match(
    webview,
    /pc\.addTransceiver\("video", \{ direction: "recvonly" \}\)/,
    "Q0438 requires a checked RD screen to render video receive-only",
  );
  assert.match(
    webview,
    /pc\.ondatachannel = function[\s\S]*channel\.close\(\)/,
    "RD must close/ignore host-created DataChannels such as legacy rp-ctl/rp-move",
  );
  assert.doesNotMatch(
    webview,
    /createDataChannel\(|addEventListener\("(?:pointerdown|pointermove|pointerup|mousedown|mousemove|mouseup|wheel|keydown|keyup|beforeinput|input|compositionend)"/,
    "RD must not create input channels or capture pointer/keyboard/text/wheel events",
  );
  assert.doesNotMatch(
    webview,
    /\bt:\s*["'](?:c|m|k|x)["']/,
    "RD must not serialize mouse, keyboard, or text input messages",
  );
});

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
}

console.log("\nall Q0438 remote desktop operability tests passed");
