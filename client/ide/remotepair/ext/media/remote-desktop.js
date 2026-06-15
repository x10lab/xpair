// RemotePair Remote Desktop webview script (v2 WebRTC only).
// Opens a signaling WebSocket to the host `screen serve-webrtc`, negotiates a
// WebRTC peer connection, and renders the H.264 media (decoded natively) into a
// <video>. Cursor/keyboard input is captured here and sent over WebRTC
// DataChannels (rp-ctl / rp-move) — IME-aware so Korean composes correctly.
(function () {
  "use strict";
  const vscode = acquireVsCodeApi();

  const video = document.getElementById("screen-video");
  const overlay = document.getElementById("overlay");
  const overlayMsg = document.getElementById("overlay-msg");
  const badge = document.getElementById("badge");
  const stage = document.getElementById("stage");

  let inputEnabled = false;
  let haveFrame = false;

  // v2 (WebRTC) state
  let ws = null; // signaling WebSocket
  let pc2 = null;
  let v2Mode = false;
  let v2FirstFrameReported = false;

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
    badge.textContent = "input: " + (inputEnabled ? "on" : "off");
    badge.className = inputEnabled ? "on" : "off";
  }

  // Relative coordinate (0..1) from a pointer event over the <video> surface.
  function relCoords(ev) {
    const rect = video.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const rx = (ev.clientX - rect.left) / rect.width;
    const ry = (ev.clientY - rect.top) / rect.height;
    if (rx < 0 || rx > 1 || ry < 0 || ry > 1) return null;
    return { rx, ry };
  }

  // Stage is focusable so the IME catcher can receive composition events.
  stage.tabIndex = 0;

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
  }

  // -------------------------------------------------------------------------
  // v2 input capture (Step 3): IME-aware split — completed Unicode text via
  // composition/input events (Korean-safe), shortcuts/non-printable via keydown.
  // Sends over two host-created DataChannels: rp-ctl (reliable) / rp-move (lossy).
  // -------------------------------------------------------------------------

  // JS KeyboardEvent.code -> macOS virtual keycode (for shortcuts / non-printable)
  const MAC_VK = {
    KeyA:0,KeyS:1,KeyD:2,KeyF:3,KeyH:4,KeyG:5,KeyZ:6,KeyX:7,KeyC:8,KeyV:9,KeyB:11,
    KeyQ:12,KeyW:13,KeyE:14,KeyR:15,KeyY:16,KeyT:17,Digit1:18,Digit2:19,Digit3:20,
    Digit4:21,Digit6:22,Digit5:23,Digit9:25,Digit7:26,Digit8:28,Digit0:29,KeyO:31,
    KeyU:32,KeyI:34,KeyP:35,Enter:36,KeyL:37,KeyJ:38,KeyK:40,KeyN:45,KeyM:46,
    Tab:48,Space:49,Backspace:51,Escape:53,ArrowLeft:123,ArrowRight:124,
    ArrowDown:125,ArrowUp:126,
  };
  function macFlags(ev) {
    let f = 0;
    if (ev.metaKey) f |= 0x100000;  // cmd
    if (ev.shiftKey) f |= 0x20000;
    if (ev.ctrlKey) f |= 0x40000;
    if (ev.altKey) f |= 0x80000;
    return f;
  }

  let ctlDC = null, moveDC = null, inSeq = 0;
  let lastMoveTs = 0;
  const MOVE_MIN_MS = 1000 / 60; // ≤60 Hz (B4)

  function dcSend(dc, obj) {
    if (!dc || dc.readyState !== "open") return;
    obj.seq = ++inSeq;
    try { dc.send(JSON.stringify(obj)); } catch (_e) {}
  }

  // Hidden focusable catcher: the IME composes here so we get composition/input
  // events (a <video> never fires them). Kept off-screen + transparent.
  let imeCatcher = null;
  function ensureCatcher() {
    if (imeCatcher) return imeCatcher;
    const el = document.createElement("div");
    el.contentEditable = "true";
    el.setAttribute("autocorrect", "off");
    el.setAttribute("autocapitalize", "off");
    el.style.cssText =
      "position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;" +
      "outline:none;border:0;overflow:hidden;z-index:-1;";
    el.addEventListener("compositionend", function (ev) {
      if (!v2Mode || !inputEnabled || !ctlDC) return;
      if (ev.data) dcSend(ctlDC, { t: "x", s: ev.data });
      el.textContent = "";
    });
    el.addEventListener("input", function (ev) {
      if (!v2Mode || !inputEnabled || !ctlDC) return;
      el.textContent = ""; // never accumulate
      if (ev.isComposing) return; // composition handled by compositionend
      if (ev.inputType === "insertText" && ev.data) dcSend(ctlDC, { t: "x", s: ev.data });
    });
    stage.appendChild(el);
    imeCatcher = el;
    return el;
  }

  function setupV2Input(pc) {
    ctlDC = null; moveDC = null;
    ensureCatcher();
    pc.ondatachannel = function (ev) {
      const dc = ev.channel;
      if (dc.label === "rp-ctl") ctlDC = dc;
      else if (dc.label === "rp-move") moveDC = dc;
      dc.onopen = function () { /* ready */ };
    };
  }

  // mouse move -> rp-move (throttle + coalesce + bufferedAmount guard) (B4)
  stage.addEventListener("mousemove", function (ev) {
    if (!v2Mode || !inputEnabled || !haveFrame || !moveDC || moveDC.readyState !== "open") return;
    const now = Date.now();
    if (now - lastMoveTs < MOVE_MIN_MS) return;
    if (moveDC.bufferedAmount > 64 * 1024) return; // drop instead of queue
    const c = relCoords(ev);
    if (!c) return;
    lastMoveTs = now;
    dcSend(moveDC, { t: "m", rx: c.rx, ry: c.ry });
  });
  // click -> rp-ctl. Also focus the IME catcher so subsequent typing composes there.
  stage.addEventListener("mousedown", function (ev) {
    if (!v2Mode || !inputEnabled || !haveFrame || !ctlDC) return;
    if (imeCatcher) imeCatcher.focus();
    const c = relCoords(ev);
    if (!c) return;
    dcSend(ctlDC, { t: "c", rx: c.rx, ry: c.ry, btn: ev.button === 2 ? "r" : "l" });
  });
  // keydown -> rp-ctl ONLY for shortcuts / non-printable. Printable text is
  // routed via input/compositionend (so Korean composes correctly).
  document.addEventListener("keydown", function (ev) {
    if (!v2Mode || !inputEnabled || !haveFrame || !ctlDC) return;
    if (ev.isComposing || ev.keyCode === 229) return; // IME composing — defer to compositionend
    const hasMod = ev.metaKey || ev.ctrlKey || ev.altKey;
    const printable = ev.key && ev.key.length === 1;
    if (printable && !hasMod) return; // plain text -> handled by 'input' below
    const code = MAC_VK[ev.code];
    if (code === undefined) return;
    ev.preventDefault();
    dcSend(ctlDC, { t: "k", code: code, flags: macFlags(ev) });
  });
  // (completed-text capture lives on the IME catcher created in ensureCatcher)

  function connectV2(signalUrl) {
    closeWs();
    closePc2();
    v2Mode = true;
    v2FirstFrameReported = false;

    video.style.display = "block";
    showOverlay("connecting (WebRTC)…");

    const pc = new RTCPeerConnection({ iceServers: [] }); // host candidates (loopback/LAN/VPN)
    pc2 = pc;
    pc.addTransceiver("video", { direction: "recvonly" });
    setupV2Input(pc);

    pc.ontrack = function (ev) {
      video.srcObject = ev.streams[0];
      if (!haveFrame) { haveFrame = true; hideOverlay(); }
      if (!v2FirstFrameReported) {
        v2FirstFrameReported = true;
        vscode.postMessage({ type: "v2FirstFrame" });
      }
    };
    pc.onconnectionstatechange = function () {
      if (pc.connectionState === "failed") {
        vscode.postMessage({ type: "v2Error", detail: "peer connection failed" });
      }
    };

    let sock;
    try {
      sock = new WebSocket(signalUrl);
    } catch (e) {
      vscode.postMessage({ type: "v2Error", detail: "WebSocket ctor threw: " + String(e) });
      return;
    }
    ws = sock;

    pc.onicecandidate = function (ev) {
      if (ev.candidate && ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: "candidate",
          candidate: ev.candidate.candidate,
          sdpMid: ev.candidate.sdpMid,
          sdpMLineIndex: ev.candidate.sdpMLineIndex,
        }));
      }
    };

    sock.addEventListener("open", function () {
      showOverlay("v2: signaling connected, negotiating…");
    });
    sock.addEventListener("message", async function (ev) {
      let m;
      try { m = JSON.parse(ev.data); } catch (_e) { return; }
      if (m.type === "offer") {
        await pc.setRemoteDescription({ type: "offer", sdp: m.sdp });
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        ws.send(JSON.stringify({ type: "answer", sdp: ans.sdp }));
      } else if (m.type === "candidate") {
        try {
          await pc.addIceCandidate({ candidate: m.candidate, sdpMid: m.sdpMid, sdpMLineIndex: m.sdpMLineIndex });
        } catch (_e) { /* non-fatal */ }
      }
    });
    sock.addEventListener("error", function () {
      vscode.postMessage({ type: "v2Error", detail: "signaling WebSocket error on " + signalUrl });
    });
    sock.addEventListener("close", function (ev) {
      if (v2Mode && !ev.wasClean) {
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

    if (m.type === "inputState") {
      inputEnabled = !!m.enabled;
      setBadge();
      return;
    }

    if (m.type === "status") {
      let msg = "Connecting to host…";
      if (m.state === "no-host") {
        msg = "REMOTE_HOST is not set in ~/.remote-pair/client.env";
      } else if (m.state === "error") {
        msg = "Error: " + (m.detail || "unknown") +
          "\nIs RemotePairHost.app running on the host (screen serve-webrtc)?";
      }
      if (!haveFrame) showOverlay(msg);
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
