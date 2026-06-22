const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { EventEmitter } = require("node:events");
const vm = require("node:vm");

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "rp-tunnel-test-"));
process.env.HOME = TMP_HOME;
process.env.USERPROFILE = TMP_HOME;
fs.mkdirSync(path.join(TMP_HOME, ".xpair/host"), { recursive: true });

const spawnedChildren = [];
const scheduledTimers = [];
function fakeSpawn() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };
  spawnedChildren.push(child);
  return child;
}

const postedMessages = [];
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
      return { fsPath: parts.map((part) => String(part)).join(path.sep) };
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
  return realLoad.call(this, request, parent, isMain);
};

const extension = require("./extension.js");

Module._load = realLoad;

const realSetTimeout = global.setTimeout;
global.setTimeout = function fakeSetTimeout(fn) {
  scheduledTimers.push(fn);
  return { dispose() {} };
};

function waitForAsync() {
  return new Promise((resolve) => realSetTimeout(resolve, 20));
}

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

function resetHarness() {
  spawnedChildren.length = 0;
  postedMessages.length = 0;
  scheduledTimers.length = 0;
}

function makePanel() {
  const panel = new extension.RemoteDesktopPanel({ fsPath: "/test/ext" });
  panel.panel = fakePanel;
  return panel;
}

function errorPosts() {
  return postedMessages.filter((message) => message.type === "status" && message.state === "error");
}

function v2ConnectPosts() {
  return postedMessages.filter((message) => message.type === "v2Connect");
}

function runRemoteDesktopWebview() {
  const script = fs.readFileSync(path.join(__dirname, "media", "remote-desktop.js"), "utf8");
  const posted = [];
  const windowListeners = [];
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        textContent: "",
        style: {},
        srcObject: null,
        className: "",
        classList: {
          add() {},
          remove() {},
        },
      });
    }
    return elements.get(id);
  }
  class FakeWebSocket {
    static instances = [];
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.sent = [];
      this.listeners = new Map();
      FakeWebSocket.instances.push(this);
    }
    addEventListener(type, fn) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(fn);
      this.listeners.set(type, listeners);
    }
    close() {
      this.readyState = 3;
    }
    send(message) {
      this.sent.push(message);
    }
    emit(type, event = {}) {
      for (const listener of this.listeners.get(type) || []) {
        listener(event);
      }
    }
  }
  class FakeRTCPeerConnection {
    static instances = [];
    constructor() {
      this.connectionState = "new";
      this.onconnectionstatechange = null;
      this.onicecandidate = null;
      this.ontrack = null;
      FakeRTCPeerConnection.instances.push(this);
    }
    addTransceiver() {}
    close() {
      this.closed = true;
    }
    setRemoteDescription() {
      return Promise.resolve();
    }
    createAnswer() {
      return Promise.resolve({ sdp: "answer" });
    }
    setLocalDescription() {
      return Promise.resolve();
    }
    addIceCandidate() {
      return Promise.resolve();
    }
  }
  const sandbox = {
    acquireVsCodeApi() {
      return { postMessage(message) { posted.push(message); } };
    },
    document: { getElementById: element },
    window: { addEventListener(type, listener) { if (type === "message") windowListeners.push(listener); } },
    WebSocket: FakeWebSocket,
    RTCPeerConnection: FakeRTCPeerConnection,
    console,
  };
  vm.runInNewContext(script, sandbox, { filename: "remote-desktop.js" });
  return {
    posted,
    sockets: FakeWebSocket.instances,
    peers: FakeRTCPeerConnection.instances,
    sendWindowMessage(message) {
      for (const listener of windowListeners) {
        listener({ data: message });
      }
    },
  };
}

(async () => {
  await check("extension exports RemoteDesktopPanel for tunnel regression coverage", () => {
    assert.strictEqual(typeof extension.activate, "function");
    assert.strictEqual(typeof extension.deactivate, "function");
    assert.strictEqual(typeof extension.RemoteDesktopPanel, "function");
  });

  await check("active tunnel child error posts RD overlay error", async () => {
    resetHarness();
    const panel = makePanel();
    await panel._startV2("test-host");
    assert.strictEqual(spawnedChildren.length, 1, "expected one ssh tunnel child");

    spawnedChildren[0].emit("error", new Error("ssh ENOENT"));

    const errors = errorPosts();
    assert.strictEqual(errors.length, 1, "expected one status:error post");
    assert.match(errors[0].detail, /SSH tunnel failed/);
    assert.match(errors[0].detail, /ssh ENOENT/);
  });

  await check("active tunnel child close posts code and stderr", async () => {
    resetHarness();
    const panel = makePanel();
    await panel._startV2("test-host");

    spawnedChildren[0].stderr.emit("data", Buffer.from("bind: Address already in use\n"));
    spawnedChildren[0].emit("close", 255);

    const errors = errorPosts();
    assert.strictEqual(errors.length, 1, "expected one status:error post");
    assert.match(errors[0].detail, /code=255/);
    assert.match(errors[0].detail, /Address already in use/);
  });

  await check("intentional stop suppresses later tunnel close error", async () => {
    resetHarness();
    const panel = makePanel();
    await panel._startV2("test-host");

    const child = spawnedChildren[0];
    panel._stopV2();
    child.emit("close", 143);

    assert.strictEqual(errorPosts().length, 0, "stop-triggered close should stay quiet");
  });

  await check("visible restored RD panel starts the stream", async () => {
    resetHarness();
    process.env.REMOTE_HOST = "test-host";
    const panel = new extension.RemoteDesktopPanel({ fsPath: "/test/ext" });

    panel.restore(fakePanel);
    await waitForAsync();

    assert.strictEqual(spawnedChildren.length, 1, "visible restored panel should start one ssh tunnel");
  });

  await check("v2 error resets state so a second reveal can reconnect", async () => {
    resetHarness();
    process.env.REMOTE_HOST = "test-host";
    const panel = makePanel();
    panel.visible = true;
    await panel._startStream();
    await waitForAsync();
    assert.strictEqual(spawnedChildren.length, 1, "first stream should start one ssh tunnel");

    panel.onMessage({ type: "v2Error", detail: "peer connection failed" });
    assert.strictEqual(spawnedChildren[0].killed, true, "v2 error should stop the active ssh tunnel");
    await panel.reveal();
    await waitForAsync();

    assert.strictEqual(spawnedChildren.length, 2, "second reveal should start a fresh ssh tunnel");
  });

  await check("stale settle timer cannot post obsolete v2Connect", async () => {
    resetHarness();
    const panel = makePanel();
    await panel._startV2("test-host");
    const firstTimer = scheduledTimers[0];
    panel._stopV2();
    await panel._startV2("test-host");

    firstTimer();
    assert.strictEqual(v2ConnectPosts().length, 0, "old timer should not post a stale v2Connect");
    scheduledTimers[1]();
    assert.strictEqual(v2ConnectPosts().length, 1, "current timer should still post v2Connect");
  });

  await check("webview ignores stale v2 events from previous connections", async () => {
    const harness = runRemoteDesktopWebview();
    harness.sendWindowMessage({ type: "v2Connect", signalUrl: "ws://127.0.0.1:1" });
    const oldSocket = harness.sockets[0];
    const oldPeer = harness.peers[0];

    harness.sendWindowMessage({ type: "v2Connect", signalUrl: "ws://127.0.0.1:2" });
    oldSocket.emit("error");
    oldSocket.emit("close", { wasClean: false, code: 1006 });
    oldPeer.connectionState = "failed";
    oldPeer.onconnectionstatechange();

    const staleErrors = harness.posted.filter((message) => message.type === "v2Error");
    assert.strictEqual(staleErrors.length, 0, "old connection events should not report v2Error");

    harness.sockets[1].emit("error");
    const currentErrors = harness.posted.filter((message) => message.type === "v2Error");
    assert.strictEqual(currentErrors.length, 1, "current connection errors should still report v2Error");
  });

  await check("webview status errors stay visible after first frame", () => {
    const script = fs.readFileSync(path.join(__dirname, "media", "remote-desktop.js"), "utf8");
    assert.match(script, /if \(m\.state === "error"\) showOverlay\(msg\);/);
    assert.match(script, /else if \(!haveFrame\) showOverlay\(msg\);/);
  });

  global.setTimeout = realSetTimeout;

  try {
    fs.rmSync(TMP_HOME, { recursive: true, force: true });
  } catch (_error) {
  }

  if (failures > 0) {
    console.error(`\n${failures} test(s) FAILED`);
    process.exit(1);
  }

  console.log("\nall remote desktop tunnel tests passed");
})();
