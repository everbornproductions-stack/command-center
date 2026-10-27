// Turn an SVG into a PNG with Electron's own hidden window (0.4.21). The server calls this through
// globalThis.__ccSvgRenderer, so a flat graphic (quote card, banner) gets a real PNG with no image AI and no other program.
// Same pattern as pdf-render.cjs: a data URL in a hidden window with no scripts and no preload, captured, then closed.
function createSvgRenderer({ BrowserWindow }) {
  return async function render(svg, { width = 1080, height = 1080 } = {}) {
    const w = Math.max(16, Math.min(4000, Math.round(Number(width) || 1080)));
    const h = Math.max(16, Math.min(4000, Math.round(Number(height) || 1080)));
    const page = `<!doctype html><html><body style="margin:0;background:transparent"><img width="${w}" height="${h}" style="display:block" src="data:image/svg+xml;base64,${Buffer.from(String(svg || ""), "utf8").toString("base64")}"></body></html>`;
    const win = new BrowserWindow({
      show: false, width: w, height: h, useContentSize: true, frame: false, enableLargerThanScreen: true,
      webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, offscreen: false },
    });
    try {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
      await new Promise((r) => setTimeout(r, 250)); // let the image paint
      let img = await win.webContents.capturePage({ x: 0, y: 0, width: w, height: h });
      const sz = img.getSize();
      if (sz.width !== w || sz.height !== h) img = img.resize({ width: w, height: h, quality: "best" });
      return Buffer.from(img.toPNG());
    } finally {
      try { if (!win.isDestroyed()) win.destroy(); } catch { /* already gone */ }
    }
  };
}
module.exports = { createSvgRenderer };
