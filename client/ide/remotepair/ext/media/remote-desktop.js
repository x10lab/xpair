// Xpair Remote Desktop webview script (v2 WebRTC only).
// Opens a signaling WebSocket to the host `screen serve-webrtc`, negotiates a
// WebRTC peer connection, and renders the H.264 media (decoded natively) into a
// <video>. Host input is forwarded over the v2 RD DataChannels when available.
(function () {
  "use strict";
  const vscode = acquireVsCodeApi();

  const stage = document.getElementById("stage");
  const video = document.getElementById("screen-video");
  const overlay = document.getElementById("overlay");
  const overlayMsg = document.getElementById("overlay-msg");
  const badge = document.getElementById("badge");

  let haveFrame = false;
  let inputArmed = false;
  let inputSeq = 0;
  let ctlDC = null;
  let moveDC = null;
  let lastMoveTs = 0;
  const MOVE_MIN_MS = 1000 / 60;
  const BUFFER_LIMIT = 65536;
  const MAC_VK = {
    KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3, KeyH: 4, KeyG: 5, KeyZ: 6, KeyX: 7,
    KeyC: 8, KeyV: 9, KeyB: 11, KeyQ: 12, KeyW: 13, KeyE: 14, KeyR: 15,
    KeyY: 16, KeyT: 17, Digit1: 18, Digit2: 19, Digit3: 20, Digit4: 21,
    Digit6: 22, Digit5: 23, Equal: 24, Digit9: 25, Digit7: 26, Minus: 27,
    Digit8: 28, Digit0: 29, BracketRight: 30, KeyO: 31, KeyU: 32,
    BracketLeft: 33, KeyI: 34, KeyP: 35, Enter: 36, KeyL: 37, KeyJ: 38,
    Quote: 39, KeyK: 40, Semicolon: 41, Backslash: 42, Comma: 43, Slash: 44,
    KeyN: 45, KeyM: 46, Period: 47, Tab: 48, Space: 49, Backquote: 50,
    Backspace: 51, Escape: 53, MetaLeft: 55, ShiftLeft: 56, CapsLock: 57,
    AltLeft: 58, ControlLeft: 59, ShiftRight: 60, AltRight: 61, ControlRight: 62,
    NumpadDecimal: 65, NumpadMultiply: 67, NumpadAdd: 69, NumpadDivide: 75,
    NumpadEnter: 76, NumpadSubtract: 78, NumpadEqual: 81, Numpad0: 82,
    Numpad1: 83, Numpad2: 84, Numpad3: 85, Numpad4: 86, Numpad5: 87,
    Numpad6: 88, Numpad7: 89, Numpad8: 91, Numpad9: 92, F5: 96, F6: 97,
    F7: 98, F3: 99, F8: 100, F9: 101, F11: 103, F13: 105, F16: 106,
    F14: 107, F10: 109, F12: 111, F15: 113, Home: 115, PageUp: 116,
    Delete: 117, F4: 118, End: 119, F2: 120, PageDown: 121, F1: 122,
    ArrowLeft: 123, ArrowRight: 124, ArrowDown: 125, ArrowUp: 126,
  };

  const textCapture = typeof document.createElement === "function"
    ? document.createElement("div")
    : {
        contentEditable: "",
        style: {},
        textContent: "",
        setAttribute() {},
        addEventListener() {},
        focus() {},
      };
  textCapture.contentEditable = "true";
  textCapture.setAttribute("aria-hidden", "true");
  textCapture.style.position = "absolute";
  textCapture.style.left = "0";
  textCapture.style.top = "0";
  textCapture.style.width = "1px";
  textCapture.style.height = "1px";
  textCapture.style.opacity = "0";
  textCapture.style.pointerEvents = "none";
  textCapture.style.overflow = "hidden";
  if (stage && typeof stage.appendChild === "function") {
    stage.appendChild(textCapture);
  }
  video.tabIndex = 0;

  // v2 (WebRTC) state
  let ws = null; // signaling WebSocket
  let pc2 = null;
  let v2Mode = false;
  let v2FirstFrameReported = false;
  let v2Generation = 0;

  // -------------------------------------------------------------------------
  // Overlay helpers
  // -------------------------------------------------------------------------

  function showOverlay(msg) {
    overlayMsg.textContent = msg;
    overlay.classList.remove("hidden");
  }
  function hideOverlay() {
    overlay.classList.add("hidden");
  }

  function setBadge() {
    const inputOn = ctlDC && ctlDC.readyState === "open";
    badge.textContent = inputOn ? "input on" : "input pending";
    badge.className = inputOn ? "on" : "off";
  }

  function closeWs() {
    if (ws) {
      try { ws.close(); } catch (_e) {}
      ws = null;
    }
  }

  function resetInputChannels() {
    ctlDC = null;
    moveDC = null;
    inputSeq = 0;
    setBadge();
  }

  function wireInputChannel(channel) {
    if (!channel || (channel.label !== "rp-ctl" && channel.label !== "rp-move")) return;
    if (channel.label === "rp-ctl") ctlDC = channel;
    else moveDC = channel;
    if (typeof channel.addEventListener === "function") {
      channel.addEventListener("open", setBadge);
      channel.addEventListener("close", setBadge);
      channel.addEventListener("error", setBadge);
    }
    setBadge();
  }

  function sendInput(channel, input) {
    if (!channel || channel.readyState !== "open" || channel.bufferedAmount > BUFFER_LIMIT) return false;
    input.seq = ++inputSeq;
    try {
      channel.send(JSON.stringify(input));
      return true;
    } catch (_e) {
      return false;
    }
  }

  function sendControlInput(input) {
    return sendInput(ctlDC, input);
  }

  function sendMoveInput(input) {
    return sendInput(moveDC, input);
  }

  function armInput() {
    inputArmed = true;
    try { textCapture.focus({ preventScroll: true }); } catch (_e) { textCapture.focus(); }
  }

  function relativePoint(ev) {
    const r = video.getBoundingClientRect();
    const rx = r.width ? (ev.clientX - r.left) / r.width : 0;
    const ry = r.height ? (ev.clientY - r.top) / r.height : 0;
    return {
      rx: Math.max(0, Math.min(1, rx)),
      ry: Math.max(0, Math.min(1, ry)),
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

  function shouldHandleKeyboard(_ev) {
    if (!inputArmed) return false;
    const active = document.activeElement;
    return active === textCapture || active === video || active === document.body;
  }

  function clearCapturedText() {
    textCapture.textContent = "";
  }

  // -------------------------------------------------------------------------
  // v2 WebRTC stream (UDP/RTP H.264). Signaling over a WS to the sidecar's
  // serve-webrtc; media is decoded natively by the browser/Chromium WebRTC
  // stack into a <video> (cross-platform — no manual decode).
  // -------------------------------------------------------------------------

  function closePc2() {
    if (pc2) {
      try { pc2.close(); } catch (_e) {}
      pc2 = null;
    }
    resetInputChannels();
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
    if (typeof pc.createDataChannel === "function") {
      wireInputChannel(pc.createDataChannel("rp-ctl"));
      wireInputChannel(pc.createDataChannel("rp-move"));
    }

    let sock;
    const isCurrent = () => generation === v2Generation && pc2 === pc && ws === sock;

    pc.ondatachannel = function (ev) {
      if (!isCurrent()) return;
      wireInputChannel(ev.channel);
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

  // -------------------------------------------------------------------------
  // Remote input capture
  // -------------------------------------------------------------------------

  if (video && typeof video.addEventListener === "function") {
  video.addEventListener("pointerdown", function (ev) {
    armInput();
    if (typeof video.setPointerCapture === "function") {
      try { video.setPointerCapture(ev.pointerId); } catch (_e) {}
    }
    const p = relativePoint(ev);
    const btn = ev.button === 2 ? "r" : "l";
    if (sendControlInput({ t: "c", rx: p.rx, ry: p.ry, btn })) {
      ev.preventDefault();
    }
  });

  video.addEventListener("pointermove", function (ev) {
    const now = Date.now();
    if (now - lastMoveTs < MOVE_MIN_MS) return;
    const p = relativePoint(ev);
    if (sendMoveInput({ t: "m", rx: p.rx, ry: p.ry })) {
      lastMoveTs = now;
      ev.preventDefault();
    }
  });

  video.addEventListener("wheel", function (ev) {
    armInput();
    if (sendControlInput({ t: "w", dx: ev.deltaX, dy: ev.deltaY, mode: ev.deltaMode })) {
      ev.preventDefault();
    }
  }, { passive: false });

  video.addEventListener("contextmenu", function (ev) {
    ev.preventDefault();
  });

  document.addEventListener("keydown", function (ev) {
    if (!shouldHandleKeyboard(ev)) return;
    if (ev.isComposing || ev.keyCode === 229) return;
    const modified = ev.metaKey || ev.ctrlKey || ev.altKey;
    const printable = ev.key && ev.key.length === 1;
    if (printable && !modified) return;
    const code = MAC_VK[ev.code];
    if (code === undefined) return;
    if (sendControlInput({ t: "k", code, flags: macFlags(ev) })) {
      ev.preventDefault();
    }
  });

  textCapture.addEventListener("compositionend", function (ev) {
    if (ev.data) sendControlInput({ t: "x", s: ev.data });
    clearCapturedText();
  });

  textCapture.addEventListener("input", function (ev) {
    if (ev.isComposing) return;
    const text = ev.data || textCapture.textContent;
    if (text) sendControlInput({ t: "x", s: text });
    clearCapturedText();
  });
  }

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
