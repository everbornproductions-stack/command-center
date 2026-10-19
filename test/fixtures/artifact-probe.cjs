// Electron probe for test/artifacts.test.js: opens the app page served by the test server (real token in
// the page), opens an artifact through the real panel code (CC.artifacts.open) and prints what the
// artifact's own script could reach from inside the sandboxed frame. Never touches the user's profile.
const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const [base, artifactId] = process.argv.slice(-2);
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "cc-art-probe-")));
app.disableHardwareAcceleration();
const out = (o) => { process.stdout.write("PROBE " + JSON.stringify(o) + "\n"); app.exit(0); };
setTimeout(() => out({ error: "timeout" }), 45000);

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
  try {
    await w.loadURL(base + "/");
    const r = await w.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const t0 = Date.now();
      const go = () => {
        if (!window.CC || !window.CC.artifacts) { if (Date.now() - t0 > 20000) return reject(new Error("panel code not loaded")); return setTimeout(go, 100); }
        window.addEventListener("message", (e) => { if (e.data && e.data.ccProbe) {
          const f = document.querySelector("#art-panel iframe");
          resolve({ probe: e.data.ccProbe, sandbox: f && f.getAttribute("sandbox"), fromFrame: f && e.source === f.contentWindow, token: (document.querySelector('meta[name="cc-token"]') || {}).content || "" });
        } });
        window.CC.artifacts.open(${JSON.stringify(artifactId)});
      };
      go();
    })`);
    out(r);
  } catch (e) { out({ error: String(e && e.message || e) }); }
});
