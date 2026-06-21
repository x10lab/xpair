// Mocks the vscode webview API for the harness: acquireVsCodeApi().postMessage forwards the
// { id, method, args } RPC to the main process (real bridge) and delivers replies back as window
// 'message' events — exactly the channel the webview's vscode-bridge shim listens on.
const { ipcRenderer } = require("electron");

window.acquireVsCodeApi = function () {
  return {
    postMessage: function (m) {
      ipcRenderer.invoke("rpc", m).then(function (reply) {
        window.postMessage(reply, "*");
      });
    },
    getState: function () {},
    setState: function () {},
  };
};

// Self-test: after the bundle sets up window.remotepair (via the vscode-bridge shim), exercise the
// full webview -> RPC -> real bridge -> reply path so the round-trip is provable without UI clicks.
window.addEventListener("load", function () {
  setTimeout(async function () {
    try {
      console.log("SELFTEST hostInfo " + JSON.stringify(await window.remotepair.hostInfo()));
      console.log("SELFTEST getConfig " + JSON.stringify(await window.remotepair.getConfig()));
      const cfg = await window.remotepair.getConfig();
      if (cfg && cfg.remoteHost) {
        console.log("SELFTEST sshReachable " + JSON.stringify(await window.remotepair.sshReachable(cfg.remoteHost)));
      }
    } catch (e) {
      console.log("SELFTEST error " + (e && e.message ? e.message : e));
    }
  }, 1800);
});
