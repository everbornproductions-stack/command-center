// Print a page of HTML to a Letter PDF with Electron's own printer (0.4.21). The server calls this through
// globalThis.__ccPdfRenderer, so a document task gets a real PDF with no other program installed.
// The page is loaded from a data URL in a hidden window with no scripts and no preload, then closed.
function createPdfRenderer({ BrowserWindow }) {
  return async function render(html) {
    const win = new BrowserWindow({
      show: false, width: 816, height: 1056,
      webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, offscreen: false },
    });
    try {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(String(html || ""))}`);
      const buf = await win.webContents.printToPDF({ pageSize: "Letter", printBackground: true, preferCSSPageSize: true, margins: { marginType: "default" } });
      return Buffer.from(buf);
    } finally {
      try { if (!win.isDestroyed()) win.destroy(); } catch { /* already gone */ }
    }
  };
}
module.exports = { createPdfRenderer };
