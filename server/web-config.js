// What the browser may know before sign-in. The publishable key only.
// The service key is never copied into this object.
import { DESKTOP_ONLY } from "../web/desktop-only.js";

export function clientSupabase(source) {
  const s = source || {};
  return {
    url: String(s.url || "").replace(/\/$/, ""),
    anonKey: String(s.anonKey || ""),
  };
}

export function publicWebConfig({ hosted = false, version = "", supabase = null, hub = null, sso = [] } = {}) {
  const cloud = hosted ? clientSupabase(supabase) : null;
  return {
    mode: hosted ? "hosted" : "local",
    surface: hosted ? "web" : "desktop",
    version,
    name: "Meldmind",
    tagline: "an Everborn product",
    subtitle: "Take command of all your AIs.",
    supabase: cloud,
    hub: hosted ? hub || null : null,
    sso: Array.isArray(sso) ? sso : [],
    desktopOnly: hosted ? DESKTOP_ONLY.slice() : [],
  };
}
