// Posting hooks: send a finished deliverable to Instagram, the GoHighLevel social planner, or a
// Drive-synced folder. Always preview first; nothing leaves without an explicit confirm.
import * as instagram from "../publish/meta.js";
import * as ghl from "../publish/ghl.js";
import * as drive from "../publish/drive.js";

export const id = "publish";
const HIST = "publish.history", PREFS = "publish.prefs";
const CH = { instagram, ghl, drive };

function prefs(h) { return h.doc(PREFS, () => ({ driveFolder: "" })); }
function secretFor(h, ch) { return ch === "instagram" ? h.getSecret("meta") : ch === "ghl" ? h.getSecret("ghl") : null; }

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/publish/, "");
  if (req.method === "GET" && p === "/channels") {
    const pr = prefs(h);
    return h.json(res, 200, [
      { id: "instagram", name: "Instagram", ready: instagram.ready(h.getSecret("meta")), needs: "Page access token + IG user id" },
      { id: "ghl", name: "GoHighLevel social planner", ready: ghl.ready(h.getSecret("ghl")), needs: "Private integration token + location id" },
      { id: "drive", name: "Drive folder", ready: drive.ready(pr, h.HOSTED), needs: h.HOSTED ? "Not available in hosted mode yet" : "A Drive-synced folder path", folder: pr.driveFolder || "" },
    ]);
  }
  if (req.method === "POST" && p === "/preview") {
    const ch = CH[body.channel]; if (!ch) return h.json(res, 400, { error: "unknown channel" });
    const pv = body.channel === "drive" ? drive.preview(body, prefs(h)) : ch.preview(body);
    const ready = body.channel === "drive" ? drive.ready(prefs(h), h.HOSTED) : ch.ready(secretFor(h, body.channel));
    return h.json(res, 200, { ...pv, ready, dryRun: !ready });
  }
  if (req.method === "POST" && p === "/post") {
    const ch = CH[body.channel]; if (!ch) return h.json(res, 400, { error: "unknown channel" });
    if (!body.confirmed) return h.json(res, 400, { error: "preview and confirm first" });
    const entry = { id: "pub-" + Date.now().toString(36), ts: Date.now(), channel: body.channel, title: String(body.title || "").slice(0, 120), text: String(body.text || "").slice(0, 2200), mediaUrl: body.mediaUrl || null, when: body.when || null, projectId: body.projectId || null, missionId: body.missionId || null, status: "pending" };
    const ready = body.channel === "drive" ? drive.ready(prefs(h), h.HOSTED) : ch.ready(secretFor(h, body.channel));
    try {
      if (!ready) { entry.status = "dry-run"; entry.note = "No credentials for this channel: recorded, not sent."; }
      else { const r = body.channel === "drive" ? await drive.post(body, prefs(h)) : await ch.post(secretFor(h, body.channel), body); entry.status = "posted"; entry.result = r; }
    } catch (e) { entry.status = "failed"; entry.error = e.message; }
    const d = h.doc(HIST, () => ({ items: [] })); d.items.unshift(entry); d.items = d.items.slice(0, 500); h.putDoc(HIST, d);
    h.emit("log", { text: `${entry.status === "posted" ? "Posted" : entry.status === "dry-run" ? "Dry run" : "Post failed"}: ${CH[body.channel].name}${entry.error ? ` · ${entry.error}` : ""}${entry.result?.url ? ` · ${entry.result.url}` : ""}`, level: entry.status === "failed" ? "error" : undefined, missionId: entry.missionId });
    return h.json(res, entry.status === "failed" ? 502 : 200, entry);
  }
  if (req.method === "GET" && p === "/history") return h.json(res, 200, h.doc(HIST, () => ({ items: [] })).items.slice(0, 100));
  if (req.method === "POST" && p === "/prefs") { const pr = { ...prefs(h), ...(body.driveFolder !== undefined ? { driveFolder: String(body.driveFolder).trim() } : {}) }; h.putDoc(PREFS, pr); return h.json(res, 200, pr); }
  if (req.method === "POST" && p === "/keys") {
    if (body.channel === "instagram") await h.setSecret("meta", { key: body.token, igUserId: String(body.igUserId || "").trim() });
    else if (body.channel === "ghl") await h.setSecret("ghl", { key: body.token, locationId: String(body.locationId || "").trim() });
    else return h.json(res, 400, { error: "unknown channel" });
    return h.json(res, 200, { ok: true });
  }
  if (req.method === "GET" && p === "/ghl-accounts") { const s = h.getSecret("ghl"); if (!ghl.ready(s)) return h.json(res, 200, []); try { return h.json(res, 200, await ghl.accounts(s)); } catch (e) { return h.json(res, 500, { error: e.message }); } }
  return false;
}
