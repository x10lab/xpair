// US-009 direct-verification harness — loads the SAME onboarding-webview/dist into an Electron
// window with a mocked vscode webview API, routing the SAME { id, method, args } RPC to the REAL
// onboarding-bridge.js (identical to the extension's onDidReceiveMessage dispatch). This proves the
// webview renders + a real bridge round-trip works, without building the full VSCodium IDE.
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const bridge = require("../../onboarding-bridge.js"); // harness/ -> .. -> onboarding-webview -> .. -> ext/

function createWindow() {
  const win = new BrowserWindow({
    width: 760,
    height: 600,
    resizable: false,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: false,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  win.webContents.on("console-message", (_e, _lvl, msg) => console.log("  [renderer]", msg));
}

ipcMain.handle("rpc", async (_e, m) => {
  if (!m || !m.method) return { id: m && m.id, error: "bad message" };
  if (m.method === "complete") {
    console.log("  RPC complete -> quit");
    app.quit();
    return { id: m.id };
  }
  const fn = Object.prototype.hasOwnProperty.call(bridge, m.method) ? bridge[m.method] : undefined;
  if (typeof fn !== "function") {
    console.log(`  RPC ${m.method} -> UNKNOWN`);
    return { id: m.id, error: "unknown method: " + m.method };
  }
  try {
    const result = await fn.apply(bridge, Array.isArray(m.args) ? m.args : []);
    console.log(`  RPC ${m.method}(${JSON.stringify(m.args || [])}) -> ${JSON.stringify(result)}`);
    return { id: m.id, result };
  } catch (e) {
    console.log(`  RPC ${m.method} -> ERROR ${e && e.message}`);
    return { id: m.id, error: String(e && e.message ? e.message : e) };
  }
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
