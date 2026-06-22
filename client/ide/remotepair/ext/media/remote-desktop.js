// Xpair Remote Desktop webview script (v2 WebRTC only).
// Opens a signaling WebSocket to the host `screen serve-webrtc`, negotiates a
// WebRTC peer connection, and renders the H.264 media (decoded natively) into a
// <video>. Host-created DataChannels carry pointer, key, and text input back to
// the host-side input injector.
(function () {
  "use strict";
  const vscode = acquireVsCodeApi();

  const stage = document.getElementById("stage");
  const video = document.getElementById("screen-video");
  const overlay = document.getElementById("overlay");
  const overlayMsg = document.getElementById("overlay-msg");
  const badge = document.getElementById("badge");

  let haveFrame = false;
  let ctlDC = null;
  let moveDC = null;
  let inputSeq = 0;
  let lastMoveTs = 0;
  const MOVE_MIN_MS = 1000 / 60;

  const inputCapture = document.createElement("div");
  inputCapture.contentEditable = "true";
  inputCapture.setAttribute("aria-hidden", "true");
  inputCapture.style.cssText =
    "position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;overflow:hidden;";
  if (stage) {
    stage.tabIndex = 0;
    stage.appendChild(inputCapture);
  }

  const MAC_KEY_CODE_BY_CODE = {
    KeyA: 0,
    KeyS: 1,
    KeyD: 2,
    KeyF: 3,
    KeyH: 4,
    KeyG: 5,
    KeyZ: 6,
    KeyX: 7,
    KeyC: 8,
    KeyV: 9,
    KeyB: 11,
    KeyQ: 12,
    KeyW: 13,
    KeyE: 14,
    KeyR: 15,
    KeyY: 16,
    KeyT: 17,
    Digit1: 18,
    Digit2: 19,
    Digit3: 20,
    Digit4: 21,
    Digit6: 22,
    Digit5: 23,
    Equal: 24,
    Digit9: 25,
    Digit7: 26,
    Minus: 27,
    Digit8: 28,
    Digit0: 29,
    BracketRight: 30,
    KeyO: 31,
    KeyU: 32,
    BracketLeft: 33,
    KeyI: 34,
    KeyP: 35,
    KeyL: 37,
    KeyJ: 38,
    Quote: 39,
    KeyK: 40,
    Semicolon: 41,
    Backslash: 42,
    Comma: 43,
    Slash: 44,
    KeyN: 45,
    KeyM: 46,
    Period: 47,
    Tab: 48,
    Space: 49,
    Backquote: 50,
    Backspace: 51,
    Escape: 53,
    F1: 122,
    F2: 120,
    F3: 99,
    F4: 118,
    F5: 96,
    F6: 97,
    F7: 98,
    F8: 100,
    F9: 101,
    F10: 109,
    F11: 103,
    F12: 111,
    Home: 115,
    PageUp: 116,
    Delete: 117,
    End: 119,
    PageDown: 121,
    ArrowLeft: 123,
    ArrowRight: 124,
    ArrowDown: 125,
    ArrowUp: 126,
  };

  // v2 (WebRTC) state
  let ws = null; // signaling WebSocket
  let pc2 = null;
  let v2Mode = false;
  let v2FirstFrameReported = false;
  let v2Generation = 0;

  // -------------------------------------------------------------------------
  // Overlay helpers
  // -------------------------------------------------------------------------

  function dcOpen(dc) {
    return dc && dc.readyState === "open";
  }

  function setBadge() {
    const open = dcOpen(ctlDC) || dcOpen(moveDC);
    badge.textContent = open ? "control" : "connecting";
    badge.className = open ? "on" : "off";
    badge.title = open ? "Remote control connected" : "Remote control waiting for input channels";
  }

  function showOverlay(msg) {
    overlayMsg.textContent = msg;
    overlay.classList.remove("hidden");
  }
  function hideOverlay() {
    overlay.classList.add("hidden");
  }

  function closeWs() {
    if (ws) {
      try { ws.close(); } catch (_e) {}
      ws = null;
    }
  }

  // -------------------------------------------------------------------------
  // v2 WebRTC stream (UDP/RTP H.264). Signaling over a WS to the sidecar's
  // serve-webrtc; media is decoded natively by the browser/Chromium WebRTC
  // stack into a <video> (cross-platform — no manual decode).
  // -------------------------------------------------------------------------

  function clearInputChannels() {
    ctlDC = null;
    moveDC = null;
    lastMoveTs = 0;
    setBadge();
  }

  function closePc2() {
    if (pc2) {
      try { pc2.close(); } catch (_e) {}
      pc2 = null;
    }
    clearInputChannels();
  }

  function bindInputChannel(channel) {
    if (!channel) return;
    if (channel.label === "rp-ctl") {
      ctlDC = channel;
    } else if (channel.label === "rp-move") {
      moveDC = channel;
    } else {
      return;
    }
    channel.addEventListener("open", setBadge);
    channel.addEventListener("close", function () {
      if (ctlDC === channel) ctlDC = null;
      if (moveDC === channel) moveDC = null;
      setBadge();
    });
    channel.addEventListener("error", setBadge);
    setBadge();
  }

  function send(dataChannel, payload) {
    if (!dcOpen(dataChannel)) return false;
    payload.seq = ++inputSeq;
    try {
      dataChannel.send(JSON.stringify(payload));
      return true;
    } catch (_e) {
      return false;
    }
  }

  function focusInputCapture() {
    try {
      inputCapture.focus({ preventScroll: true });
    } catch (_e) {
      try { inputCapture.focus(); } catch (_ignored) {}
    }
  }

  function relativePoint(ev) {
    const rect = video.getBoundingClientRect();
    const width = rect.width || 1;
    const height = rect.height || 1;
    return {
      rx: Math.max(0, Math.min(1, (ev.clientX - rect.left) / width)),
      ry: Math.max(0, Math.min(1, (ev.clientY - rect.top) / height)),
    };
  }

  function macFlags(ev) {
    let flags = 0;
    if (ev.metaKey) flags |= 0x100000;
    if (ev.shiftKey) flags |= 0x020000;
    if (ev.ctrlKey) flags |= 0x040000;
    if (ev.altKey) flags |= 0x080000;
    return flags;
  }

  function macKeyCode(ev) {
    return MAC_KEY_CODE_BY_CODE[ev.code];
  }

  function handlePointerDown(ev) {
    focusInputCapture();
    if (!dcOpen(ctlDC)) return;
    ev.preventDefault();
    const c = relativePoint(ev);
    send(ctlDC, { t: "c", rx: c.rx, ry: c.ry, btn: ev.button === 2 ? "r" : "l" });
  }

  function handlePointerMove(ev) {
    if (!dcOpen(moveDC)) return;
    const now = Date.now();
    if (now - lastMoveTs < MOVE_MIN_MS || moveDC.bufferedAmount > 65536) return;
    lastMoveTs = now;
    const c = relativePoint(ev);
    send(moveDC, { t: "m", rx: c.rx, ry: c.ry });
  }

  function handleKeyDown(ev) {
    if (!dcOpen(ctlDC) || ev.isComposing || ev.keyCode === 229) return;
    const hasModifier = ev.metaKey || ev.ctrlKey || ev.altKey;
    if (ev.key && ev.key.length === 1 && !hasModifier) return;
    const code = macKeyCode(ev);
    if (code === undefined) return;
    ev.preventDefault();
    send(ctlDC, { t: "k", code, flags: macFlags(ev) });
  }

  function handleInput(ev) {
    inputCapture.textContent = "";
    if (!dcOpen(ctlDC) || ev.isComposing) return;
    if (ev.inputType === "insertText" && ev.data) {
      send(ctlDC, { t: "x", s: ev.data });
    }
  }

  function handleCompositionEnd(ev) {
    inputCapture.textContent = "";
    if (dcOpen(ctlDC) && ev.data) {
      send(ctlDC, { t: "x", s: ev.data });
    }
  }

  function connectV2(signalUrl) {
    const generation = ++v2Generation;
    closeWs();
    closePc2();
    v2Mode = true;
    v2FirstFrameReported = false;

    video.style.display = "block";
    showOverlay("connecting (WebRTC)…");

    const pc = new RTCPeerConnection({ iceServers: [] }); // host candidates (loopback/LAN/VPN)
    pc2 = pc;
    pc.addTransceiver("video", { direction: "recvonly" });

    let sock;
    const isCurrent = () => generation === v2Generation && pc2 === pc && ws === sock;

    pc.ondatachannel = function (ev) {
      if (!isCurrent()) return;
      bindInputChannel(ev.channel);
    };
    pc.ontrack = function (ev) {
      if (!isCurrent()) return;
      video.srcObject = ev.streams[0];
      if (!haveFrame) { haveFrame = true; hideOverlay(); }
      if (!v2FirstFrameReported) {
        v2FirstFrameReported = true;
        vscode.postMessage({ type: "v2FirstFrame" });
      }
    };
    pc.onconnectionstatechange = function () {
      if (isCurrent() && pc.connectionState === "failed") {
        vscode.postMessage({ type: "v2Error", detail: "peer connection failed" });
      }
    };

    try {
      sock = new WebSocket(signalUrl);
    } catch (e) {
      vscode.postMessage({ type: "v2Error", detail: "WebSocket ctor threw: " + String(e) });
      return;
    }
    ws = sock;

    pc.onicecandidate = function (ev) {
      if (isCurrent() && ev.candidate && ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: "candidate",
          candidate: ev.candidate.candidate,
          sdpMid: ev.candidate.sdpMid,
          sdpMLineIndex: ev.candidate.sdpMLineIndex,
        }));
      }
    };

    sock.addEventListener("open", function () {
      if (!isCurrent()) return;
      showOverlay("v2: signaling connected, negotiating…");
    });
    sock.addEventListener("message", async function (ev) {
      if (!isCurrent()) return;
      let m;
      try { m = JSON.parse(ev.data); } catch (_e) { return; }
      if (m.type === "offer") {
        await pc.setRemoteDescription({ type: "offer", sdp: m.sdp });
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        if (isCurrent()) {
          ws.send(JSON.stringify({ type: "answer", sdp: ans.sdp }));
        }
      } else if (m.type === "candidate") {
        try {
          if (isCurrent()) {
            await pc.addIceCandidate({ candidate: m.candidate, sdpMid: m.sdpMid, sdpMLineIndex: m.sdpMLineIndex });
          }
        } catch (_e) { /* non-fatal */ }
      }
    });
    sock.addEventListener("error", function () {
      if (!isCurrent()) return;
      vscode.postMessage({ type: "v2Error", detail: "signaling WebSocket error on " + signalUrl });
    });
    sock.addEventListener("close", function (ev) {
      if (isCurrent() && v2Mode && !ev.wasClean) {
        vscode.postMessage({ type: "v2Error", detail: "signaling closed (code=" + ev.code + ")" });
      }
    });
  }

  if (stage) {
    stage.addEventListener("pointerdown", handlePointerDown);
    stage.addEventListener("pointermove", handlePointerMove);
  } else {
    video.addEventListener("pointerdown", handlePointerDown);
    video.addEventListener("pointermove", handlePointerMove);
  }
  window.addEventListener("keydown", handleKeyDown);
  inputCapture.addEventListener("input", handleInput);
  inputCapture.addEventListener("compositionend", handleCompositionEnd);

  // -------------------------------------------------------------------------
  // Messages from the extension
  // -------------------------------------------------------------------------

  window.addEventListener("message", function (e) {
    const m = e.data;
    if (!m || typeof m !== "object") return;

    if (m.type === "v2Connect") {
      // Extension tells webview to open a WebRTC session (signaling URL).
      connectV2(m.signalUrl);
      return;
    }

    if (m.type === "status") {
      let msg = "Connecting to host…";
      if (m.state === "no-host") {
        msg = "REMOTE_HOST is not set in ~/.xpair/host/client.env";
      } else if (m.state === "error") {
        msg = "Error: " + (m.detail || "unknown") +
          "\nIs XpairHost.app running on the host (screen serve-webrtc)?";
      }
      if (m.state === "error") showOverlay(msg);
      else if (!haveFrame) showOverlay(msg);
    }
  });

  // -------------------------------------------------------------------------
  // Init
  // -------------------------------------------------------------------------

  video.style.display = "block";
  setBadge();
  showOverlay("Connecting to host…");
  vscode.postMessage({ type: "ready" });
})();
