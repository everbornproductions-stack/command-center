// Work for the guided builders. Heavy tools are not installed and not downloaded.
// GrapesJS, Puck, Astro, Lighthouse, WhisperX, and auto-editor are named here
// with their licenses. The page, the check, the transcript, and the cut list
// are drafted in this file. Postiz is never imported: it is only an address
// the person types. Remotion stays off unless the person turns it on.
//
// Network calls go through localFetch. A test run (CC_NET_TRACE=1) refuses any
// host that is not this computer.

import { isLoopback, localFetch } from "./loopback-fetch.js";

export const CAN_SPAM = "You got this email because you asked to hear from us. Unsubscribe: {{unsubscribe_url}}. Our postal address: {{postal_address}}.";

export const PLATFORMS = [
  { id: "google", label: "Google", fields: [{ id: "headline", limit: 30 }, { id: "description", limit: 90 }] },
  { id: "meta", label: "Meta", fields: [{ id: "primary", limit: 125 }, { id: "headline", limit: 40 }] },
  { id: "linkedin", label: "LinkedIn", fields: [{ id: "intro", limit: 150 }, { id: "headline", limit: 70 }] },
  { id: "x", label: "X", fields: [{ id: "text", limit: 280 }] },
  { id: "tiktok", label: "TikTok", fields: [{ id: "text", limit: 100 }] },
];

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}

export function firstLine(s) {
  const line = String(s || "").split(/\n/).map((x) => x.trim()).find(Boolean) || "";
  return line.slice(0, 120);
}

export function clip(s, n) {
  const text = String(s || "").replace(/\s+/g, " ").trim();
  return text.slice(0, n);
}

export function bad(message, status = 400, code = "bad_request") {
  return Object.assign(new Error(message), { status, code });
}

export function assertConfirm(message) {
  throw bad(message, 409, "confirm_required");
}

export function assertLoopback(url) {
  if (process.env.CC_NET_TRACE === "1" && !isLoopback(url)) {
    throw bad("Nothing was sent. This run does not call the internet.", 400, "offline");
  }
}

export function cleanBase(url) {
  let u;
  try { u = new URL(String(url || "")); } catch { throw bad("That address is not a valid link."); }
  if (u.username || u.password) throw bad("Put the token in the token box, not in the address.");
  if (u.protocol !== "http:" && u.protocol !== "https:") throw bad("Use an http or https address.");
  return u.origin;
}

export function siteModel(brief, written) {
  const title = firstLine(brief) || "My site";
  const lead = clip(written || brief || "Tell people what you do.", 600);
  return {
    engine: {
      name: "GrapesJS",
      license: "BSD-3",
      bundled: false,
      note: "The visual editor is GrapesJS (BSD-3). It is not downloaded. These blocks are the page.",
    },
    sections: [
      { type: "hero", heading: title.slice(0, 80), text: lead },
      { type: "text", heading: "How it works", text: "Three short steps. You can change each one." },
      { type: "cta", heading: "Get in touch", text: "Add your offer here." },
    ],
  };
}

export function siteHtml(model) {
  const title = esc(model?.sections?.[0]?.heading || "Home");
  const desc = esc(clip(model?.sections?.[0]?.text || "", 155));
  const body = (model?.sections || []).map((sec) => {
    if (sec.type === "hero") return `<h1>${esc(sec.heading)}</h1><p>${esc(sec.text)}</p>`;
    if (sec.type === "cta") return `<h2>${esc(sec.heading)}</h2><p>${esc(sec.text)}</p><p><a href="#contact">${esc(sec.heading || "Contact")}</a></p>`;
    return `<h2>${esc(sec.heading)}</h2><p>${esc(sec.text)}</p>`;
  }).join("\n");
  return `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><meta name="description" content="${desc}"></head><body>\n${body}\n</body></html>`;
}

export function buildSite({ brief, written }) {
  const model = siteModel(brief, written);
  return { model, html: siteHtml(model) };
}

export function buildPage({ brief, written }) {
  const title = firstLine(brief) || "Client page";
  const text = clip(written || brief || "Write the page in plain words.", 800);
  const content = [
    { type: "Heading", props: { text: title.slice(0, 80) } },
    { type: "Text", props: { text } },
    { type: "Button", props: { label: "Contact", href: "#contact" } },
  ];
  const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(clip(text, 155))}"></head><body><h1>${esc(title)}</h1><p>${esc(text)}</p><p><a href="#contact">Contact</a></p></body></html>`;
  return {
    engine: {
      name: "Puck",
      license: "MIT",
      bundled: false,
      note: "The page editor is Puck (MIT). It is not downloaded. These blocks are the page.",
    },
    content,
    html,
  };
}

// A description is not a finished page. The check looks at this sparse page
// so Fix it has real gaps to close (title, description, language, image text).
export function sparsePage(brief) {
  const text = esc(clip(brief || "Page", 800));
  return `<!doctype html><html><body><p>${text}</p><img src="photo.png"></body></html>`;
}

export function auditHtml(html) {
  const src = String(html || "");
  const issues = [];
  if (!/<title>[^<]{1,}<\/title>/i.test(src)) issues.push({ id: "title", category: "seo", title: "Add a page title", fixable: true });
  if (!/name=["']description["']/i.test(src)) issues.push({ id: "meta", category: "seo", title: "Add a short description", fixable: true });
  if (!/name=["']viewport["']/i.test(src)) issues.push({ id: "viewport", category: "performance", title: "Add a viewport tag so phones fit the page", fixable: true });
  if (!/<h1[\s>]/i.test(src)) issues.push({ id: "h1", category: "seo", title: "Add a main heading", fixable: true });
  if (/<img\b(?![^>]*\balt=)/i.test(src)) issues.push({ id: "alt", category: "accessibility", title: "Describe each image", fixable: true });
  if (!/<html[^>]*\blang=/i.test(src)) issues.push({ id: "lang", category: "accessibility", title: "Say which language the page uses", fixable: true });
  const count = (cat) => issues.filter((i) => i.category === cat).length;
  const score = (n) => Math.max(0, 100 - n * 20);
  return {
    engine: {
      name: "Lighthouse",
      license: "Apache-2.0",
      ran: false,
      note: "Checked on this computer. Lighthouse is not downloaded.",
    },
    scores: {
      performance: score(count("performance")),
      accessibility: score(count("accessibility")),
      seo: score(count("seo")),
      bestPractices: 100,
    },
    issues,
  };
}

export function applyFix(html, fixId, value) {
  let src = String(html || "");
  const v = esc(value || "").trim();
  if (fixId === "lang") {
    if (/<html[^>]*\blang=/i.test(src)) return src;
    if (/<html\b/i.test(src)) return src.replace(/<html\b/i, "<html lang=\"en\"");
    return `<!doctype html><html lang="en"><body>${src}</body></html>`;
  }
  if (fixId === "title") {
    const title = v || "Home";
    if (/<title>[\s\S]*?<\/title>/i.test(src)) return src.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`);
    if (/<head\b[^>]*>/i.test(src)) return src.replace(/<head\b[^>]*>/i, (m) => `${m}<title>${title}</title>`);
    if (/<html\b[^>]*>/i.test(src)) return src.replace(/<html\b[^>]*>/i, (m) => `${m}<head><title>${title}</title></head>`);
    return `<!doctype html><html lang="en"><head><title>${title}</title></head><body>${src}</body></html>`;
  }
  if (fixId === "meta") {
    const desc = v || "A short description.";
    const tag = `<meta name="description" content="${desc}">`;
    if (/name=["']description["']/i.test(src)) return src.replace(/<meta\b[^>]*name=["']description["'][^>]*>/i, tag);
    if (/<head\b[^>]*>/i.test(src)) return src.replace(/<head\b[^>]*>/i, (m) => `${m}${tag}`);
    if (/<html\b[^>]*>/i.test(src)) return src.replace(/<html\b[^>]*>/i, (m) => `${m}<head>${tag}</head>`);
    return src;
  }
  if (fixId === "viewport") {
    if (/name=["']viewport["']/i.test(src)) return src;
    const tag = "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">";
    if (/<head\b[^>]*>/i.test(src)) return src.replace(/<head\b[^>]*>/i, (m) => `${m}${tag}`);
    if (/<html\b[^>]*>/i.test(src)) return src.replace(/<html\b[^>]*>/i, (m) => `${m}<head>${tag}</head>`);
    return src;
  }
  if (fixId === "h1") {
    if (/<h1[\s>]/i.test(src)) return src;
    const heading = v || "Welcome";
    if (/<body\b[^>]*>/i.test(src)) return src.replace(/<body\b[^>]*>/i, (m) => `${m}<h1>${heading}</h1>`);
    return `<h1>${heading}</h1>${src}`;
  }
  if (fixId === "alt") {
    return src.replace(/<img\b([^>]*?)>/gi, (full, attrs) => (/\balt=/i.test(attrs) ? full : `<img alt=""${attrs}>`));
  }
  return src;
}

export function applyFixes(html, fixes) {
  let src = html;
  for (const fix of fixes || []) src = applyFix(src, fix.id, fix.value);
  return src;
}

export function toAstro(html, title) {
  const name = title || "Home";
  const page = String(html || "<p>Empty page</p>");
  return {
    engine: {
      name: "Astro",
      license: "MIT",
      downloaded: false,
      note: "These are Astro project files. Astro itself is not downloaded.",
    },
    files: {
      "README.txt": "Astro (MIT). Install Astro yourself if you want its preview command. Meldmind did not download it.\n",
      "src/pages/index.astro": `---\nconst title = ${JSON.stringify(name)};\n---\n<html lang="en">\n  <head><title>{title}</title></head>\n  <body>\n${page}\n  </body>\n</html>\n`,
    },
  };
}

export function specialCategory(text) {
  const s = String(text || "");
  if (/\b(credit|loan|mortgage|debt|apr)\b/i.test(s)) {
    return {
      id: "credit",
      warning: "Credit ads have extra rules. Do not promise a score, a rate, or a result. Put [VERIFY] on any number you cannot prove.",
    };
  }
  if (/\binsurance\b/i.test(s)) {
    return {
      id: "insurance",
      warning: "Insurance ads have extra rules. Do not promise coverage or savings you cannot prove. Put [VERIFY] on any number you cannot prove.",
    };
  }
  return null;
}

export function draftAds(brief) {
  const base = clip(brief || "Your offer", 2000);
  const platforms = {};
  for (const p of PLATFORMS) {
    platforms[p.id] = {
      label: p.label,
      fields: p.fields.map((f) => {
        const text = base.slice(0, f.limit);
        return { id: f.id, limit: f.limit, text, length: text.length, over: base.length > f.limit };
      }),
    };
  }
  return { warning: specialCategory(brief), platforms, posted: false };
}

export function draftSequence(brief, address) {
  const topic = firstLine(brief) || "A note from us";
  const postal = String(address || "").trim();
  const footer = postal ? CAN_SPAM.replace("{{postal_address}}", postal) : CAN_SPAM;
  const emails = [1, 2, 3].map((n) => ({
    n,
    subject: (n === 1 ? topic : `Follow up ${n}: ${topic}`).slice(0, 90),
    text: `${clip(brief || topic, 800)}\n\n${footer}`,
  }));
  return { emails, footer: CAN_SPAM, hasUnsubscribe: true, addressSet: postal.length >= 8 };
}

export function calendarFrom(brief) {
  const days = ["Monday", "Wednesday", "Friday"];
  const line = clip(brief || "A post", 220);
  return {
    engine: {
      name: "Postiz",
      license: "AGPL-3.0",
      separateService: true,
      linked: false,
      note: "Postiz runs as its own service. This app does not include Postiz code.",
    },
    posts: days.map((day) => ({ day, text: `${line} (${day})`.slice(0, 280), status: "draft" })),
  };
}

export function reelPlan({ brief, remotion = false, transcript = null }) {
  const on = remotion === true;
  const lines = transcript || [
    { start: 0, end: 3, text: clip(brief || "Show the offer", 180) },
    { start: 3, end: 6, text: "Close with what to do next." },
  ];
  return {
    engines: [
      { name: "WhisperX", license: "BSD-2", ran: !!transcript, note: transcript ? "Transcript came from the local helper." : "The transcript is a draft. WhisperX is not downloaded." },
      { name: "auto-editor", license: "Unlicense", ran: false, note: "The cut list is a draft. auto-editor is not downloaded." },
    ],
    remotion: {
      on,
      license: "Remotion company license",
      note: on
        ? "Remotion is on for this reel. The Remotion package is not installed."
        : "Remotion is off. Turn it on under More options only if you accept its company license.",
    },
    transcript: lines,
    cuts: lines.map((t) => ({ in: t.start, out: t.end, keep: true })),
    composition: on ? "export const Reel = () => null;\n" : null,
  };
}

export function seoPlan(html, brief) {
  const page = html || sparsePage(brief);
  const audit = auditHtml(page);
  const title = firstLine(brief).slice(0, 60) || "Home";
  const description = clip(brief || title, 155);
  const rewrites = [
    { id: "title", label: "Page title", value: title },
    { id: "meta", label: "Description", value: description },
    { id: "h1", label: "Main heading", value: title },
  ].filter((row) => audit.issues.some((i) => i.id === row.id));
  return { html: page, audit, rewrites };
}

async function readJson(res) {
  const text = await res.text();
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}

export async function publishNetlify({ base, token, html, name, confirm }) {
  if (confirm !== true) assertConfirm("Click Publish to send the site. Nothing was sent.");
  if (!token) throw bad("Add a Netlify token under More options. Nothing was sent.", 400, "needs_token");
  const root = String(base || "").replace(/\/$/, "");
  assertLoopback(`${root}/`);
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" };
  const siteRes = await localFetch(`${root}/api/v1/sites`, { method: "POST", headers, body: JSON.stringify({ name: name || "site" }) });
  const site = await readJson(siteRes);
  if (!siteRes.ok) throw bad("Netlify did not accept the site. Nothing else was sent.", 502, "publish_failed");
  const id = site.id || "site";
  const depRes = await localFetch(`${root}/api/v1/sites/${encodeURIComponent(id)}/deploys`, {
    method: "POST",
    headers,
    body: JSON.stringify({ files: { "/index.html": html || "" } }),
  });
  const dep = await readJson(depRes);
  if (!depRes.ok) throw bad("Netlify did not accept the deploy.", 502, "publish_failed");
  return { host: "netlify", sent: true, id: dep.id || null, url: dep.ssl_url || dep.url || site.ssl_url || site.url || null };
}

export async function publishVercel({ base, token, html, name, confirm }) {
  if (confirm !== true) assertConfirm("Click Publish to send the site. Nothing was sent.");
  if (!token) throw bad("Add a Vercel token under More options. Nothing was sent.", 400, "needs_token");
  const root = String(base || "").replace(/\/$/, "");
  assertLoopback(`${root}/`);
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" };
  const res = await localFetch(`${root}/v13/deployments`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: name || "site", files: [{ file: "index.html", data: html || "" }] }),
  });
  const body = await readJson(res);
  if (!res.ok) throw bad("Vercel did not accept the deploy.", 502, "publish_failed");
  return { host: "vercel", sent: true, id: body.id || null, url: body.url ? `https://${body.url}` : null };
}

export async function sendPostiz({ base, token, posts, confirm }) {
  if (confirm !== true) assertConfirm("Click Send to add these posts. Nothing was sent.");
  if (!base) throw bad("Add the Postiz address under More options. Postiz stays a separate service. Nothing was sent.", 400, "needs_service");
  if (!token) throw bad("Add a Postiz token under More options. Nothing was sent.", 400, "needs_token");
  const root = cleanBase(base);
  assertLoopback(`${root}/`);
  const res = await localFetch(`${root}/api/public/v1/posts`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ posts: (posts || []).map((p) => ({ text: p.text, day: p.day })) }),
  });
  const body = await readJson(res);
  if (!res.ok) throw bad("Postiz did not accept the posts. Nothing else was sent.", 502, "publish_failed");
  return { host: "postiz", sent: true, id: body.id || null };
}

export async function sendListmonk({ base, token, emails, confirm }) {
  if (confirm !== true) assertConfirm("Click Send to deliver this series. Nothing was sent.");
  if (!base) throw bad("Add the listmonk address under More options. Nothing was sent.", 400, "needs_service");
  if (!token) throw bad("Add a listmonk token under More options. Nothing was sent.", 400, "needs_token");
  const root = cleanBase(base);
  assertLoopback(`${root}/`);
  const res = await localFetch(`${root}/api/campaigns`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ name: emails?.[0]?.subject || "Series", body: emails }),
  });
  if (!res.ok) throw bad("listmonk did not accept the series. Nothing else was sent.", 502, "publish_failed");
  const body = await readJson(res);
  return { host: "listmonk", sent: true, id: body.id || null };
}

export async function sendHighlevel({ base, token, emails, confirm }) {
  if (confirm !== true) assertConfirm("Click Send to deliver this series. Nothing was sent.");
  if (!token) throw bad("Add a HighLevel token under More options. Nothing was sent.", 400, "needs_token");
  const root = String(base || "").replace(/\/$/, "");
  assertLoopback(`${root}/`);
  const res = await localFetch(`${root}/marketing/emails`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json", Version: "2021-07-28" },
    body: JSON.stringify({ emails }),
  });
  if (!res.ok) throw bad("HighLevel did not accept the series. Nothing else was sent.", 502, "publish_failed");
  const body = await readJson(res);
  return { host: "highlevel", sent: true, id: body.id || null };
}

export function assertCanSendEmail({ confirm, address }) {
  if (confirm !== true) assertConfirm("Click Send to deliver this series. Nothing was sent.");
  if (!address || String(address).trim().length < 8) {
    throw bad("Add a postal address first. Marketing email has to include one. Nothing was sent.", 400, "canspam");
  }
}

export async function fetchTranscript(url, brief) {
  if (!url) return null;
  assertLoopback(url);
  const res = await localFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ brief: clip(brief, 500) }),
  });
  if (!res.ok) return null;
  const body = await readJson(res);
  if (!Array.isArray(body.transcript)) return null;
  return body.transcript
    .filter((row) => row && typeof row.text === "string")
    .slice(0, 12)
    .map((row) => ({ start: Number(row.start) || 0, end: Number(row.end) || 0, text: clip(row.text, 180) }));
}
