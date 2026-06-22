// Xpair Remote Desktop webview script (v2 WebRTC only).
// Opens a signaling WebSocket to the host `screen serve-webrtc`, negotiates a
// WebRTC peer connection, and renders the H.264 media (decoded natively) into a
// <video>. Pointer and keyboard input are forwarded over WebRTC DataChannels
// to the host input helper.
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
  let inputCapture = null;
  let seq = 0;
  let lastMoveTs = 0;

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
    badge.textContent = "control";
    badge.title = "Remote control enabled";
    badge.className = "on";
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

  function closePc2() {
    if (pc2) {
      try { pc2.close(); } catch (_e) {}
      pc2 = null;
    }
    ctlDC = null;
    moveDC = null;
  }

  function on(target, type, fn, options) {
    if (target && typeof target.addEventListener === "function") {
      target.addEventListener(type, fn, options);
    }
  }

  function ensureInputCapture() {
    if (inputCapture || !document.createElement || !stage || !stage.appendChild) return inputCapture;
    inputCapture = document.createElement("div");
    inputCapture.contentEditable = "true";
    inputCapture.setAttribute("aria-hidden", "true");
    inputCapture.setAttribute("spellcheck", "false");
    inputCapture.style.position = "absolute";
    inputCapture.style.left = "0";
    inputCapture.style.top = "0";
    inputCapture.style.width = "1px";
    inputCapture.style.height = "1px";
    inputCapture.style.opacity = "0";
    inputCapture.style.overflow = "hidden";
    inputCapture.style.pointerEvents = "none";
    stage.appendChild(inputCapture);
    on(inputCapture, "compositionend", function (e) {
      if (e.data) sendCtl({ t: "x", s: e.data });
      inputCapture.textContent = "";
    });
    on(inputCapture, "input", function (e) {
      const text = e.data || inputCapture.textContent || "";
      inputCapture.textContent = "";
      if (e.isComposing || !text) return;
      sendCtl({ t: "x", s: text });
    });
    return inputCapture;
  }

  function focusInputCapture() {
    const cap = ensureInputCapture();
    if (cap && typeof cap.focus === "function") {
      cap.focus({ preventScroll: true });
    } else if (video && typeof video.focus === "function") {
      video.focus({ preventScroll: true });
    }
  }

  function useChannel(channel) {
    if (!channel) return;
    if (channel.label === "rp-ctl") {
      ctlDC = channel;
    } else if (channel.label === "rp-move") {
      moveDC = channel;
    }
  }

  function send(channel, message) {
    if (!channel || channel.readyState !== "open") return;
    message.seq = ++seq;
    channel.send(JSON.stringify(message));
  }

  function sendCtl(message) {
    send(ctlDC, message);
  }

  function sendMove(message) {
    send(moveDC, message);
  }

  function eventPoint(e) {
    const boxTarget = video && typeof video.getBoundingClientRect === "function" ? video : stage;
    if (!boxTarget || typeof boxTarget.getBoundingClientRect !== "function") return null;
    const r = boxTarget.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const clamp = (v) => Math.max(0, Math.min(1, v));
    return {
      rx: clamp((e.clientX - r.left) / r.width),
      ry: clamp((e.clientY - r.top) / r.height),
    };
  }

  function buttonName(e) {
    return e.button === 2 ? "r" : "l";
  }

  function macFlags(e) {
    let flags = 0;
    if (e.metaKey) flags |= 0x100000;
    if (e.shiftKey) flags |= 0x020000;
    if (e.ctrlKey) flags |= 0x040000;
    if (e.altKey) flags |= 0x080000;
    return flags;
  }

  const MAC_VK = {
    Backspace: 51, Tab: 48, Enter: 36, Escape: 53, Space: 49,
    ArrowLeft: 123, ArrowRight: 124, ArrowDown: 125, ArrowUp: 126,
    Delete: 117, Home: 115, End: 119, PageUp: 116, PageDown: 121,
    KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3, KeyH: 4, KeyG: 5, KeyZ: 6, KeyX: 7,
    KeyC: 8, KeyV: 9, KeyB: 11, KeyQ: 12, KeyW: 13, KeyE: 14, KeyR: 15,
    KeyY: 16, KeyT: 17, Digit1: 18, Digit2: 19, Digit3: 20, Digit4: 21,
    Digit6: 22, Digit5: 23, Equal: 24, Digit9: 25, Digit7: 26, Minus: 27,
    Digit8: 28, Digit0: 29, BracketRight: 30, KeyO: 31, KeyU: 32,
    BracketLeft: 33, KeyI: 34, KeyP: 35, KeyL: 37, KeyJ: 38, Quote: 39,
    KeyK: 40, Semicolon: 41, Backslash: 42, Comma: 43, Slash: 44, KeyN: 45,
    KeyM: 46, Period: 47, Backquote: 50,
  };

  function installInputHandlers() {
    ensureInputCapture();
    if (stage) stage.tabIndex = 0;
    if (video) video.tabIndex = 0;

    if (video && typeof video.addEventListener === "function") {
      video.addEventListener("pointermove", function (e) {
        const now = Date.now();
        if (now - lastMoveTs < 1000 / 60) return;
        if (moveDC && moveDC.bufferedAmount > 65536) return;
        const p = eventPoint(e);
        if (!p) return;
        lastMoveTs = now;
        sendMove({ t: "m", rx: p.rx, ry: p.ry });
      });

      video.addEventListener("pointerdown", function (e) {
        focusInputCapture();
        const p = eventPoint(e);
        if (!p) return;
        if (e.preventDefault) e.preventDefault();
        sendCtl({ t: "c", rx: p.rx, ry: p.ry, btn: buttonName(e) });
      });

      video.addEventListener("contextmenu", function (e) {
        if (e.preventDefault) e.preventDefault();
      });
    }

    if (document && typeof document.addEventListener === "function") {
      document.addEventListener("keydown", function (e) {
        if (e.isComposing || e.keyCode === 229) return;
        const modified = e.metaKey || e.ctrlKey || e.altKey;
        const printable = e.key && e.key.length === 1;
        if (printable && !modified) return;
        const code = MAC_VK[e.code] !== undefined ? MAC_VK[e.code] : MAC_VK[e.key];
        if (code === undefined) return;
        if (e.preventDefault) e.preventDefault();
        sendCtl({ t: "k", code, flags: macFlags(e) });
      });
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
    if (typeof pc.createDataChannel === "function") {
      useChannel(pc.createDataChannel("rp-ctl", { ordered: true }));
      useChannel(pc.createDataChannel("rp-move", { ordered: false, maxRetransmits: 0 }));
    }
    pc.ondatachannel = function (ev) {
      useChannel(ev.channel);
    };

    let sock;
    const isCurrent = () => generation === v2Generation && pc2 === pc && ws === sock;

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
  installInputHandlers();
  setBadge();
  showOverlay("Connecting to host…");
  vscode.postMessage({ type: "ready" });
})();
