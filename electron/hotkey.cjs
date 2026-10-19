// Global hotkey for the quick launcher (Phase 24). Default Alt+Space, configurable in Settings.
// Never steals a shortcut: Electron's globalShortcut.register() returns false when Windows, macOS or
// another app already holds the combination, and then the launcher stays off with a plain note
// (nothing is forced or unregistered for anyone else). A short list of combinations the OS always
// keeps (Alt+Tab, Ctrl+Alt+Delete, Cmd+Space for Spotlight...) is refused before even trying.
// Only the shortcut this app registered is ever unregistered: on change, on turning it off and on quit.
// globalShortcut is passed in (no require("electron") here) so the server can import the validator and
// the tests can use a stand-in.
"use strict";

const DEFAULT_ACCELERATOR = "Alt+Space";
const MODS = { alt: "Alt", option: "Alt", ctrl: "Ctrl", control: "Ctrl", shift: "Shift", super: "Super", meta: "Super", win: "Super", command: "Command", cmd: "Command", commandorcontrol: "CommandOrControl", cmdorctrl: "CommandOrControl", altgr: "AltGr" };
const NAMED = { space: "Space", tab: "Tab", enter: "Enter", return: "Enter", backspace: "Backspace", delete: "Delete", del: "Delete", insert: "Insert", home: "Home", end: "End", pageup: "PageUp", pagedown: "PageDown", up: "Up", down: "Down", left: "Left", right: "Right", esc: "Escape", escape: "Escape", plus: "Plus" };
const ORDER = ["CommandOrControl", "Command", "Ctrl", "Super", "Alt", "AltGr", "Shift"];
// combinations the OS keeps for itself; RegisterHotKey would not always say so
const RESERVED = {
  win32: ["Alt+Tab", "Alt+F4", "Ctrl+Alt+Delete", "Ctrl+Shift+Escape", "Super+L", "Super+D", "Super+Tab", "Alt+Escape"],
  darwin: ["Command+Space", "Command+Tab", "Command+Q", "Command+Alt+Escape", "Ctrl+Space"],
  linux: ["Alt+Tab", "Alt+F4", "Ctrl+Alt+Delete", "Super+L"],
};

// "alt + space" -> "Alt+Space". At least one modifier and exactly one key, so plain typing is never captured.
function normalize(accel) {
  const parts = String(accel || "").split("+").map((s) => s.trim()).filter(Boolean);
  if (!parts.length || parts.length > 4) throw new Error("Type a shortcut such as Alt+Space or Ctrl+Shift+K.");
  const key = parts.pop();
  const mods = [...new Set(parts.map((m) => { const v = MODS[m.toLowerCase()]; if (!v) throw new Error(`"${m}" is not a modifier key (use Alt, Ctrl, Shift, Super or Command).`); return v; }))];
  if (!mods.length) throw new Error("Use at least one modifier (Alt, Ctrl, Shift, Super or Command) so normal typing is never captured.");
  if (MODS[key.toLowerCase()]) throw new Error("End the shortcut with a key, not a modifier.");
  let k;
  if (/^[a-z0-9]$/i.test(key)) k = key.toUpperCase();
  else if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(key)) k = key.toUpperCase();
  else if (NAMED[key.toLowerCase()]) k = NAMED[key.toLowerCase()];
  else if (/^[`\-=[\];',./\\]$/.test(key)) k = key;
  else throw new Error(`"${key}" is not a key the launcher can use.`);
  mods.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  return [...mods, k].join("+");
}
function expand(accel, platform) {
  // CommandOrControl means Command on macOS, Ctrl elsewhere: compare reserved combos on the real key
  return accel.replace(/^CommandOrControl\b/, platform === "darwin" ? "Command" : "Ctrl");
}
function reservedBy(accel, platform = process.platform) {
  const a = normalize(expand(accel, platform));
  return (RESERVED[platform] || []).some((r) => normalize(r) === a);
}

function createHotkey({ globalShortcut, onTrigger, log = () => {}, platform = process.platform }) {
  let owned = null; // the accelerator this app registered, if any
  let state = { enabled: false, accelerator: DEFAULT_ACCELERATOR, registered: false, reason: "not set up yet" };
  const release = () => { if (owned) { try { globalShortcut.unregister(owned); } catch {} log(`hotkey ${owned} released`); owned = null; } };

  function apply({ enabled = true, accelerator = DEFAULT_ACCELERATOR } = {}) {
    let accel;
    try { accel = normalize(accelerator); } catch (e) { return { ...state, error: e.message }; }
    if (!enabled) { release(); state = { enabled: false, accelerator: accel, registered: false, reason: "The quick launcher is off." }; return state; }
    if (owned === accel) { state = { enabled: true, accelerator: accel, registered: true, reason: null }; return state; }
    if (reservedBy(accel, platform)) { release(); state = { enabled: true, accelerator: accel, registered: false, reason: `${accel} belongs to the operating system, so it was left alone. Pick another shortcut.` }; return state; }
    release();
    let ok = false, why = null;
    try { ok = !!globalShortcut.register(accel, () => { try { onTrigger(); } catch (e) { log("quick launcher failed:", e && e.message); } }); } catch (e) { why = e && e.message; }
    if (ok) { owned = accel; log(`hotkey ${accel} registered`); state = { enabled: true, accelerator: accel, registered: true, reason: null }; }
    else { log(`hotkey ${accel} not registered: ${why || "taken"}`); state = { enabled: true, accelerator: accel, registered: false, reason: why ? `${accel} could not be used: ${why}` : `${accel} is already used by Windows or another app, so it was left alone. Pick another shortcut.` }; }
    return state;
  }

  return {
    apply,
    dispose: release, // on quit: give the shortcut back
    get state() { return state; },
    get owned() { return owned; },
  };
}

module.exports = { createHotkey, normalize, reservedBy, DEFAULT_ACCELERATOR };
