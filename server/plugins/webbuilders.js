// Web and marketing builders (guided builders A) under /api/webbuilders. Preview names the AIs. Build stays on this computer.
// Publish and Fix it run only after a click. Tokens stay in the vault and are never returned.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureCatalog } from "../builders/web/catalog.js";
import { getBuilder, listBuilders, loadBuilderExtras, publicBuilder, registerBuilder, suggestBuilders } from "../builders/web/registry.js";
import { fieldsFor, defaultTarget, previewBuilder, buildBuilder, testBuilder, fixBuilder, publishBuilder, publicDraft } from "../builders/web/flow.js";
import { saveToMindMedia } from "../project-media.js";
import { assertWebAddress } from "../builders/web/publish.js";
import { REGULATED_WORDS } from "../builders/web/compliance.js";

export const id = "webbuilders";

const CONNECT = {
  netlify: "builder-netlify",
  vercel: "builder-vercel",
  postiz: "builder-postiz",
  listmonk: "builder-listmonk",
  mautic: "builder-mautic",
};
const KEY_RE = /\b(?:sk|sk-ant|sk-proj|sk-or|xai|gsk|ghp|github_pat)[-_][a-z0-9_\-]{8,}|\bAIza[0-9A-Za-z\-_]{10,}|\bAQ\.[A-Za-z0-9_\-]{10,}/gi;

const redact = (value) => String(value || "").replace(KEY_RE, "[hidden]");
const newId = (prefix) => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export async function init() {
  ensureCatalog();
  const extras = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "builders", "web", "extras");
  try { await loadBuilderExtras(extras, { registerBuilder }); }
  catch (e) { console.error("[webbuilders] extras", e.message); }
}

function connectorIds(h) {
  const ids = [];
  for (const [name, vaultId] of Object.entries(CONNECT)) {
    try { if (h.hasSecret(vaultId)) ids.push(name); } catch { /* vault not ready */ }
  }
  try { if (h.hasSecret("meta")) ids.push("instagram"); } catch { /* vault not ready */ }
  try { if (h.hasSecret("ghl")) ids.push("highlevel"); } catch { /* vault not ready */ }
  return ids;
}

function signalsOf(h) {
  const projects = (h.listProjects?.() || []).map((project) => ({
    name: project.name,
    kind: project.kind,
    summary: project.summary,
    categories: (project.categories || []).map((c) => c.name).join(" "),
  }));
  let text = "";
  try {
    const rows = h.ctx().store.listMissions((m) => [m?.title, m?.goal, m?.prompt].filter(Boolean).join(" "));
    text = rows.join("\n");
  } catch { /* no mission folder yet */ }
  const notes = h.doc("builders.notes", () => ({ items: [] })).items || [];
  text += `\n${notes.map((note) => note.text).join("\n")}`;
  return { text: redact(text), projects, connectors: connectorIds(h), notesLatest: notes[0]?.text || "" };
}

function drafts(h) {
  return h.doc("builders.drafts", () => ({ items: [] }));
}

function saveDraft(h, draft) {
  const box = drafts(h);
  const i = box.items.findIndex((row) => row.id === draft.id);
  if (i >= 0) box.items[i] = draft;
  else box.items.unshift(draft);
  box.items = box.items.slice(0, 40);
  h.putDoc("builders.drafts", box);
  return draft;
}

function findDraft(h, draftId) {
  return drafts(h).items.find((row) => row.id === draftId) || null;
}

function flowCtx(h) {
  let ranked = [];
  try {
    const rows = h.rank({ capability: "writing", difficulty: 2, mode: "balanced", estIn: 400, estOut: 180 });
    if (Array.isArray(rows)) ranked = rows;
  } catch { /* routing can be empty in demo-off tests */ }
  const notes = h.doc("builders.notes", () => ({ items: [] })).items || [];
  return { tier: h.licenseState().tier, ranked, connectors: connectorIds(h), note: notes[0]?.text || "" };
}

function writeFiles(h, draft) {
  if (h.HOSTED || !h.DATA_DIR || !draft.files?.length) return [];
  const folderId = String(draft.projectId || draft.id).replace(/[^a-z0-9-]/gi, "");
  const root = path.resolve(h.DATA_DIR);
  const dest = path.resolve(root, "projects", folderId, "site");
  const relRoot = root.endsWith(path.sep) ? root : root + path.sep;
  if (dest !== root && !dest.startsWith(relRoot)) return [];
  const written = [];
  for (const file of draft.files) {
    const rel = String(file.path || "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!rel || rel.includes("..")) continue;
    const full = path.resolve(dest, rel);
    if (full !== dest && !full.startsWith(dest + path.sep)) continue;
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, String(file.text ?? ""), "utf8");
    written.push(["projects", folderId, "site", ...rel.split("/")].join("/"));
  }
  return written;
}

// Every finished site is also filed in MindMedia (one item, the start page) so it is never lost.
function keepSite(h, draft) {
  try {
    const rels = draft.written || [];
    const home = rels.find((r) => /\/index\.html?$/i.test(r)) || rels.find((r) => /\.html?$/i.test(r)) || rels[0];
    if (!home) return null;
    return saveToMindMedia({ kind: "site", projectId: draft.projectId || "", source: "Web builder", name: draft.name || "Website", dedupeKey: `site:${draft.id}`, files: [{ name: path.basename(home), path: path.resolve(h.DATA_DIR, home) }] });
  } catch { return null; }
}

// Text builders (ad copy, reel plan, social calendar, email sequences) are filed in MindMedia as soon as they are built.
const TEXT_BUILDERS = new Set(["ad-copy", "reel-maker", "social-calendar", "email-sequences"]);
function textOf(draft) {
  const a = draft.artifact || {};
  if (a.lines) return a.lines.map((l) => `${l.part} (${l.max}): ${l.text}`).join("\n");
  if (a.posts) return a.posts.map((p) => `${p.day} (${p.angle || "Post"}): ${p.text}`).join("\n\n");
  if (a.emails) return a.emails.map((e, i) => `Email ${i + 1}, day ${e.day ?? i * 3}: ${e.subject}\n${e.body}`).join("\n\n---\n\n");
  if (a.captions) return [`Reel plan, ${a.seconds} seconds`, ...a.captions.map((c) => `${c.at} caption: ${c.text}`), ...a.cuts.map((c) => `Cut ${c.start}-${c.end}s: ${c.reason}`)].join("\n");
  return "";
}
function keepText(h, draft) {
  try {
    if (!TEXT_BUILDERS.has(draft.builderId)) return null;
    const text = textOf(draft);
    if (!text.trim()) return null;
    return saveToMindMedia({ kind: "text", projectId: draft.projectId || "", source: "Web builder", name: `${draft.title || "Builder"}: ${draft.name || "draft"}`.slice(0, 120), text, dedupeKey: `webtext:${draft.id}` });
  } catch { return null; }
}

function rememberProject(h, draft) {
  const builder = getBuilder(draft.builderId);
  const projectId = newId("bld-");
  try {
    h.guard?.("projects", { count: h.listProjects().length });
    h.saveProject({
      id: projectId,
      name: draft.name || builder?.title || "Builder",
      color: builder?.group === "marketing" ? "#f59e0b" : "#22d3ee",
      kind: builder?.group === "web" ? "website" : "marketing",
      summary: draft.about || "",
      categories: [],
    });
    return projectId;
  } catch {
    return null;
  }
}

function tokenFor(h, target) {
  if (target === "highlevel") return h.getSecret("ghl")?.key || "";
  const vaultId = CONNECT[target];
  if (!vaultId) return "";
  return h.getSecret(vaultId)?.key || "";
}

function serviceUrl(h, target) {
  const urls = h.doc("builders.services", () => ({ urls: {} })).urls || {};
  return urls[target] || "";
}

function send(h, res, status, body) {
  return h.json(res, status, body);
}

export async function routes(req, res, url, body, h) {
  ensureCatalog();
  const p = url.pathname.replace(/^\/api\/webbuilders\/?/, "");
  const seg = p.split("/").filter(Boolean);
  const ctx = () => flowCtx(h);

  if (req.method === "GET" && seg.length === 0) {
    const signals = signalsOf(h);
    const suggested = suggestBuilders(signals);
    const suggestedIds = new Set(suggested.map((row) => row.id));
    return send(h, res, 200, {
      suggested,
      all: listBuilders().map((builder) => publicBuilder(builder, suggestedIds.has(builder.id) ? (suggested.find((row) => row.id === builder.id)?.reason || null) : null)),
      steps: ["Describe", "Preview the AIs", "Build", "Test", "Publish"],
      regulatedWords: REGULATED_WORDS,
      notice: signals.notesLatest || "",
      tier: h.licenseState().tier,
    });
  }

  if (req.method === "POST" && seg[0] === "notice" && seg.length === 1) {
    const text = redact(body?.text).replace(/\s+/g, " ").trim().slice(0, 240);
    if (!text || text === "[hidden]") return send(h, res, 400, { error: "Say what you are working on." });
    const box = h.doc("builders.notes", () => ({ items: [] }));
    box.items = [{ text, ts: Date.now() }, ...(box.items || [])].slice(0, 30);
    h.putDoc("builders.notes", box);
    return send(h, res, 200, { ok: true });
  }

  if (req.method === "GET" && seg[0] === "connect" && seg.length === 1) {
    const urls = h.doc("builders.services", () => ({ urls: {} })).urls || {};
    return send(h, res, 200, {
      services: Object.keys(CONNECT).map((service) => ({
        id: service,
        connected: !!h.hasSecret(CONNECT[service]),
        address: urls[service] || "",
      })),
      highlevel: !!h.hasSecret("ghl"),
    });
  }

  if (req.method === "POST" && seg[0] === "connect" && seg.length === 1) {
    const service = String(body?.service || "").toLowerCase();
    if (!CONNECT[service]) return send(h, res, 400, { error: "Unknown connection.", code: "unknown" });
    const token = String(body?.token || "").trim();
    const urlText = String(body?.url || body?.serviceUrl || "").trim();
    if (!token && !urlText) return send(h, res, 400, { error: "Add a token or a service address.", code: "missing" });
    if (token && (token.length < 8 || token.length > 500)) return send(h, res, 400, { error: "That token does not look usable.", code: "bad_token" });
    if (urlText) {
      const check = assertWebAddress(urlText);
      if (!check.ok) return send(h, res, 400, { error: check.error, code: check.code });
      const box = h.doc("builders.services", () => ({ urls: {} }));
      box.urls = { ...(box.urls || {}), [service]: check.url };
      h.putDoc("builders.services", box);
    }
    if (token) {
      try { await h.setSecret(CONNECT[service], { key: token }); }
      catch (e) { return send(h, res, e.status || 400, { error: e.message, code: e.code }); }
    }
    h.emit("log", { text: `Builders: ${service} connection saved. The token stays in the vault.` });
    return send(h, res, 200, { service, connected: !!h.hasSecret(CONNECT[service]), addressSaved: !!urlText });
  }

  if (req.method === "DELETE" && seg[0] === "connect" && seg[1]) {
    const service = String(seg[1] || "").toLowerCase();
    if (!CONNECT[service]) return send(h, res, 400, { error: "Unknown connection.", code: "unknown" });
    try { await h.setSecret(CONNECT[service], null); }
    catch (e) { return send(h, res, e.status || 400, { error: e.message, code: e.code }); }
    return send(h, res, 200, { service, connected: false });
  }

  const builder = getBuilder(seg[0]);
  if (!builder) return false;
  const action = seg[1] || "";

  if (req.method === "GET" && !action) {
    const flow = ctx();
    return send(h, res, 200, {
      builder: publicBuilder(builder),
      fields: fieldsFor(builder.id),
      defaults: {
        pages: "Home, About, Contact",
        posts: 3,
        seconds: 15,
        platform: "instagram",
        service: "listmonk",
        unsubscribe: "Reply with the word unsubscribe",
        audience: "People nearby",
        target: defaultTarget(builder.id, flow),
        remotion: false,
      },
      gate: previewBuilder(builder.id, {}, flow).gate,
    });
  }

  if (req.method === "POST" && action === "preview") {
    const out = previewBuilder(builder.id, body || {}, ctx());
    return send(h, res, out.ok ? 200 : out.status, out.ok ? out : { error: out.error, code: out.code, compliance: out.compliance || null, gate: out.gate || null });
  }

  if (req.method === "POST" && action === "build") {
    const out = buildBuilder(builder.id, body || {}, ctx());
    if (!out.ok) return send(h, res, out.status, { error: out.error, code: out.code, compliance: out.compliance || null, gate: out.gate || null });
    const draft = { ...out.draft, id: newId("bd-"), createdAt: Date.now() };
    draft.projectId = rememberProject(h, draft);
    draft.written = writeFiles(h, draft);
    const keptText = keepText(h, draft);
    if (keptText) draft.mindmedia = { projectId: keptText.projectId, assetId: keptText.items?.[0]?.id, where: keptText.where };
    saveDraft(h, draft);
    h.emit("log", { text: `Builders: ${builder.title} saved on this computer.` });
    return send(h, res, 200, { ...out, draft: publicDraft(draft) });
  }

  if (req.method === "POST" && (action === "test" || action === "fix" || action === "publish")) {
    const draft = findDraft(h, String(body?.draftId || ""));
    if (!draft || draft.builderId !== builder.id) return send(h, res, 404, { error: "Build first. Nothing was sent.", code: "missing" });
    if (action === "test") {
      const out = testBuilder(draft);
      saveDraft(h, out.draft);
      return send(h, res, 200, { ...out, draft: publicDraft(out.draft) });
    }
    if (action === "fix") {
      if (body?.confirm !== true) return send(h, res, 400, { error: "Click Fix it to change the page. Nothing was sent.", code: "confirm" });
      const out = fixBuilder(draft, String(body?.issueId || ""));
      if (!out.ok) return send(h, res, out.status, { error: out.error, code: out.code });
      out.draft.written = writeFiles(h, out.draft);
      saveDraft(h, out.draft);
      h.emit("log", { text: "Builders: applied a fix on this computer." });
      return send(h, res, 200, { ...out, draft: publicDraft(out.draft) });
    }
    const target = String(body?.target || draft.publishDefault || "local").toLowerCase();
    const out = await publishBuilder(draft, body || {}, {
      ...ctx(),
      token: tokenFor(h, target),
      serviceUrl: serviceUrl(h, target),
    });
    if (!out.ok) return send(h, res, out.status, { error: out.error, code: out.code, issues: out.issues || null });
    draft.published = { status: out.status, target: out.target, dryRun: !!out.dryRun, note: out.note, link: out.link || null, at: Date.now() };
    if (out.status === "saved") draft.written = writeFiles(h, draft);
    const kept = TEXT_BUILDERS.has(draft.builderId) ? keepText(h, draft) : draft.written?.length ? keepSite(h, draft) : null;
    if (kept) draft.mindmedia = { projectId: kept.projectId, assetId: kept.items?.[0]?.id, where: kept.where };
    saveDraft(h, draft);
    try {
      h.recordCredits({ provider: out.target, units: 0, cost: 0, note: `builders ${out.status} ${out.target}`.slice(0, 160), project: draft.projectId });
    } catch { /* the result still stands */ }
    h.emit("log", { text: out.dryRun ? `Builders: ${out.target} dry run. Nothing was sent.` : out.sent ? `Builders: sent to ${out.target} after a click.` : `Builders: ${out.target} saved on this computer.` });
    return send(h, res, 200, { ...out, draft: publicDraft(draft) });
  }

  return false;
}
