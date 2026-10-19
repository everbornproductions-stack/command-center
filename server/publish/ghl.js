// GoHighLevel social planner: schedule a post to the accounts connected in the location.
// Needs: a Private Integration token with social-media-posting scopes, and the location id.
export const id = "ghl";
export const name = "GoHighLevel social planner";
const BASE = "https://services.leadconnectorhq.com";
const H = (key) => ({ authorization: `Bearer ${key}`, Version: "2021-07-28", "content-type": "application/json", accept: "application/json" });

export function ready(secret) { return !!(secret?.key && secret?.locationId); }

export async function accounts(secret) {
  const r = await fetch(`${BASE}/social-media-posting/${secret.locationId}/accounts`, { headers: H(secret.key) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GHL accounts: ${j.message || r.status}`);
  return (j.results?.accounts || j.accounts || []).map((a) => ({ id: a.id || a._id, name: a.name, platform: a.platform }));
}

export function preview({ text, mediaUrl, when, accountIds }) {
  const problems = [];
  if (!accountIds?.length) problems.push("Pick at least one connected social account");
  if (!text && !mediaUrl) problems.push("Nothing to post");
  return { channel: id, summary: `${when ? "Schedule" : "Post now"} to ${accountIds?.length || 0} account${accountIds?.length === 1 ? "" : "s"} via GoHighLevel${when ? ` at ${new Date(when).toLocaleString()}` : ""}`, problems };
}

export async function post(secret, { text, mediaUrl, when, accountIds }) {
  const body = { accountIds, summary: text || "", type: "post", status: when ? "scheduled" : "published", ...(when ? { scheduleDate: new Date(when).toISOString() } : {}), ...(mediaUrl ? { media: [{ url: mediaUrl, type: /\.(mp4|mov|webm)(\?|$)/i.test(mediaUrl) ? "video/mp4" : "image/jpeg" }] } : {}) };
  const r = await fetch(`${BASE}/social-media-posting/${secret.locationId}/posts`, { method: "POST", headers: H(secret.key), body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GHL post: ${j.message || JSON.stringify(j).slice(0, 200)}`);
  return { id: j.results?.post?._id || j.post?._id || j.id || null, url: `https://app.gohighlevel.com/v2/location/${secret.locationId}/marketing/social-planner` };
}
