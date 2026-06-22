const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const extension = fs.readFileSync(path.join(root, "extension.js"), "utf8");
const webview = fs.readFileSync(path.join(root, "media", "remote-desktop.js"), "utf8");
const manifest = fs.readFileSync(path.join(root, "package.json"), "utf8");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS ${name} - Remote Desktop is exposed as the default IDE surface`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name} - ${error.message.split("\n")[0]}`);
  }
}

function hasRemoteInputEventCapture(source) {
  return /(?:window|document|video|stage)\.addEventListener\(\s*["'](?:pointerdown|pointerup|mousedown|mouseup|click|keydown|keyup|wheel)/.test(
    source,
  );
}

function hasRemoteInputSend(source) {
  return /(?:postMessage|\.send)\([^)]*(?:rdInput|remoteInput|pointer|mouse|click|key|wheel|\bt:\s*["'](?:c|m|k|x)["'])/is.test(source);
}

// §1.9 Q0346/Q0438/Q0474: Remote Desktop is a core Client IDE surface and user
// operations such as clicking or typing into the RD surface must not travel to
// the host. The viewer remains a display-only stream of the latest host frame.
test("Q0346/Q0438/Q0474 RD auto-opens as a view-only surface", () => {
  assert.match(manifest, /"command":\s*"remotepair\.openRemoteDesktop"/);
  assert.match(extension, /panel\.reveal\(\)\.catch/);
  assert.match(extension, /registerCommand\("remotepair\.remoteDesktop\.refresh",\s*\(\) => panel\.refresh\(\)\)/);
  assert.match(webview, /pc\.addTransceiver\("video", \{ direction: "recvonly" \}\)/);
  assert.match(webview, /pc\.ondatachannel = function[\s\S]*channel\.close\(\)/);
  assert.doesNotMatch(webview, /createDataChannel\(/);
  assert.ok(
    !hasRemoteInputEventCapture(webview),
    "remote-desktop.js must not capture pointer/keyboard/wheel events on the RD surface",
  );
  assert.ok(
    !hasRemoteInputSend(webview) && !hasRemoteInputSend(extension),
    "RD input events must not be forwarded to the host over the remote path",
  );
});

console.log(`REDGREEN ${passed} ${failed}`);
process.exit(failed ? 1 : 0);
