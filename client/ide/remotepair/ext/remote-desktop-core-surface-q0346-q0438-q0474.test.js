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

function hasInputEventCapture(source) {
  return /(?:window|document|video|stage)\.addEventListener\(\s*["'](?:pointerdown|pointerup|mousedown|mouseup|click|keydown|keyup|wheel)/.test(
    source,
  );
}

function hasRemoteInputSend(source) {
  return /(?:postMessage|\.send)\([^)]*(?:rdInput|remoteInput|input|pointer|mouse|click|key|wheel)/is.test(source);
}

// §1.9 Q0346/Q0438/Q0474: Remote Desktop is a core Client IDE surface and user
// operations such as clicking the host must travel over the RD path, then the
// viewer remains on the latest host frame.
test("Q0346/Q0438/Q0474 RD auto-opens and forwards host input", () => {
  assert.match(manifest, /"command":\s*"remotepair\.openRemoteDesktop"/);
  assert.match(extension, /panel\.reveal\(\)\.catch/);
  assert.match(extension, /registerCommand\("remotepair\.remoteDesktop\.refresh",\s*\(\) => panel\.refresh\(\)\)/);
  assert.ok(
    hasInputEventCapture(webview),
    "remote-desktop.js must listen for pointer/keyboard/wheel events on the RD surface",
  );
  assert.ok(
    hasRemoteInputSend(webview) || hasRemoteInputSend(extension),
    "RD input events must be forwarded to the host over the remote path",
  );
});

console.log(`REDGREEN ${passed} ${failed}`);
process.exit(failed ? 1 : 0);
