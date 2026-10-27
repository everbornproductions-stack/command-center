// What the browser may know before sign-in. The publishable key only.
// The service key is never copied into this object.
import { DESKTOP_ONLY } from "../web/desktop-only.js";

// Slice A5 feature flag: on by default in 0.4.19; CC_FLAG_NAVSTATE=0 turns it off.
export const DEFAULT_FLAG_NAVSTATE = true;

export function isNavStateEnabled(settingsObj, env = process.env) {
  if (typeof settingsObj?.flag_navstate === "boolean") return settingsObj.flag_navstate;
  const raw = String(env?.CC_FLAG_NAVSTATE || "").trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return DEFAULT_FLAG_NAVSTATE;
}

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
