// RemotePair Remote Desktop webview script.
// Receives PNG frames from the extension and renders them; captures mouse
// clicks (as relative 0..1 coords) and key combos and posts them back.
(function () {
  "use strict";
  const vscode = acquireVsCodeApi();

  const img = document.getElementById("screen");
  const overlay = document.getElementById("overlay");
  const overlayMsg = document.getElementById("overlay-msg");
  const badge = document.getElementById("badge");
  const stage = document.getElementById("stage");

  let inputEnabled = false;
  let haveFrame = false;
  let lastSent = 0;
  const THROTTLE_MS = 120;

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

  // --- relative coordinate from a pointer event over the <img> -----------
  function relCoords(ev) {
    const rect = img.getBoundingClientRect();
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

  img.addEventListener("click", function (ev) {
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

  // --- messages from the extension --------------------------------------
  window.addEventListener("message", function (e) {
    const m = e.data;
    if (!m || typeof m !== "object") return;
    if (m.type === "frame") {
      img.src = m.dataUri;
      haveFrame = true;
      hideOverlay();
    } else if (m.type === "inputState") {
      inputEnabled = !!m.enabled;
      setBadge();
    } else if (m.type === "status") {
      haveFrame = m.state === "frame";
      let msg = "Connecting to host…";
      if (m.state === "no-host") {
        msg = "REMOTE_HOST is not set in ~/.remote-pair/client.env";
      } else if (m.state === "unreachable") {
        msg = "Host unreachable. Check SSH to the host." + (m.detail ? "\n" + m.detail : "");
      } else if (m.state === "no-image") {
        msg = "No screen yet. Is RemotePairHost.app running on the host?";
      } else if (m.state === "error") {
        msg = "Error: " + (m.detail || "unknown");
      }
      if (!haveFrame) showOverlay(msg);
    }
  });

  setBadge();
  showOverlay("Connecting to host…");
  vscode.postMessage({ type: "ready" });
})();
