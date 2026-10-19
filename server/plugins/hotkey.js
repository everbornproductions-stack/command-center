// Global hotkey quick launcher (Phase 24), desktop app only. The shortcut itself lives in the Electron main
// process (electron/hotkey.cjs, reached through globalThis.__ccHotkey); this plugin keeps the choice in the
// "hotkey" document and hands it over at start and on every change.
//   GET  /api/hotkey   { desktop, enabled, accelerator, registered, reason, default }
//   POST /api/hotkey   { enabled?, accelerator? }  saved, then applied (never forced on a taken shortcut)
import hk from "../../electron/hotkey.cjs";

export const id = "hotkey";
const DOC = "hotkey";
const bridge = () => globalThis.__ccHotkey || null;
const saved = (h) => ({ enabled: true, accelerator: hk.DEFAULT_ACCELERATOR, ...(h.doc(DOC, () => undefined) || {}) });

function view(h) {
  const s = saved(h), b = bridge();
  const live = b ? b.state : null;
  return {
    desktop: !!b, default: hk.DEFAULT_ACCELERATOR, enabled: s.enabled, accelerator: s.accelerator,
    registered: !!live?.registered && live.accelerator === s.accelerator,
    reason: b ? (live?.reason || null) : "The quick launcher works in the Command AI desktop app (a browser cannot listen for a shortcut outside its own tab).",
  };
}

export function init(h) {
  if (h.HOSTED || !bridge()) return;
  try { bridge().apply(saved(h)); } catch (e) { console.error("[hotkey]", e.message); }
}

export async function routes(req, res, url, body, h) {
  if (url.pathname !== "/api/hotkey") return false;
  if (req.method === "GET") return h.json(res, 200, view(h));
  if (req.method !== "POST") return false;
  if (h.HOSTED) return h.json(res, 400, { error: "The quick launcher is part of the desktop app." });
  const cur = saved(h);
  const next = { enabled: typeof body.enabled === "boolean" ? body.enabled : cur.enabled, accelerator: body.accelerator !== undefined ? String(body.accelerator) : cur.accelerator };
  try { next.accelerator = hk.normalize(next.accelerator); } catch (e) { return h.json(res, 400, { error: e.message }); }
  if (next.enabled && hk.reservedBy(next.accelerator)) return h.json(res, 400, { error: `${next.accelerator} belongs to the operating system. Pick another shortcut.` });
  h.putDoc(DOC, next);
  const st = bridge()?.apply(next);
  return h.json(res, 200, { ...view(h), ...(st?.reason && !st.registered ? { reason: st.reason } : {}) });
}
