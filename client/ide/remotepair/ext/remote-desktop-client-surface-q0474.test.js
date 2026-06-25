const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const extension = fs.readFileSync(path.join(root, "extension.js"), "utf8");
const webview = fs.readFileSync(path.join(root, "media", "remote-desktop.js"), "utf8");
const css = fs.readFileSync(path.join(root, "media", "remote-desktop.css"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name} - Remote Desktop is wired as the default client IDE surface`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name} - ${error.message.split("\n")[0]}`);
  }
}

test("Q0474 Remote Desktop is a core Client IDE surface that starts when visible", () => {
  assert.ok(
    pkg.activationEvents.includes("onStartupFinished"),
    "the client IDE extension must activate on startup, not only on a manual command",
  );
  assert.ok(
    pkg.contributes.commands.some((command) => command.command === "remotepair.openRemoteDesktop"),
    "Remote Desktop must be exposed as a first-class client IDE command",
  );

  assert.match(
    extension,
    /const panel = new RemoteDesktopPanel\(context\.extensionUri\);[\s\S]*?panel\.reveal\(\)\.catch/,
    "activation must auto-reveal the RD editor tab as the default surface",
  );
  assert.match(
    extension,
    /vscode\.window\.createWebviewPanel\(\s*"remotepair\.remoteDesktop",\s*"RD"/,
    "RD must be an editor webview panel, not just documentation",
  );
  assert.match(extension, /panel\.webview\.html = this\.getHtml\(panel\.webview\)/);
  assert.match(extension, /media", "remote-desktop\.js"/);
  assert.match(extension, /media", "remote-desktop\.css"/);
  assert.match(extension, /<video id="screen-video" autoplay muted playsinline><\/video>/);

  assert.match(
    extension,
    /if \(panel\.visible\) \{[\s\S]*?this\.visible = true;[\s\S]*?this\._startStream\(\);[\s\S]*?\}/,
    "visible RD panels must start the stream",
  );
  assert.match(
    extension,
    /(?:this|self)\.post\(\{ type: "v2Connect", signalUrl, sessionToken \}\)/,
    "extension must hand the webview a tokenized signaling URL",
  );
  assert.match(webview, /new RTCPeerConnection\(\{ iceServers: \[\] \}\)/);
  assert.match(webview, /pc\.addTransceiver\("video", \{ direction: "recvonly" \}\)/);
  assert.match(webview, /pc\.ontrack[\s\S]*video\.srcObject = ev\.streams\[0\]/);
  assert.match(webview, /vscode\.postMessage\(\{ type: "v2FirstFrame" \}\)/);
  assert.match(css, /#screen-video[\s\S]*object-fit: contain/);
});

console.log(`REDGREEN ${passed} ${failed}`);
process.exit(failed ? 1 : 0);
