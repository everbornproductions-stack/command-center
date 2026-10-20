// Tells the window to measure the top bar again when the window is resized,
// dragged, or the display changes. The renderer also listens, because a move
// onto another monitor often does not fire a resize there. Debounced so a drag
// does not rebuild the menus on every pixel.
const WAIT_MS = 150;

function cssWidth(win) {
  const content = (win.getContentBounds && win.getContentBounds()) || (win.getBounds && win.getBounds()) || {};
  const dip = Number(content.width) || 0;
  let zoom = 1;
  try { zoom = win.webContents?.getZoomFactor?.() || 1; } catch { zoom = 1; }
  if (!(zoom > 0)) zoom = 1;
  return Math.round(dip / zoom);
}

function payload(screen, win) {
  let display = null;
  try { display = screen.getDisplayMatching(win.getBounds()); } catch { display = null; }
  const bounds = (display && display.bounds) || {};
  return {
    width: cssWidth(win),
    screenWidth: Number(bounds.width) || 0,
    screenHeight: Number(bounds.height) || 0,
    scaleFactor: Number(display && display.scaleFactor) || 1,
  };
}

function createNavDisplayWatch({ screen, win, send, waitMs = WAIT_MS } = {}) {
  if (!screen || !win || typeof send !== "function") return () => {};
  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try { if (win.isDestroyed?.()) return; } catch { return; }
      try { send(payload(screen, win)); } catch { /* the window can close mid-send */ }
    }, waitMs);
  };
  const onWin = () => schedule();
  const onScreen = () => schedule();
  win.on?.("resize", onWin);
  win.on?.("moved", onWin);
  screen.on?.("display-metrics-changed", onScreen);
  return () => {
    clearTimeout(timer);
    timer = null;
    win.removeListener?.("resize", onWin);
    win.removeListener?.("moved", onWin);
    screen.removeListener?.("display-metrics-changed", onScreen);
  };
}

module.exports = { createNavDisplayWatch, WAIT_MS };
