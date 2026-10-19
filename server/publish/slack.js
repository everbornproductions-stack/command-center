// Send to Slack: post the deliverable as a message in one channel, as the person's own Slack app.
// Needs: a bot token from "Connect Slack" (scopes chat:write and channels:read), and the app invited to
// the channel. Text only; a media job's public link is added to the message when there is one.
import { API, request } from "./oauth.js";
export const id = "slack";
export const name = "Slack";
export const MAX = 3900;

export function ready(secret) { return !!secret?.key; }

async function call(secret, method, { json } = {}) {
  const { r, j } = await request("Slack", `${API.slack()}/${method}`, { method: json ? "POST" : "GET", json, token: secret.key });
  if (r.status === 401 || j.error === "invalid_auth" || j.error === "token_revoked") throw Object.assign(new Error("Slack refused the token. Connect Slack again in Settings > Publishing."), { status: 409, code: "sign_in" });
  if (!r.ok || j.ok !== true) throw new Error(`Slack ${method}: ${j.error || `HTTP ${r.status}`}`);
  return j;
}

export async function channels(secret) {
  const j = await call(secret, `conversations.list?${new URLSearchParams({ types: "public_channel", exclude_archived: "true", limit: "200" })}`);
  return (j.channels || []).map((c) => ({ id: c.id, name: c.name, member: !!c.is_member }));
}

const message = (title, text, mediaUrl) => [`*${title}*`, text || "", mediaUrl ? mediaUrl : ""].filter(Boolean).join("\n\n").slice(0, MAX);

export function preview({ title, text, mediaUrl, channelId, channelName }) {
  const problems = [];
  if (!channelId) problems.push("Pick a Slack channel");
  else if (!/^[CG][A-Z0-9]{6,20}$/.test(channelId)) problems.push("That is not a Slack channel id");
  if (!text && !mediaUrl) problems.push("Nothing to send");
  const n = message(title, text, mediaUrl).length;
  return { channel: id, summary: `Send a ${n}-character message to ${channelName ? "#" + channelName : channelId || "(no channel)"} in Slack`, problems };
}

export async function post(secret, { title, text, mediaUrl, channelId }) {
  const j = await call(secret, "chat.postMessage", { json: { channel: channelId, text: message(title, text, mediaUrl), unfurl_links: false, unfurl_media: false } });
  let url = null;
  try { const p = await call(secret, `chat.getPermalink?${new URLSearchParams({ channel: channelId, message_ts: j.ts })}`); if (/^https:\/\//.test(p.permalink || "")) url = p.permalink; } catch {}
  return { id: j.ts || null, url };
}
