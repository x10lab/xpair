// RemotePair Remote Desktop webview script.
// v0: receives PNG frames from the extension and renders them via <img>.
// v1: opens a WebSocket to the local-forwarded sidecar port, receives binary
//     JPEG frames, and draws them onto a <canvas> via createImageBitmap.
// Both paths: captures mouse clicks (relative 0..1) and key combos and posts
// them back to the extension. Input forwarding works over both modes.
(function () {
  "use strict";
  const vscode = acquireVsCodeApi();

  const img = document.getElementById("screen");
  const canvas = document.getElementById("screen-canvas");
  const ctx = canvas.getContext("2d");
  const video = document.getElementById("screen-video");
  const overlay = document.getElementById("overlay");
  const overlayMsg = document.getElementById("overlay-msg");
  const badge = document.getElementById("badge");
  const modeBadge = document.getElementById("mode-badge");
  const stage = document.getElementById("stage");

  let inputEnabled = false;
  let haveFrame = false;
  let lastSent = 0;
  const THROTTLE_MS = 120;

  // v1 state
  let ws = null;
  let v1Mode = false;
  let v1FirstFrameReported = false;
  let lastFrameObjectUrl = null; // track for revocation

  // v2 (WebRTC) state
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

  function setModeBadge(mode) {
    modeBadge.textContent = mode;
    modeBadge.className = "mode-" + mode;
  }

  // -------------------------------------------------------------------------
  // Relative coordinate from a pointer event over the active surface
  // (canvas in v1 mode, img in v0 mode)
  // -------------------------------------------------------------------------

  function relCoords(ev) {
    const el = v2Mode ? video : v1Mode ? canvas : img;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const rx = (ev.clientX - rect.left) / rect.width;
    const ry = (ev.clientY - rect.top) / rect.height;
    if (rx < 0 || rx > 1 || ry < 0 || ry > 1) return null;
    return { rx, ry };
  }

  function throttled() {
    const now = Date.now();
    if (now - lastSent < THROTTLE_MS) return false;
    lastSent = now;
    return true;
  }

  // -------------------------------------------------------------------------
  // Input event listeners (shared: work for both v0 and v1)
  // -------------------------------------------------------------------------

  stage.addEventListener("click", function (ev) {
    if (!inputEnabled || !haveFrame) return;
    const c = relCoords(ev);
    if (!c) return;
    if (!throttled()) return;
    vscode.postMessage({ type: "click", rx: c.rx, ry: c.ry });
  });

  // capture keys while the stage has focus
  stage.tabIndex = 0;
  function comboFromKey(ev) {
    const parts = [];
    if (ev.metaKey) parts.push("cmd");
    if (ev.ctrlKey) parts.push("ctrl");
    if (ev.altKey) parts.push("alt");
    if (ev.shiftKey) parts.push("shift");
    let k = ev.key;
    if (!k) return null;
    if (k === " ") k = "space";
    else if (k === "Escape") k = "esc";
    else if (k === "ArrowUp") k = "up";
    else if (k === "ArrowDown") k = "down";
    else if (k === "ArrowLeft") k = "left";
    else if (k === "ArrowRight") k = "right";
    else if (k === "Enter") k = "enter";
    else if (k === "Backspace") k = "backspace";
    else if (k === "Tab") k = "tab";
    else if (k.length === 1) k = k.toLowerCase();
    else return null; // ignore modifier-only or unmapped keys
    // drop pure modifier presses
    if (["meta", "control", "alt", "shift"].indexOf(k.toLowerCase()) >= 0) return null;
    parts.push(k);
    return parts.join("+");
  }

  document.addEventListener("keydown", function (ev) {
    if (!inputEnabled || !haveFrame) return;
    const combo = comboFromKey(ev);
    if (!combo) return;
    if (!throttled()) return;
    ev.preventDefault();
    vscode.postMessage({ type: "key", combo: combo });
  });

  // -------------------------------------------------------------------------
  // v1 WebSocket stream
  // -------------------------------------------------------------------------

  function closeWs() {
    if (ws) {
      try { ws.close(); } catch (_e) {}
      ws = null;
    }
  }

  function connectV1(wsUrl) {
    closeWs();
    closePc2();
    v1Mode = true;
    v2Mode = false;
    v1FirstFrameReported = false;

    // Show canvas, hide img + video
    img.style.display = "none";
    video.style.display = "none";
    canvas.style.display = "block";
    setModeBadge("v1");

    let sock;
    try {
      sock = new WebSocket(wsUrl);
    } catch (e) {
      vscode.postMessage({ type: "v1Error", detail: "WebSocket constructor threw: " + String(e) });
      return;
    }
    ws = sock;
    sock.binaryType = "arraybuffer";

    sock.addEventListener("open", function () {
      showOverlay("v1: connected, waiting for first frame…");
    });

    sock.addEventListener("message", function (ev) {
      if (!(ev.data instanceof ArrayBuffer)) return;

      // Verify JPEG magic bytes FF D8
      const bytes = new Uint8Array(ev.data);
      if (bytes.length < 2 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return;

      const blob = new Blob([ev.data], { type: "image/jpeg" });

      createImageBitmap(blob).then(function (bmp) {
        // Resize canvas to match frame if needed
        if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
          canvas.width = bmp.width;
          canvas.height = bmp.height;
          // Report dimensions to extension for input scaling
          vscode.postMessage({ type: "v1Dimensions", w: bmp.width, h: bmp.height });
        }
        ctx.drawImage(bmp, 0, 0);
        bmp.close();

        if (!haveFrame) {
          haveFrame = true;
          hideOverlay();
        }

        if (!v1FirstFrameReported) {
          v1FirstFrameReported = true;
          vscode.postMessage({ type: "v1FirstFrame" });
        }
      }).catch(function (e) {
        // Non-fatal: skip this frame
      });
    });

    sock.addEventListener("error", function () {
      vscode.postMessage({ type: "v1Error", detail: "WebSocket error on " + wsUrl });
    });

    sock.addEventListener("close", function (ev) {
      if (v1Mode && !ev.wasClean) {
        vscode.postMessage({ type: "v1Error", detail: "WebSocket closed unexpectedly (code=" + ev.code + ")" });
      }
    });
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
    v1Mode = false;
    v2FirstFrameReported = false;

    img.style.display = "none";
    canvas.style.display = "none";
    video.style.display = "block";
    setModeBadge("v2");
    showOverlay("v2: connecting (WebRTC)…");

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
  // v0: img-based frame rendering
  // -------------------------------------------------------------------------

  function renderV0Frame(dataUri) {
    // Ensure we're in v0 visual mode
    if (v1Mode || v2Mode) {
      v1Mode = false;
      v2Mode = false;
      closeWs();
      closePc2();
      canvas.style.display = "none";
      video.style.display = "none";
      img.style.display = "block";
      setModeBadge("v0");
    }
    img.src = dataUri;
    haveFrame = true;
    hideOverlay();
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

    if (m.type === "v1Connect") {
      // Extension tells webview to open WS stream
      connectV1(m.wsUrl);
      return;
    }

    if (m.type === "frame") {
      // v0 PNG frame
      renderV0Frame(m.dataUri);
      return;
    }

    if (m.type === "inputState") {
      inputEnabled = !!m.enabled;
      setBadge();
      return;
    }

    if (m.type === "status") {
      haveFrame = m.state === "frame";
      let msg = "Connecting to host…";
      if (m.state === "no-host") {
        msg = "REMOTE_HOST is not set in ~/.remote-pair/client.env";
      } else if (m.state === "unreachable") {
        msg = "Host unreachable. Check SSH to the host." + (m.detail ? "\n" + m.detail : "");
      } else if (m.state === "no-image") {
        msg = "No screen yet. Is RemotePairHost.app running on the host?\n(v1: is remote-pair-screen serve running?)";
      } else if (m.state === "error") {
        msg = "Error: " + (m.detail || "unknown");
      }
      if (!haveFrame) showOverlay(msg);
    }
  });

  // -------------------------------------------------------------------------
  // Init
  // -------------------------------------------------------------------------

  // Start in v0 visual mode; v1 canvas is hidden until connectV1 is called.
  canvas.style.display = "none";
  img.style.display = "block";
  setModeBadge("v0");
  setBadge();
  showOverlay("Connecting to host…");
  vscode.postMessage({ type: "ready" });
})();
