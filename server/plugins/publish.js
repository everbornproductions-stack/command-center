// Posting hooks (Phase 7 integrations): send a finished deliverable to Instagram, the HighLevel social
// planner, Slack, or Google Drive (API upload when connected, else a Drive-synced folder). Always preview
// first; nothing leaves without an explicit confirm. Each service is connected with the person's own
// OAuth app (server/publish/oauth.js) or a pasted token; tokens live in the vault.
//
// Contract (stable; README and docs reference it):
//   GET  /api/publish/channels      readiness per channel
//   POST /api/publish/preview       { channel, title, text, mediaUrl?, mediaType?, mediaJobId?, when?, accountIds?, channelId?, channelName?, projectId?, missionId? }
//                                   -> { channel, summary, problems, ready, dryRun, previewId, media }
//   POST /api/publish/post          { previewId, confirmed: true } -> history entry
//                                   Posts exactly what was previewed (the stored payload, not the request body).
//                                   A preview is good for one post within 30 minutes, for the same user.
//                                   A real post is refused while the preview lists problems; a dry run is always allowed.
//   GET  /api/publish/history       newest first
//   POST /api/publish/prefs         { driveFolder }
//   POST /api/publish/keys          { channel: instagram|ghl|slack, token, igUserId | locationId }
//   GET  /api/publish/ghl-accounts
//   GET  /api/publish/slack-channels
//   GET  /api/publish/connect                       the four OAuth connectors (no secrets)
//   POST /api/publish/connect/<google|meta|ghl|slack>/client   { clientId?, clientSecret? }
//   POST /api/publish/connect/<k>/start             { origin } -> { url } (the page opens it)
//   POST /api/publish/connect/<k>/finish            { code, state }
//   DELETE /api/publish/connect/<k>                 removes the token from the vault
// Every post (posted, dry run or failed) is written to the history doc, the live feed and the ledger (cost 0).
import * as instagram from "../publish/meta.js";
import * as ghl from "../publish/ghl.js";
import * as drive from "../publish/drive.js";
import * as slack from "../publish/slack.js";
import * as OA from "../publish/oauth.js";
import { holdOutbound } from "../phone-approvals.js";
import { checkOutgoing, maskSensitive } from "../compliance-guard.js";
import { recordSend, sendLog } from "../send-log.js";
import { assetForPublish, recordPublishResult } from "../project-media.js";

export const id = "publish";
const HIST = "publish.history", PREFS = "publish.prefs", JOBS = "media.jobs";
const CH = { instagram, ghl, drive, slack };
const CONNECTOR = { instagram: "meta", ghl: "ghl", drive: "google", slack: "slack" }; // channel -> oauth connector
export const PREVIEW_TTL_MS = 30 * 60 * 1000;
const previews = new Map(); // previewId -> { userId, channel, payload, problems, ready, createdAt }

function prefs(h) { return h.doc(PREFS, () => ({ driveFolder: "" })); }
const secretFor = (h, ch) => h.getSecret(OA.CONNECTORS[CONNECTOR[ch]].vault);
function readyFor(h, ch) { return ch === "drive" ? drive.ready(prefs(h), h.HOSTED, secretFor(h, ch)) : CH[ch].ready(secretFor(h, ch)); }
const userOf = (h) => h.ctx()?.userId ?? "local";
const isVideo = (s) => /\.(mp4|mov|webm)(\?|$)/i.test(s || "");
function sweep() { const now = Date.now(); for (const [k, v] of previews) if (now - v.createdAt > PREVIEW_TTL_MS) previews.delete(k); }

// A finished media job (server/plugins/media.js) attached to a post. Its outputs are local file paths
// (local mode) or provider URLs (hosted mode). Only these paths can ever be copied by the Drive channel.
export function mediaFromJob(jobs, jobId) {
  if (!jobId) return null;
  const j = (jobs || []).find((x) => x.id === jobId);
  if (!j) return { error: "Media job not found" };
  if (j.status === "dry-run") return { jobId, kind: j.kind, dryRun: true, urls: [], files: [], error: "That media job was a dry run and has no output to attach" };
  if (j.status !== "done" || !j.outputs?.length) return { jobId, kind: j.kind, urls: [], files: [], error: "That media job has not finished" };
  const urls = j.outputs.filter((o) => /^https?:\/\//i.test(o));
  const files = j.outputs.filter((o) => !/^https?:\/\//i.test(o));
  return { jobId, kind: j.kind, urls, files };
}

// A MindMedia item attached to a post (0.4.20): resolved to its local file, or to its words for a text item.
export function mediaFromAsset(projectId, assetId) {
  if (!assetId) return null;
  const a = assetForPublish(projectId, assetId);
  if (!a) return { error: "That MindMedia item was not found" };
  const kind = a.kind === "video" ? "video" : a.kind === "audio" ? "audio" : a.kind === "image" ? "image" : a.kind === "text" ? "text" : "file";
  const urls = a.remote && /^https?:\/\//i.test(a.remote) ? [a.remote] : (a.publicUrl ? [a.publicUrl] : []);
  return { assetId: a.assetId, projectId: a.projectId, name: a.name, kind, urls, files: a.file ? [a.file] : [], text: a.text || "" };
}

// What each channel can take, so the page only offers places the item fits.
export const ACCEPTS = { instagram: ["image", "video", "text"], ghl: ["text", "image", "video"], slack: ["text", "image"], drive: ["text", "image", "video", "audio", "file", "site"] };

// Normalise what the browser sent into the payload that will be posted, with the media job resolved.
export function buildPayload(body, media) {
  const rawTitle = String(body.title || "Deliverable"), rawText = String(body.text || media?.text || "");
  const pl = {
    channel: body.channel,
    // private numbers are hidden before any preview, history line or post (one shared helper)
    title: maskSensitive(rawTitle).slice(0, 120),
    text: maskSensitive(rawText).slice(0, body.channel === "instagram" ? 2200 : body.channel === "slack" ? slack.MAX : 5000),
    masked: maskSensitive(`${rawTitle}\n${rawText}`) !== `${rawTitle}\n${rawText}`,
    mediaUrl: typeof body.mediaUrl === "string" && body.mediaUrl.trim() ? body.mediaUrl.trim() : null,
    mediaType: body.mediaType === "video" ? "video" : "image",
    when: body.when ? Number(new Date(body.when)) || null : null,
    accountIds: Array.isArray(body.accountIds) ? body.accountIds.map(String).slice(0, 20) : [],
    channelId: typeof body.channelId === "string" ? body.channelId.trim().slice(0, 24) : null,
    channelName: typeof body.channelName === "string" ? body.channelName.replace(/[^\w.-]/g, "").slice(0, 80) : null,
    projectId: body.projectId || null,
    missionId: body.missionId || null,
    consent: body.consent === true,
    mediaJobId: media?.jobId || null,
    mediaAssetId: media?.assetId || null,
    mediaProjectId: media?.projectId || null,
    files: [],
  };
  if (media && !media.error) {
    if (!pl.mediaUrl && media.urls[0]) pl.mediaUrl = media.urls[0];
    if (media.kind === "video") pl.mediaType = "video";
    if (pl.channel === "drive") pl.files = media.files.slice(0, 10);
  }
  if (pl.mediaUrl && isVideo(pl.mediaUrl)) pl.mediaType = "video";
  return pl;
}

function previewOf(h, pl, media) {
  const pv = pl.channel === "drive" ? drive.preview(pl, prefs(h), secretFor(h, "drive"), h.HOSTED) : CH[pl.channel].preview(pl);
  const problems = [...pv.problems];
  if (media?.error) problems.unshift(media.error);
  if (media && !media.error && media.assetId && ACCEPTS[pl.channel] && !ACCEPTS[pl.channel].includes(media.kind)) problems.unshift(`${CH[pl.channel].name} cannot take a ${media.kind === "file" ? "file like this" : media.kind} item. Pick a place that can, such as Google Drive`);
  if (pl.channel === "instagram" && media && !media.error && !media.urls.length && !pl.mediaUrl && media.files.length) problems.push("The attached media is a file on this PC; Instagram needs a public https link. Use Host this file in MindMedia, or paste a link to the picture or video");
  if (pl.channel === "instagram" && media && !media.error && media.kind === "text" && !pl.mediaUrl) problems.push("Instagram posts need a picture or video. Paste a public link to one; your words become the caption");
  if (pl.channel === "ghl" && pl.when && pl.when < Date.now()) problems.push("The scheduled time is in the past");
  if (pl.channel === "slack" && pl.mediaUrl && !/^https:\/\//.test(pl.mediaUrl)) problems.push("Only an https media link can go into a Slack message");
  // 0.4.21: the same words check that texts and emails get. A hard block cannot be posted; warnings are shown.
  const compliance = checkOutgoing({ text: `${pl.title}\n${pl.text}`, channel: pl.channel, consent: pl.consent === true });
  for (const b of compliance.blocked) problems.push(`${b.plain} ${b.why}`);
  const warnings = compliance.warnings.filter((w) => w.level === "warn").map((w) => ({ rule: w.rule, plain: w.plain, why: w.why }));
  if (pl.masked) warnings.unshift({ rule: "private_numbers_hidden", plain: "Private numbers were hidden in this message.", why: "Social Security, card and account numbers keep only their last four digits before anything is shown or posted." });
  return { ...pv, problems, warnings };
}

function logPost(h, entry) {
  const name = CH[entry.channel].name;
  if (entry.status === "posted") recordSend({ channel: entry.channel, kind: "publish", to: entry.channelName || "", title: entry.title, text: entry.text, via: "publish" });
  h.emit("log", { text: `${entry.status === "posted" ? "Posted" : entry.status === "dry-run" ? "Dry run" : "Post failed"}: ${name}${entry.error ? ` · ${entry.error}` : ""}${/^https:\/\//.test(entry.result?.url || "") ? ` · ${entry.result.url}` : ""}`, level: entry.status === "failed" ? "error" : undefined, missionId: entry.missionId });
  // a ledger note for every post: zero cost, so the Credits tab and weekly report can see what went out
  try { h.recordCredits({ provider: entry.channel, units: 0, cost: 0, note: `${entry.status} · ${name} · ${entry.title}`.slice(0, 160), project: entry.projectId }); } catch (e) { console.error("[publish] ledger", e.message); }
}

function channelList(h) {
  const pr = prefs(h), con = Object.fromEntries(OA.view().map((c) => [c.id, c]));
  const how = (ch, paste) => { const c = con[CONNECTOR[ch]]; return c.connected ? `Connected: ${c.account || c.name}` : c.viaPaste ? "Pasted token" : paste; };
  return [
    { id: "instagram", name: "Instagram", ready: readyFor(h, "instagram"), connector: "meta", needs: how("instagram", "Connect Instagram, or paste a Page token + IG user id") },
    { id: "ghl", name: "HighLevel social planner", ready: readyFor(h, "ghl"), connector: "ghl", needs: how("ghl", "Connect HighLevel, or paste a private integration token + location id") },
    { id: "slack", name: "Slack", ready: readyFor(h, "slack"), connector: "slack", needs: how("slack", "Connect Slack (or paste a bot token)") },
    { id: "drive", name: "Google Drive", ready: readyFor(h, "drive"), connector: "google", needs: con.google.connected ? `Connected: uploads to the "Meldmind" folder` : h.HOSTED ? "Connect Google Drive" : "Connect Google Drive, or choose a Drive-synced folder", folder: pr.driveFolder || "" },
  ];
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/publish/, "");
  const seg = p.split("/").filter(Boolean);
  if (req.method === "GET" && p === "/connect-doctor") return h.json(res, 200, { checks: OA.doctor() });
  if (req.method === "GET" && p === "/send-log") return h.json(res, 200, { items: sendLog(Number(url.searchParams.get("limit")) || 100) });
  if (req.method === "GET" && p === "/channels") return h.json(res, 200, channelList(h).map((c) => ({ ...c, accepts: ACCEPTS[c.id] || [] })));
  if (req.method === "POST" && p === "/preview") {
    if (!CH[body.channel]) return h.json(res, 400, { error: "unknown channel" });
    sweep();
    const media = body.mediaAssetId ? mediaFromAsset(body.mediaProjectId, body.mediaAssetId) : mediaFromJob(h.doc(JOBS, () => ({ items: [] })).items, body.mediaJobId);
    const pl = buildPayload(body, media);
    const pv = previewOf(h, pl, media);
    const ready = readyFor(h, pl.channel);
    const previewId = "pv-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    previews.set(previewId, { userId: userOf(h), channel: pl.channel, payload: pl, problems: pv.problems, ready, createdAt: Date.now() });
    const mediaOut = media && !media.error ? { jobId: media.jobId, assetId: media.assetId, kind: media.kind, url: pl.mediaUrl, files: pl.files.length } : null;
    return h.json(res, 200, { ...pv, ready, dryRun: !ready, previewId, media: mediaOut });
  }
  if (req.method === "POST" && p === "/post") {
    if (!CH[body.channel] && body.channel !== undefined) return h.json(res, 400, { error: "unknown channel" });
    let phoneOk = false;
    try {
      phoneOk = !!holdOutbound({ kind: "send", action: `Post to ${body.channel || "a channel"}`, amount: null, approvalId: body.approvalId, confirmed: body.confirmed === true });
    } catch (e) {
      return h.json(res, e.status || 409, { error: e.message, code: e.code, approvalId: e.approvalId });
    }
    if (body.confirmed !== true && !phoneOk) return h.json(res, 400, { error: "preview and confirm first", code: "confirm_required" });
    sweep();
    const pv = previews.get(String(body.previewId || ""));
    if (!pv || pv.userId !== userOf(h)) return h.json(res, 409, { error: "Preview first (or the preview expired); nothing was sent", code: "preview_required" });
    if (body.channel && body.channel !== pv.channel) return h.json(res, 409, { error: "That preview was for a different channel", code: "preview_mismatch" });
    const ready = readyFor(h, pv.channel);
    if (ready && pv.problems.length) return h.json(res, 400, { error: `Fix these first, then preview again: ${pv.problems.join("; ")}`, code: "preview_problems" });
    previews.delete(String(body.previewId)); // one preview, one post
    const pl = pv.payload, ch = CH[pv.channel];
    // checked again on the stored payload, so a changed rule or a hand-made request cannot skip it
    const again = checkOutgoing({ text: `${pl.title}\n${pl.text}`, channel: pv.channel, consent: pl.consent === true });
    if (!again.ok && ready) return h.json(res, 422, { error: `Not sent. ${again.blocked[0].plain} ${again.blocked[0].why}`, code: "compliance_block" });
    const entry = { id: "pub-" + Date.now().toString(36), ts: Date.now(), channel: pv.channel, title: maskSensitive(pl.title), text: maskSensitive(pl.text).slice(0, 2200), mediaUrl: pl.mediaUrl, mediaJobId: pl.mediaJobId, mediaAssetId: pl.mediaAssetId, mediaProjectId: pl.mediaProjectId, when: pl.when, channelName: pl.channelName, projectId: pl.projectId, missionId: pl.missionId, previewId: String(body.previewId), status: "pending" };
    try {
      if (!ready) { entry.status = "dry-run"; entry.note = "No credentials for this channel: recorded, not sent."; }
      else {
        const sec = await OA.fresh(CONNECTOR[pv.channel]); // refreshes an expiring OAuth token first
        const r = pv.channel === "drive" ? await drive.post(pl, prefs(h), sec) : await ch.post(sec, pl);
        if (r.folderId && r.folderId !== prefs(h).driveFolderId) h.putDoc(PREFS, { ...prefs(h), driveFolderId: r.folderId });
        delete r.folderId;
        entry.status = "posted"; entry.result = r;
      }
    } catch (e) { entry.status = "failed"; entry.error = e.message; }
    const d = h.doc(HIST, () => ({ items: [] })); d.items.unshift(entry); d.items = d.items.slice(0, 500); h.putDoc(HIST, d);
    logPost(h, entry);
    // the item remembers where it went, with the link and the time (MindMedia)
    try { recordPublishResult({ projectId: pl.mediaProjectId, assetId: pl.mediaAssetId, mediaJobId: pl.mediaJobId, entry }); } catch (e) { console.error("[publish] mindmedia write-back", e.message); }
    return h.json(res, entry.status === "failed" ? 502 : 200, entry);
  }
  if (req.method === "GET" && p === "/history") return h.json(res, 200, h.doc(HIST, () => ({ items: [] })).items.slice(0, 100));
  if (req.method === "POST" && p === "/prefs") { const pr = { ...prefs(h), ...(body.driveFolder !== undefined ? { driveFolder: String(body.driveFolder).trim() } : {}) }; h.putDoc(PREFS, pr); return h.json(res, 200, { driveFolder: pr.driveFolder }); }
  if (req.method === "POST" && p === "/keys") {
    const token = String(body.token || "").trim();
    if (token) {
      const { assertServiceSlots } = await import("../service-limit.js");
      const catalog = { instagram: "instagram", ghl: "ghl", slack: "slack" };
      await assertServiceSlots([catalog[body.channel]]);
    }
    if (body.channel === "instagram") await h.setSecret("meta", token ? { key: token, igUserId: String(body.igUserId || "").trim() } : null);
    else if (body.channel === "ghl") await h.setSecret("ghl", token ? { key: token, locationId: String(body.locationId || "").trim() } : null);
    else if (body.channel === "slack") await h.setSecret("slack", token ? { key: token } : null);
    else return h.json(res, 400, { error: "unknown channel" });
    return h.json(res, 200, { ok: true });
  }
  if (req.method === "GET" && p === "/ghl-accounts") { const s = secretFor(h, "ghl"); if (!ghl.ready(s)) return h.json(res, 200, []); try { return h.json(res, 200, await ghl.accounts(await OA.fresh("ghl"))); } catch (e) { return h.json(res, e.status === 409 ? 409 : 500, { error: e.message }); } }
  if (req.method === "GET" && p === "/slack-channels") { const s = secretFor(h, "slack"); if (!slack.ready(s)) return h.json(res, 200, []); try { return h.json(res, 200, await slack.channels(s)); } catch (e) { return h.json(res, e.status === 409 ? 409 : 500, { error: e.message }); } }

  // OAuth connectors (Settings > Publishing)
  if (seg[0] === "connect") {
    try {
      if (req.method === "GET" && !seg[1]) return h.json(res, 200, OA.view());
      const k = seg[1];
      if (!OA.CONNECTORS[k]) return h.json(res, 400, { error: "unknown connector" });
      if (req.method === "POST" && seg[2] === "client") return h.json(res, 200, await OA.setClient(k, { clientId: body?.clientId, clientSecret: body?.clientSecret }));
      if (req.method === "POST" && seg[2] === "start") return h.json(res, 200, OA.start(k, { redirectUri: OA.publishRedirect() }));
      if (req.method === "POST" && seg[2] === "finish") return h.json(res, 200, await OA.finish({ code: body?.code, state: body?.state }));
      if (req.method === "DELETE" && !seg[2]) return h.json(res, 200, await OA.disconnect(k));
    } catch (e) { return h.json(res, e.status || 500, { error: e.message, code: e.code }); }
  }
  return false;
}
