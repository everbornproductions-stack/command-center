// GoHighLevel social planner: schedule a post to the accounts connected in the location.
// Needs: a Private Integration token with social-media-posting scopes and the location id (pasted), or a
// sub-account token from "Connect HighLevel" in Settings > Publishing (server/publish/oauth.js).
import { API } from "./oauth.js";
export const id = "ghl";
export const name = "HighLevel social planner";
const BASE = () => API.ghl(); // CC_GHL_API_URL points tests at a local mock
const H = (key) => ({ authorization: `Bearer ${key}`, Version: "2021-07-28", "content-type": "application/json", accept: "application/json" });
const loc = (secret) => encodeURIComponent(secret.locationId);

export function ready(secret) { return !!(secret?.key && secret?.locationId); }

export async function accounts(secret) {
  const r = await fetch(`${BASE()}/social-media-posting/${loc(secret)}/accounts`, { headers: H(secret.key), signal: AbortSignal.timeout(20000), redirect: "error" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`HighLevel accounts: ${j.message || r.status}`);
  return (j.results?.accounts || j.accounts || []).map((a) => ({ id: a.id || a._id, name: a.name, platform: a.platform }));
}

export function preview({ text, mediaUrl, when, accountIds }) {
  const problems = [];
  if (!accountIds?.length) problems.push("Pick at least one connected social account");
  if (!text && !mediaUrl) problems.push("Nothing to post");
  return { channel: id, summary: `${when ? "Schedule" : "Post now"} to ${accountIds?.length || 0} account${accountIds?.length === 1 ? "" : "s"} via HighLevel${when ? ` at ${new Date(when).toLocaleString()}` : ""}`, problems };
}

export async function post(secret, { text, mediaUrl, when, accountIds }) {
  const body = { accountIds, summary: text || "", type: "post", status: when ? "scheduled" : "published", ...(when ? { scheduleDate: new Date(when).toISOString() } : {}), ...(mediaUrl ? { media: [{ url: mediaUrl, type: /\.(mp4|mov|webm)(\?|$)/i.test(mediaUrl) ? "video/mp4" : "image/jpeg" }] } : {}) };
  const r = await fetch(`${BASE()}/social-media-posting/${loc(secret)}/posts`, { method: "POST", headers: H(secret.key), body: JSON.stringify(body), signal: AbortSignal.timeout(30000), redirect: "error" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`HighLevel post: ${j.message || JSON.stringify(j).slice(0, 200)}`);
  return { id: j.results?.post?._id || j.post?._id || j.id || null, url: `https://app.gohighlevel.com/v2/location/${encodeURIComponent(secret.locationId)}/marketing/social-planner` };
}
