// Website publish for Cloudflare Pages, Vercel and Netlify (slice C4, flag publish).
// A plan shows exactly which files go where. Only a click on that plan sends anything, and a live (production)
// deploy needs its own click. Tokens stay in the vault and travel only in a header. Nothing here logs one.
// Preview means a copy on the host's preview address. Live means the real site. Rollback makes an older
// live deploy the live one again.
import crypto from "node:crypto";
import { isLoopback, localFetch } from "../loopback-fetch.js";

export const TARGETS = {
  cloudflare: { name: "Cloudflare Pages", vault: "builder-cloudflare", fields: ["accountId", "project"], words: { accountId: "Account id", project: "Project name" } },
  vercel: { name: "Vercel", vault: "builder-vercel", fields: ["project"], words: { project: "Project name" } },
  netlify: { name: "Netlify", vault: "builder-netlify", fields: ["siteId"], words: { siteId: "Site id" } },
};
export const MAX_FILES = 300;
export const MAX_BYTES = 8 * 1024 * 1024;
const API = {
  cloudflare: () => process.env.CC_CLOUDFLARE_API || "https://api.cloudflare.com",
  vercel: () => process.env.CC_VERCEL_API || "https://api.vercel.com",
  netlify: () => process.env.CC_NETLIFY_API || "https://api.netlify.com",
};
const sha = (s, algo = "sha256") => crypto.createHash(algo).update(s).digest("hex");
const bad = (status, code, message, extra) => Object.assign(new Error(message), { status, code, ...(extra || {}) });
const idOk = (s) => /^[A-Za-z0-9._-]{1,100}$/.test(String(s || ""));

export function safePath(p) {
  const s = String(p || "").replace(/^\/+/, "");
  if (!s || s.length > 200 || s.includes("\\") || s.includes("\0") || s.split("/").some((x) => x === ".." || x === "." || x === "")) return null;
  return s;
}

// The files of a built website draft (server/builders/web/flow.js). Text files only.
export function collectFiles(draft) {
  const out = [];
  for (const f of draft?.files || []) {
    const p = safePath(f.path);
    if (!p || typeof f.text !== "string") continue;
    out.push({ path: p, text: f.text, bytes: Buffer.byteLength(f.text) });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function siteHash({ target, production, files, config }) {
  const ident = TARGETS[target]?.fields.map((k) => `${k}=${config?.[k] || ""}`).join("|");
  return sha(JSON.stringify([target, !!production, ident, files.map((f) => [f.path, sha(f.text)])])).slice(0, 24);
}

// The plan the person reads before clicking. Same inputs, same hash, so a deploy can prove it matches.
export function planSite({ draft, target, production = false, config = {}, connected = false }) {
  const t = TARGETS[target];
  if (!t) throw bad(400, "target", "Pick Cloudflare Pages, Vercel or Netlify.");
  const files = collectFiles(draft);
  const problems = [];
  if (!draft) problems.push("Build a website first (Websites tab).");
  else if (!files.length) problems.push("This draft has no files to publish.");
  if (files.length && !files.some((f) => f.path === "index.html")) problems.push("There is no index.html, so the site would open to nothing.");
  if (files.length > MAX_FILES) problems.push(`More than ${MAX_FILES} files.`);
  const bytes = files.reduce((n, f) => n + f.bytes, 0);
  if (bytes > MAX_BYTES) problems.push("The site is over 8 MB.");
  for (const k of t.fields) if (!idOk(config?.[k])) problems.push(`Add the ${t.words[k].toLowerCase()} for ${t.name}.`);
  const where = t.fields.map((k) => `${t.words[k].toLowerCase()} ${config?.[k] || "(not set)"}`).join(", ");
  const index = files.find((f) => f.path === "index.html");
  return {
    target, targetName: t.name, production: !!production,
    mode: production ? "Live site" : "Preview copy",
    where, connected: !!connected,
    files: files.map((f) => ({ path: f.path, bytes: f.bytes })), count: files.length, bytes,
    hash: siteHash({ target, production, files, config }),
    problems,
    ready: !!connected && !problems.length,
    dryRun: !connected,
    summary: production
      ? `Put ${files.length} file${files.length === 1 ? "" : "s"} on the LIVE site at ${t.name} (${where}). Visitors will see it right away.`
      : `Send ${files.length} file${files.length === 1 ? "" : "s"} to ${t.name} (${where}) as a preview copy. The live site does not change.`,
    previewHtml: index ? index.text.slice(0, 200000) : "",
  };
}

async function call(url, opts, { token, fetchImpl }) {
  if (process.env.CC_NET_TRACE === "1" && !isLoopback(url)) throw bad(400, "blocked", "This run does not call outside services. Nothing was sent.");
  const doFetch = fetchImpl || localFetch;
  let res;
  try { res = await doFetch(url, { ...opts, headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(opts.headers || {}) }, signal: AbortSignal.timeout(60000), redirect: "error" }); }
  catch { throw bad(502, "service", "Could not reach the service. Nothing else was sent."); }
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* a non-JSON body is still a reply */ }
  if (!res.ok) {
    const msg = json?.errors?.[0]?.message || json?.error?.message || json?.message || (typeof json?.error === "string" ? json.error : "") || `The service answered ${res.status}`;
    throw bad(502, "service", String(msg).split(token).join("[token]").slice(0, 180));
  }
  return json || {};
}
const https = (u) => (typeof u === "string" && u ? (/^https?:\/\//.test(u) ? u : `https://${u}`) : null);

// ---------- deploy ----------
export async function deploySite({ target, token, config, files, production, fetchImpl }) {
  const base = API[target]();
  const ctx = { token, fetchImpl };
  if (target === "netlify") {
    const site = encodeURIComponent(config.siteId);
    const digests = Object.fromEntries(files.map((f) => ["/" + f.path, sha(f.text, "sha1")]));
    const made = await call(`${base}/api/v1/sites/${site}/deploys`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ files: digests, draft: !production }) }, ctx);
    const need = new Set(made.required || []);
    for (const f of files) {
      if (!need.has(digests["/" + f.path])) continue;
      await call(`${base}/api/v1/deploys/${encodeURIComponent(made.id)}/files/${f.path.split("/").map(encodeURIComponent).join("/")}`, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: f.text }, ctx);
    }
    return { deployId: made.id, url: https(made.deploy_ssl_url || made.ssl_url || made.url) };
  }
  if (target === "vercel") {
    const body = { name: config.project, project: config.project, files: files.map((f) => ({ file: f.path, data: f.text, encoding: "utf-8" })), projectSettings: { framework: null }, ...(production ? { target: "production" } : {}) };
    const made = await call(`${base}/v13/deployments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, ctx);
    return { deployId: made.id, url: https(made.url) };
  }
  // Cloudflare Pages direct upload: a manifest of path to hash, and each file under its hash.
  const form = new FormData();
  const manifest = {};
  for (const f of files) { const hsh = sha(f.text).slice(0, 32); manifest["/" + f.path] = hsh; form.append(hsh, new Blob([f.text]), f.path); }
  form.append("manifest", JSON.stringify(manifest));
  form.append("branch", production ? "main" : "preview");
  const made = await call(`${base}/client/v4/accounts/${encodeURIComponent(config.accountId)}/pages/projects/${encodeURIComponent(config.project)}/deployments`, { method: "POST", body: form }, ctx);
  const r = made.result || {};
  return { deployId: r.id, url: https(r.url) };
}

// Make an older live deploy the live one again.
export async function rollbackSite({ target, token, config, deployId, fetchImpl }) {
  const base = API[target](), ctx = { token, fetchImpl }, id = encodeURIComponent(deployId);
  if (target === "netlify") { const r = await call(`${base}/api/v1/sites/${encodeURIComponent(config.siteId)}/deploys/${id}/restore`, { method: "POST" }, ctx); return { url: https(r.ssl_url || r.url) }; }
  if (target === "vercel") { await call(`${base}/v10/projects/${encodeURIComponent(config.project)}/promote/${id}`, { method: "POST" }, ctx); return { url: null }; }
  const r = await call(`${base}/client/v4/accounts/${encodeURIComponent(config.accountId)}/pages/projects/${encodeURIComponent(config.project)}/deployments/${id}/rollback`, { method: "POST" }, ctx);
  return { url: https(r.result?.url) };
}

// ---------- history ----------
export const HIST = "publish.sites.history", CFG = "publish.sites.config";
export const readConfig = (h) => h.doc(CFG, () => ({ targets: {} })).targets || {};
export function saveConfig(h, target, vals) {
  const t = TARGETS[target];
  if (!t) throw bad(400, "target", "Pick Cloudflare Pages, Vercel or Netlify.");
  const d = h.doc(CFG, () => ({ targets: {} }));
  const next = { ...(d.targets?.[target] || {}) };
  for (const k of t.fields) if (vals?.[k] !== undefined) {
    const v = String(vals[k]).trim();
    if (v && !idOk(v)) throw bad(400, "bad_value", `${t.words[k]} may only use letters, numbers, dots, dashes and underscores.`);
    next[k] = v;
  }
  d.targets = { ...(d.targets || {}), [target]: next };
  h.putDoc(CFG, d);
  return next;
}
export const readHistory = (h) => h.doc(HIST, () => ({ items: [] })).items;
export function addHistory(h, entry) {
  const d = h.doc(HIST, () => ({ items: [] }));
  d.items.unshift(entry); d.items = d.items.slice(0, 200);
  h.putDoc(HIST, d);
  return entry;
}
export function patchHistory(h, id, patch) {
  const d = h.doc(HIST, () => ({ items: [] })), it = d.items.find((x) => x.id === id);
  if (it) { Object.assign(it, patch); h.putDoc(HIST, d); }
  return it;
}
// Only one live deploy per host is "live" at a time. Older live deploys can be made live again.
export function setLive(h, entry) {
  const d = h.doc(HIST, () => ({ items: [] }));
  for (const x of d.items) if (x.target === entry.target && x.production) x.live = x.id === entry.id;
  h.putDoc(HIST, d);
}
export const canRollBackTo = (entry) => !!entry && !!entry.production && entry.status === "deployed" && !!entry.deployId && !entry.live;
