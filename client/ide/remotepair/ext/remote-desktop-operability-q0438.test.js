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

test("Q0438 Remote Desktop check keeps the RD screen operable after refresh", () => {
  const refreshCommand = pkg.contributes.commands.find(
    (entry) => entry.command === "remotepair.remoteDesktop.refresh",
  );
  assert.ok(refreshCommand, "package.json must expose RD refresh");
  assert.equal(refreshCommand.title, "Xpair: Refresh Remote Desktop");
  assert.match(extension, /registerCommand\("remotepair\.remoteDesktop\.refresh", \(\) => panel\.refresh\(\)\)/);
  assert.match(extension, /if \(msg\.type === "refresh"\) \{[\s\S]*this\._stopAll\(\);[\s\S]*this\._startStream\(\);/);

  assert.match(
    webview,
    /pc\.ondatachannel\s*=/,
    "Q0438 requires a checked RD screen to remain operable; the webview must receive host input DataChannels",
  );
  assert.match(
    webview,
    /addEventListener\("(?:pointerdown|pointermove|pointerup|mousedown|mousemove|mouseup|wheel|keydown|keyup|input|compositionend)"/,
    "Q0438 requires pointer/keyboard events to be captured on the RD surface",
  );
  assert.match(
    webview,
    /\b(?:ctlDC|moveDC|dataChannel|channel)\.send\(/,
    "Q0438 requires captured RD input to be forwarded to the host",
  );
  assert.doesNotMatch(
    webview,
    /PERMANENTLY display-only|never wire pc\.ondatachannel|never send anything/,
    "Q0438 intended behavior is operable RD with input support",
  );
});

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
}

console.log("\nall Q0438 remote desktop operability tests passed");
