// Best-effort Supabase calls for community chat, AI News, and the email list.
// A missing cloud config or a refused call leaves the local copy in place.
// The licence key is sent only to our own RPC and is never logged.

import { cloud } from "./license.js";

export async function anonRpc(fn, body, { keepArray = false } = {}) {
  const cfg = cloud();
  if (!cfg?.url || !cfg?.anonKey) return { offline: true, body: null };
  const headers = { apikey: cfg.anonKey, accept: "application/json", "content-type": "application/json" };
  if (String(cfg.anonKey).startsWith("eyJ")) headers.authorization = `Bearer ${cfg.anonKey}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(`${cfg.url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body || {}),
      signal: ctl.signal,
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    if (!res.ok) return { offline: true, body: parsed };
    if (keepArray && Array.isArray(parsed)) return { offline: false, body: parsed };
    const row = Array.isArray(parsed) ? parsed[0] : parsed;
    return { offline: false, body: row && typeof row === "object" ? row : { value: row } };
  } catch {
    return { offline: true, body: null };
  } finally {
    clearTimeout(timer);
  }
}

export function pullNews() {
  return anonRpc("ai_news_latest", {});
}

export function pushNews(issue, licenceKey) {
  if (!licenceKey) return Promise.resolve({ offline: true, body: null });
  return anonRpc("publish_ai_news", { p_key: licenceKey, p_issue: issue });
}

export function pushDraft(issue, licenceKey) {
  if (!licenceKey) return Promise.resolve({ offline: true, body: null });
  return anonRpc("save_ai_news_draft", { p_key: licenceKey, p_issue: issue });
}

export function pushUsername(payload) {
  return anonRpc("community_set_username", payload);
}

export function pushPost(payload) {
  return anonRpc("community_post", payload);
}

// A free account has no licence key: the install's own device token stands in. See supabase/community_free_posting.sql.
export function pushFreePost(payload) {
  return anonRpc("community_post_free", payload);
}

export function pullChannel(channel) {
  return anonRpc("community_list", { p_channel: channel }, { keepArray: true });
}

export function pushNewsletter(payload) {
  return anonRpc("newsletter_set", payload);
}

export function pushUnsubscribe(token) {
  return anonRpc("newsletter_unsubscribe", { p_token: token });
}

export function pushReaction(payload) {
  return anonRpc("ai_news_react", payload);
}
