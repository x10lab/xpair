// Xpair Remote Desktop webview script (v2 WebRTC only).
// Opens a signaling WebSocket to the host `screen serve-webrtc`, negotiates a
// WebRTC peer connection, and renders the H.264 media (decoded natively) into a
// <video>. This view is PERMANENTLY view-only: no cursor/keyboard input is
// captured or forwarded. Display/video only (no remote control).
(function () {
  "use strict";
  const vscode = acquireVsCodeApi();

  const video = document.getElementById("screen-video");
  const overlay = document.getElementById("overlay");
  const overlayMsg = document.getElementById("overlay-msg");
  const badge = document.getElementById("badge");

  let haveFrame = false;

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
    badge.textContent = "view-only";
    badge.className = "off";
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
    // View-only: close any host-created DataChannel, including legacy
    // rp-ctl/rp-move input channels. The client never creates a channel or
    // sends pointer, wheel, text, or keyboard input.
    pc.ondatachannel = function (ev) {
      const channel = ev && ev.channel;
      if (!channel) return;
      try { channel.close(); } catch (_e) {}
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
  setBadge();
  showOverlay("Connecting to host…");
  vscode.postMessage({ type: "ready" });
})();
