const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const extension = fs.readFileSync(path.join(root, "extension.js"), "utf8");
const webview = fs.readFileSync(path.join(root, "media/remote-desktop.js"), "utf8");
const hostReadme = fs.readFileSync(path.join(root, "../../../../host/rd/screen/README.md"), "utf8");

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   - ${name}`);
  } catch (error) {
    failed++;
    console.error(`  FAIL - ${name}`);
    console.error(`         ${error.message.split("\n")[0]}`);
  }
}

test("Remote Desktop is view-only and can request a fresh frame (Q0346)", () => {
  assert.match(extension, /vscode\.commands\.registerCommand\("remotepair\.openRemoteDesktop"/);
  assert.match(extension, /panel\.reveal\(\)[\s\S]*setupLayout/);
  assert.match(extension, /msg\.type === "refresh"[\s\S]*this\._stopAll\(\);[\s\S]*this\._startStream\(\);/);

  assert.match(hostReadme, /Remote Desktop is view-only[\s\S]*does not open `rp-ctl` or `rp-move`/);
  assert.match(webview, /PERMANENTLY view-only/);
  assert.match(webview, /pc\.addTransceiver\("video", \{ direction: "recvonly" \}\)/);
  assert.match(webview, /pc\.ondatachannel = function[\s\S]*channel\.close\(\)/);
  assert.doesNotMatch(webview, /createDataChannel\(["']rp-(?:ctl|move)["']/);
  assert.doesNotMatch(webview, /addEventListener\(["'](?:pointerdown|pointermove|pointerup|mousedown|mousemove|mouseup|click|wheel|keydown|keyup|beforeinput|input|compositionend)["']/);
  assert.doesNotMatch(webview, /\bt:\s*["'](?:c|m|k|x)["']/);
});

if (failed > 0) {
  console.error(`\n${failed} test(s) FAILED`);
  process.exit(1);
}

console.log("\nall Q0346 Remote Desktop core-surface tests passed");
