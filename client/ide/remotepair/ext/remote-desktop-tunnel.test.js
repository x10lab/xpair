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
let nextLocalPort = 31000;
function fakeSpawn(cmd, args, opts) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.cmd = cmd;
  child.args = args;
  child.opts = opts || {};
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
    const server = {
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
    return server;
  },
};

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
        get(_key, fallback) {
          return fallback;
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
  nextLocalPort = 31000;
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

function latestTimerByDelay(timers, delay) {
  for (let i = timers.length - 1; i >= 0; i -= 1) {
    if (timers[i].delay === delay && !timers[i].cleared) return timers[i];
  }
  return null;
}

function runRemoteDesktopWebview() {
  const script = fs.readFileSync(path.join(__dirname, "media", "remote-desktop.js"), "utf8");
  const posted = [];
  const timers = [];
  const windowListeners = [];
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      const listeners = new Map();
      elements.set(id, {
        id,
        textContent: "",
        style: {},
        srcObject: null,
        className: "",
        readyState: 0,
        classList: {
          add() {},
          remove() {},
        },
        setAttribute() {},
        appendChild() {},
        focus() {},
        addEventListener(type, fn) {
          const existing = listeners.get(type) || [];
          existing.push(fn);
          listeners.set(type, existing);
        },
        emit(type, event = {}) {
          for (const listener of listeners.get(type) || []) {
            listener(event);
          }
        },
        getBoundingClientRect() {
          return { left: 0, top: 0, width: 100, height: 100 };
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
      this.iceConnectionState = "new";
      this.onconnectionstatechange = null;
      this.oniceconnectionstatechange = null;
      this.onicecandidate = null;
      this.ontrack = null;
      FakeRTCPeerConnection.instances.push(this);
    }
    addTransceiver() {}
    createDataChannel(label) {
      return {
        label,
        readyState: "connecting",
        bufferedAmount: 0,
        addEventListener() {},
        send() {},
      };
    }
    close() {
      this.closed = true;
      this.connectionState = "closed";
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
    document: {
      body: element("body"),
      activeElement: element("body"),
      createElement: element,
      getElementById: element,
      addEventListener() {},
    },
    window: { addEventListener(type, listener) { if (type === "message") windowListeners.push(listener); } },
    WebSocket: FakeWebSocket,
    RTCPeerConnection: FakeRTCPeerConnection,
    setTimeout(fn, delay, ...args) {
      function timer() {
        if (!timer.cleared) fn(...args);
      }
      timer.delay = delay;
      timer.cleared = false;
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timer.cleared = true;
    },
    console,
  };
  vm.runInNewContext(script, sandbox, { filename: "remote-desktop.js" });
  return {
    posted,
    sockets: FakeWebSocket.instances,
    peers: FakeRTCPeerConnection.instances,
    timers,
    elements,
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
    const source = fs.readFileSync(path.join(__dirname, "extension.js"), "utf8");
    assert.match(source, /context\.subscriptions\.push\(panel\)/, "RD panel must be disposed on extension deactivate");
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

  await check("local bind collision picks a fresh port instead of hard-failing", async () => {
    resetHarness();
    const panel = makePanel();
    await panel._startV2("test-host");

    spawnedChildren[0].stderr.emit("data", Buffer.from("bind: Address already in use\n"));
    spawnedChildren[0].emit("close", 255);

    assert.strictEqual(errorPosts().length, 0, "bind collision must not surface a hard error");
    const retry = latestTimerByDelay(scheduledTimers, 150);
    assert.ok(retry, "bind collision should schedule a short fresh-port retry");
    retry();
    await waitForAsync();
    assert.strictEqual(spawnedChildren.length, 2, "retry should spawn a fresh ssh tunnel");
    assert.notDeepStrictEqual(spawnedChildren[0].args, spawnedChildren[1].args, "retry should use a new local port");
  });

  await check("transient tunnel close (1Password agent refused) lazily retries, no hard error", async () => {
    resetHarness();
    const panel = makePanel();
    await panel._startV2("test-host");
    // 1Password momentarily locked → ssh-agent refuses to sign → tunnel exits 255.
    spawnedChildren[0].stderr.emit(
      "data",
      Buffer.from("sign_and_send_pubkey: signing failed for ED25519 from agent: agent refused operation\n")
    );
    spawnedChildren[0].emit("close", 255);
    assert.strictEqual(errorPosts().length, 0, "transient close must not surface a hard error");
    const connecting = postedMessages.filter((m) => m.type === "status" && m.state === "connecting");
    assert.ok(connecting.length >= 1, "transient close should post a reconnecting status");
    // firing the scheduled retry re-spawns the tunnel (lazy reconnect)
    scheduledTimers[scheduledTimers.length - 1]();
    await waitForAsync();
    assert.strictEqual(spawnedChildren.length, 2, "retry should spawn a fresh tunnel");
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
    const posts = v2ConnectPosts();
    assert.strictEqual(posts.length, 1, "current timer should still post v2Connect");
    assert.match(posts[0].signalUrl, /^ws:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]{64}&fps=30&bitrate=4000000&scale=1$/);
    assert.match(posts[0].sessionToken, /^[0-9a-f]{64}$/);
  });

  await check("RemoteDesktopPanel dispose tears down active RD tunnel", async () => {
    resetHarness();
    const panel = makePanel();
    await panel._startV2("test-host");
    assert.strictEqual(spawnedChildren.length, 1, "expected one active tunnel");

    panel.dispose();

    assert.strictEqual(spawnedChildren[0].killed, true, "dispose should stop the active tunnel");
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
    assert.strictEqual(
      harness.posted.filter((message) => message.type === "v2Error").length,
      0,
      "current transient signaling errors should enter reconnect before terminal v2Error"
    );
    const reconnect = latestTimerByDelay(harness.timers, 500);
    assert.ok(reconnect, "current signaling error should schedule bounded reconnect");
    reconnect();
    assert.strictEqual(harness.sockets.length, 3, "bounded reconnect should open a fresh signaling socket");
  });

  await check("webview reconnects on media drop, disconnected grace, 1006, and first-frame timeout", async () => {
    let harness = runRemoteDesktopWebview();
    harness.sendWindowMessage({ type: "v2Connect", signalUrl: "ws://127.0.0.1:1/?token=aaaaaaaaaaaaaaaaaaaaaaaa" });
    harness.peers[0].connectionState = "failed";
    harness.peers[0].onconnectionstatechange();
    assert.strictEqual(harness.posted.filter((message) => message.type === "v2Error").length, 0);
    latestTimerByDelay(harness.timers, 500)();
    assert.strictEqual(harness.sockets.length, 2, "failed peer should reconnect with a new WebSocket");

    harness = runRemoteDesktopWebview();
    harness.sendWindowMessage({ type: "v2Connect", signalUrl: "ws://127.0.0.1:2/?token=bbbbbbbbbbbbbbbbbbbbbbbb" });
    harness.peers[0].connectionState = "disconnected";
    harness.peers[0].onconnectionstatechange();
    const grace = latestTimerByDelay(harness.timers, 3000);
    assert.ok(grace, "disconnected should arm a grace timer");
    grace();
    latestTimerByDelay(harness.timers, 500)();
    assert.strictEqual(harness.sockets.length, 2, "disconnected grace expiry should reconnect");

    harness = runRemoteDesktopWebview();
    harness.sendWindowMessage({ type: "v2Connect", signalUrl: "ws://127.0.0.1:3/?token=cccccccccccccccccccccccc" });
    harness.sockets[0].emit("close", { wasClean: false, code: 1006 });
    latestTimerByDelay(harness.timers, 500)();
    assert.strictEqual(harness.sockets.length, 2, "abnormal signaling close should reconnect");

    harness = runRemoteDesktopWebview();
    harness.sendWindowMessage({ type: "v2Connect", signalUrl: "ws://127.0.0.1:4/?token=dddddddddddddddddddddddd" });
    latestTimerByDelay(harness.timers, 15000)();
    latestTimerByDelay(harness.timers, 500)();
    assert.strictEqual(harness.sockets.length, 2, "first-frame timeout should reconnect");

    const currentErrors = harness.posted.filter((message) => message.type === "v2Error");
    assert.strictEqual(currentErrors.length, 0, "reconnectable media drops should not be terminal immediately");
  });

  await check("webview reports first frame only after decoded video, not on track negotiation", () => {
    const harness = runRemoteDesktopWebview();
    harness.sendWindowMessage({ type: "v2Connect", signalUrl: "ws://127.0.0.1:5/?token=eeeeeeeeeeeeeeeeeeeeeeee" });
    harness.peers[0].ontrack({ streams: [{ id: "media" }] });
    assert.strictEqual(
      harness.posted.filter((message) => message.type === "v2FirstFrame").length,
      0,
      "ontrack alone must not report first frame"
    );
    harness.elements.get("screen-video").emit("timeupdate");
    assert.strictEqual(
      harness.posted.filter((message) => message.type === "v2FirstFrame").length,
      1,
      "decoded-frame fallback should report first frame"
    );
  });

  await check("webview status errors stay visible after first frame", () => {
    const script = fs.readFileSync(path.join(__dirname, "media", "remote-desktop.js"), "utf8");
    assert.match(script, /if \(m\.state === "error"\) showOverlay\(msg\);/);
    assert.match(script, /else if \(!haveFrame\) showOverlay\(msg\);/);
  });

  global.setTimeout = realSetTimeout;
  global.clearTimeout = realClearTimeout;

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
