const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { EventEmitter } = require("node:events");

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "rp-rd-reconnect-"));
process.env.HOME = TMP_HOME;
process.env.USERPROFILE = TMP_HOME;
process.env.REMOTE_HOST = "same-host";
fs.mkdirSync(path.join(TMP_HOME, ".xpair/host"), { recursive: true });

const spawnedChildren = [];
const postedMessages = [];
const scheduledTimers = [];
let nextLocalPort = 32000;

function fakeSpawn(cmd, args) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.cmd = cmd;
  child.args = args;
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };
  spawnedChildren.push(child);
  return child;
}

const fakeNet = {
  createServer() {
    return {
      _port: 0,
      listen(_port, _host, cb) {
        this._port = nextLocalPort++;
        if (typeof cb === "function") cb();
      },
      address() {
        return { port: this._port };
      },
      close(cb) {
        if (typeof cb === "function") cb();
      },
      on() {},
    };
  },
};

const fakeWebview = {
  html: "",
  options: {},
  cspSource: "vscode-webview://test",
  asWebviewUri(uri) {
    return uri;
  },
  postMessage(message) {
    postedMessages.push(message);
    return Promise.resolve(true);
  },
  onDidReceiveMessage() {
    return { dispose() {} };
  },
};

const fakePanel = {
  visible: true,
  viewColumn: 1,
  webview: fakeWebview,
  reveal() {},
  dispose() {},
  onDidChangeViewState() {
    return { dispose() {} };
  },
  onDidDispose() {
    return { dispose() {} };
  },
};

const fakeVscode = {
  ViewColumn: { Active: 1 },
  StatusBarAlignment: { Left: 0, Right: 1 },
  ThemeColor: class ThemeColor {},
  Uri: {
    joinPath(...parts) {
      return { fsPath: parts.map((part) => String(part && part.fsPath ? part.fsPath : part)).join(path.sep) };
    },
  },
  window: {
    createOutputChannel() {
      return { appendLine() {} };
    },
    createWebviewPanel() {
      return fakePanel;
    },
    tabGroups: { all: [] },
    showInformationMessage() {},
    showErrorMessage() {},
  },
  commands: {
    executeCommand() {
      return Promise.resolve();
    },
    registerCommand() {
      return { dispose() {} };
    },
  },
  workspace: {
    getConfiguration() {
      return {
        get() {
          return false;
        },
        update() {
          return Promise.resolve();
        },
      };
    },
  },
  extensions: { getExtension() { return null; } },
  ConfigurationTarget: { Global: 1 },
  WebviewPanelSerializer: class WebviewPanelSerializer {},
};

const realLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "vscode") return fakeVscode;
  if (request === "child_process") return { spawn: fakeSpawn };
  if (request === "net") return fakeNet;
  return realLoad.call(this, request, parent, isMain);
};

const extension = require("./extension.js");
Module._load = realLoad;

const realSetTimeout = global.setTimeout;
const realClearTimeout = global.clearTimeout;
global.setTimeout = function fakeSetTimeout(fn, delay, ...args) {
  function timer() {
    if (!timer.cleared) fn(...args);
  }
  timer.delay = delay;
  timer.cleared = false;
  scheduledTimers.push(timer);
  return timer;
};
global.clearTimeout = function fakeClearTimeout(timer) {
  if (timer) timer.cleared = true;
};

function waitForAsync() {
  return new Promise((resolve) => realSetTimeout(resolve, 20));
}

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name} - ${error && error.message ? error.message.split("\n")[0] : error}`);
  }
}

function v2ConnectPosts() {
  return postedMessages.filter((message) => message.type === "v2Connect");
}

(async () => {
  await test("Q0548/Q0552 RD restores and reconnects to the same host with a fresh tunnel", async () => {
    const panel = new extension.RemoteDesktopPanel({ fsPath: "/test/ext" });

    panel.restore(fakePanel);
    await waitForAsync();

    assert.equal(spawnedChildren.length, 1, "visible restored RD panel should start one tunnel");
    assert.equal(spawnedChildren[0].cmd, "ssh");
    assert.ok(spawnedChildren[0].args.includes("same-host"), "first tunnel must target the configured host");
    assert.ok(
      spawnedChildren[0].args.some((arg) => /^\d+:127\.0\.0\.1:\d+$/.test(arg)),
      "first tunnel must forward a local signaling port to the host RD signaling port",
    );

    scheduledTimers[0]();
    assert.equal(v2ConnectPosts().length, 1, "restored RD should tell the webview to connect after tunnel settle");
    assert.match(v2ConnectPosts()[0].signalUrl, /^ws:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]{64}$/);

    const firstChild = spawnedChildren[0];
    panel.onMessage({ type: "v2Error", detail: "peer connection failed" });
    assert.equal(firstChild.killed, true, "RD error should clean up the current tunnel before retry");

    await panel.reveal();
    await waitForAsync();

    assert.equal(spawnedChildren.length, 2, "revealing after an RD error should start a fresh tunnel");
    assert.ok(spawnedChildren[1].args.includes("same-host"), "retry tunnel must target the same configured host");
    assert.notEqual(spawnedChildren[1], firstChild, "retry must use a new child process");

    scheduledTimers[scheduledTimers.length - 1]();
    assert.equal(v2ConnectPosts().length, 2, "fresh retry tunnel should reconnect the webview");
    assert.match(v2ConnectPosts()[1].signalUrl, /^ws:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]{64}$/);
  });

  global.setTimeout = realSetTimeout;
  global.clearTimeout = realClearTimeout;
  try {
    fs.rmSync(TMP_HOME, { recursive: true, force: true });
  } catch (_error) {
  }

  console.log(`REDGREEN ${passed} ${failed}`);
  process.exit(failed ? 1 : 0);
})();
