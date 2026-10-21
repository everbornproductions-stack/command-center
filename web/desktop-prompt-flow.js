// What each button on the "Let Meldmind use your desktop" card does.
// Every button, the X, Escape, and a click outside the card close it first.
// Install progress shows as a toast, never inside a card that stays in front.
// Once closed, the card stays closed for this app session, while an install runs,
// and on Settings or Setup, so Open settings cannot bring it back.

export const DESKTOP_SESSION_KEY = "cc.desktopPromptClosed";
export const DESKTOP_SETTINGS_FOCUS = "[data-feature='antigravity']";

const CLICKS = {
  allow: { server: "done", run: "allow" },
  install: { server: "done", run: "install" },
  settings: { server: "later", view: "settings", focus: DESKTOP_SETTINGS_FOCUS },
  later: { server: "later" },
  close: { server: "later" },
  never: { server: "never" },
};

export function desktopClick(button) {
  const c = CLICKS[button] || CLICKS.close;
  return { close: true, dismiss: true, server: c.server, run: c.run || null, view: c.view || null, focus: c.focus || "" };
}

export function desktopPromptBlocked({ dismissed = false, busy = false, view = "" } = {}) {
  if (dismissed || busy) return true;
  return view === "settings" || view === "setup";
}

export function sessionClosed(store) {
  try { return store?.getItem(DESKTOP_SESSION_KEY) === "1"; } catch { return false; }
}

export function markSessionClosed(store) {
  try { store?.setItem(DESKTOP_SESSION_KEY, "1"); } catch { /* storage can be off; the in-memory flag still holds */ }
}
