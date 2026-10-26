// A real PDF for document tasks (0.4.21, dogfood 07).
// The deliverable is cut down to the document that was asked for, turned into a Letter page, rendered to a PDF
// inside the app, its pages counted, and saved next to a .md copy in the project folder. Nobody is ever handed a
// script to run. Nothing is sent anywhere.
//
// Engines, first one that works wins:
//   1. Electron's own print-to-PDF (globalThis.__ccPdfRenderer, set by electron/main.cjs)
//   2. Chrome or Edge on this computer, driven by playwright-core (headless, nothing visible)
//   3. the small pure-JS writer in doc-export.js (text layout, no HTML styling)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { toPdf, pdfPageCount } from "./doc-export.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---- what was asked for -------------------------------------------------------------------------------------
const PDF_NAME_RE = /\b([A-Za-z0-9][\w-]{0,60})\.pdf\b/i;
const ONE_PAGE_RE = /\b(?:one|1|single)[\s-]*(?:page|pager)\b|\bone-?pager\b/i;
const N_PAGE_RE = /\b(two|three|four|five|2|3|4|5)[\s-]*pages?\b/i;
const NUM = { two: 2, three: 3, four: 4, five: 5 };

// Does the task ask for a PDF file? "make a one-page PDF", "save as everborn-onepager.pdf"
export function wantsPdf(goal) {
  const g = String(goal || "");
  if (PDF_NAME_RE.test(g)) return true;
  return /\bpdf\b/i.test(g) && !/\b(explain|what is|what are|how (?:do|does|can|to)|why|tell me about|summari[sz]e (?:this|the) pdf|read (?:this|the) pdf)\b/i.test(g);
}

// "everborn-onepager.pdf" if the task names it, else a name made from the task. Never random, never .tmp.
export function pdfFileName(goal, title = "") {
  const m = PDF_NAME_RE.exec(String(goal || ""));
  if (m) return `${m[1].toLowerCase()}.pdf`;
  return `${slug(title || goal)}.pdf`;
}
export function slug(s) {
  const t = String(s || "document").toLowerCase().replace(/\b(please|make|create|write|build|a|an|the|me|for|that|this|pdf|letter[- ]size|one[- ]page)\b/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return t || "document";
}
// null when the task did not ask for a page limit
export function pageLimit(goal) {
  const g = String(goal || "");
  if (ONE_PAGE_RE.test(g) || /\b(?:single|1)[\s-]*sheet\b/i.test(g)) return 1;
  const m = N_PAGE_RE.exec(g);
  if (m) return NUM[m[1].toLowerCase()] || Number(m[1]);
  return null;
}

// ---- a step that says it could not do the job -----------------------------------------------------------------
const CANT_RE = /\bI(?:\s+(?:can(?:'|’)?t|cannot|can not|am unable|am not able|do(?: not|n'?t) have (?:a |the )?(?:way|ability|tool|access|renderer))|(?:'|’)m (?:unable|not able))\b[^.\n]{0,60}\b(?:run|render|create|generate|produce|make|export|save|write|open|convert|execute)\b|\b(?:no|without a) (?:pdf )?renderer\b|\b(?:run|execute) (?:this|the (?:following|script|code|command)|these)\b[^.\n]{0,40}\b(?:script|code|command|python|node|on your (?:computer|machine|pc))|\byou(?:'ll| will| can| need to| should)[^.\n]{0,30}\b(?:run|execute)\b[^.\n]{0,40}\b(?:script|python|command|code)|\bsave (?:it |this )?as [\w.-]+ and (?:run|open|print)|\bpython\b[^.\n]{0,25}\bscript\b[^.\n]{0,30}\b(?:below|to (?:run|generate|create|make))/i;
export function saysCouldNot(text) {
  return CANT_RE.test(String(text || ""));
}

// ---- cutting the answer down to the document ----------------------------------------------------------------------
const SCRIPT_LANGS = new Set(["python", "py", "bash", "sh", "shell", "zsh", "powershell", "ps1", "cmd", "bat", "js", "javascript", "node", "ts", "typescript", "ruby", "php"]);
const META_HEAD = /^(?:qa|quality|review(?:er)?s?|checks?|notes?(?: to you| for you| on (?:the )?(?:run|steps?))?|how to (?:use|run|render|print|save)|instructions|run (?:this|it)|render(?:ing)? (?:notes|steps)|final files?|files? (?:saved|created|ready)|saved files?|what i (?:did|changed)|next steps|summary of (?:the )?(?:steps|work)|handoff|hand-off|script)\b/i;
const CHAT_LEAD = /^(?:here(?:'s| is| are)|sure|certainly|below is|great|okay|ok|absolutely|of course)\b/i;

export function stripScripts(markdown) {
  return String(markdown || "").replace(/```([A-Za-z0-9+#-]*)[^\n]*\n[\s\S]*?```/g, (all, lang) => (SCRIPT_LANGS.has(String(lang).toLowerCase()) ? "" : all));
}
function firstHtmlDocument(text) {
  const t = String(text || "");
  const fenced = /```html?[^\n]*\n([\s\S]*?)```/i.exec(t);
  if (fenced && /<(?:html|body|h1|h2|p|div|section|ul)\b/i.test(fenced[1])) return fenced[1].trim();
  const m = /(<!doctype html[\s\S]*?<\/html\s*>|<html[\s\S]*?<\/html\s*>)/i.exec(t);
  if (m) return m[1].trim();
  return "";
}
export function safeHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script[\s\S]*$/gi, "")
    .replace(/<(?:iframe|object|embed|link|meta)[^>]*>/gi, "")
    .replace(/\s(?:on\w+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

// The document, as { html?, markdown, from }. Prefers a full HTML page a step wrote; otherwise the answer's text
// with the run notes, scripts and chat lead-ins taken out.
export function extractDocument({ deliverable = "", tasks = [], goal = "" } = {}) {
  const fromTasks = [...(tasks || [])].reverse().map((t) => (t && t.status !== "failed" ? firstHtmlDocument(t.output) : "")).find(Boolean) || "";
  const html = firstHtmlDocument(deliverable) || fromTasks;
  if (html) return { html: safeHtml(html), markdown: htmlToMarkdown(html), from: "html" };
  let md = stripScripts(deliverable).replace(/\r\n/g, "\n");
  // an answer built from steps is "## Step title" sections: keep the ones that are the document
  const parts = md.split(/\n(?=##\s)/);
  if (parts.length > 1) {
    const keep = parts.filter((p, i) => {
      const head = /^##\s+(.+)/.exec(p)?.[1] || "";
      if (!head) return true;
      if (META_HEAD.test(head.trim())) return false;
      if (saysCouldNot(p) && p.length < 1200) return false;
      return true;
    });
    if (keep.length) md = keep.join("\n");
  }
  // a "## Step title" line is the app's own wrapper, not part of the document: drop task titles and any ## right above a # title
  const titles = new Set((tasks || []).map((t) => String(t?.title || "").trim().toLowerCase()).filter(Boolean));
  md = md.replace(/^##\s+(.+)\n+(?=# )/gm, "").split("\n").filter((l) => { const m = /^##\s+(.+?)(?:\s*\(.*\))?\s*$/.exec(l); return !(m && titles.has(m[1].trim().toLowerCase())); }).join("\n");
  md = md.split("\n").filter((l) => !(saysCouldNot(l) && l.length < 400)).join("\n");
  const lines = md.split("\n");
  while (lines.length && (!lines[0].trim() || (CHAT_LEAD.test(lines[0].trim()) && /[:.!]$/.test(lines[0].trim()) && lines[0].length < 160))) lines.shift();
  while (lines.length && (!lines[lines.length - 1].trim() || /^\s*(?:---|\*\*\*|___)\s*$/.test(lines[lines.length - 1]))) lines.pop();
  md = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  // a lone wrapping ```markdown fence
  const wrapped = /^```(?:markdown|md)?\n([\s\S]*?)\n```$/.exec(md);
  if (wrapped) md = wrapped[1].trim();
  return { html: "", markdown: md, from: "text" };
}

export function htmlToMarkdown(html) {
  let t = String(html || "").replace(/<(?:script|style|head)[\s\S]*?<\/(?:script|style|head)>/gi, "");
  t = t.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n").replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n").replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<(?:b|strong)[^>]*>([\s\S]*?)<\/(?:b|strong)>/gi, "**$1**").replace(/<(?:i|em)[^>]*>([\s\S]*?)<\/(?:i|em)>/gi, "*$1*")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:p|div|section|ul|ol|tr|table|header|footer)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return t.split("\n").map((l) => l.replace(/\s+$/g, "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ---- markdown to HTML (no raw # or ** reaches the page) ------------------------------------------------------------
function inline(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/__([^_]+)__/g, "<b>$1</b>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<i>$2</i>").replace(/(^|[^_\w])_([^_\s][^_]*?)_(?![_\w])/g, "$1<i>$2</i>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, "<span class=\"lnk\">$1</span>");
  return t;
}
export function markdownToHtml(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^```/.test(line)) { const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; out.push(`<pre>${esc(buf.join("\n"))}</pre>`); continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { const n = Math.min(h[1].length, 4); out.push(`<h${n}>${inline(h[2].replace(/\s*#+\s*$/, ""))}</h${n}>`); i++; continue; }
    if (/^\s*(?:---|\*\*\*|___)\s*$/.test(line)) { out.push("<hr>"); i++; continue; }
    if (/^>\s?/.test(line)) { const buf = []; while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, "")); out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`); continue; }
    if (/^\s*[-*+•]\s+/.test(line)) { const li = []; while (i < lines.length && /^\s*[-*+•]\s+/.test(lines[i])) li.push(`<li>${inline(lines[i++].replace(/^\s*[-*+•]\s+/, ""))}</li>`); out.push(`<ul>${li.join("")}</ul>`); continue; }
    if (/^\s*\d+[.)]\s+/.test(line)) { const li = []; while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) li.push(`<li>${inline(lines[i++].replace(/^\s*\d+[.)]\s+/, ""))}</li>`); out.push(`<ol>${li.join("")}</ol>`); continue; }
    if (/^\|.*\|\s*$/.test(line) && /^\|?\s*:?-{2,}/.test(lines[i + 1] || "")) {
      const cells = (l) => l.replace(/^\||\|\s*$/g, "").split("|").map((c) => c.trim());
      const head = cells(line); i += 2; const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    const para = [line]; i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*[-*+•]\s|\s*\d+[.)]\s|```|>|\|)/.test(lines[i])) para.push(lines[i++]);
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return out.join("\n");
}

// A Letter page. `zoom` shrinks the page content so a one-pager can be made to fit.
export function pageHtml({ title = "", body = "", full = "", zoom = 1 } = {}) {
  const css = `@page{size:Letter;margin:0.6in}*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:Georgia,"Times New Roman",serif;color:#1b1f24;font-size:11pt;line-height:1.4;zoom:${zoom}}h1{font-size:22pt;margin:0 0 6pt;line-height:1.15}h2{font-size:14pt;margin:14pt 0 4pt;color:#12355b}h3{font-size:12pt;margin:10pt 0 3pt}h4{font-size:11pt;margin:8pt 0 2pt}p{margin:0 0 7pt}ul,ol{margin:0 0 7pt;padding-left:18pt}li{margin:0 0 3pt}hr{border:0;border-top:1px solid #c9d2dc;margin:10pt 0}blockquote{margin:6pt 0;padding-left:10pt;border-left:3px solid #c9d2dc;color:#3b4652}code,pre{font-family:Consolas,"Courier New",monospace;font-size:9.5pt;background:#f1f4f7}pre{padding:6pt;white-space:pre-wrap}table{border-collapse:collapse;width:100%;margin:0 0 8pt}th,td{border:1px solid #c9d2dc;padding:3pt 5pt;text-align:left;font-size:10pt}`;
  if (full) {
    // a full page a step wrote: keep its styling, add the Letter page rule and the zoom
    const extra = `<style>@page{size:Letter;margin:0.5in}body{zoom:${zoom}}</style>`;
    if (/<\/head>/i.test(full)) return full.replace(/<\/head>/i, `${extra}</head>`);
    if (/<html[\s>]/i.test(full)) return full.replace(/<html[^>]*>/i, (m) => `${m}<head><meta charset="utf-8">${extra}</head>`);
    return `<!doctype html><html><head><meta charset="utf-8">${extra}</head><body>${full}</body></html>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body>${body}</body></html>`;
}

// ---- engines ------------------------------------------------------------------------------------------------------
export function countPages(buf) {
  const text = Buffer.from(buf).toString("latin1");
  const leaf = (text.match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
  if (leaf) return leaf;
  const m = /\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/.exec(text) || /\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages/.exec(text);
  return m ? Number(m[1]) : pdfPageCount(Buffer.from(buf));
}

function chromeCandidates() {
  const env = process.env.CC_PDF_CHROME;
  const list = env ? [env] : [];
  if (process.platform === "win32") {
    for (const base of [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, process.env.LOCALAPPDATA]) {
      if (!base) continue;
      list.push(path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"), path.join(base, "Google", "Chrome", "Application", "chrome.exe"));
    }
  } else if (process.platform === "darwin") {
    list.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge");
  } else {
    list.push("/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge");
  }
  return list.filter((f) => { try { return fs.existsSync(f); } catch { return false; } });
}

// hooks for tests: { electron(html) -> Buffer, chrome(html) -> Buffer }
export const hooks = {};

async function viaElectron(html) {
  const fn = hooks.electron || globalThis.__ccPdfRenderer;
  if (typeof fn !== "function") return null;
  const buf = await fn(html);
  return buf && buf.length > 8 ? Buffer.from(buf) : null;
}
async function viaChrome(html) {
  if (hooks.chrome) return Buffer.from(await hooks.chrome(html));
  const exe = chromeCandidates()[0];
  if (!exe) return null;
  let chromium;
  try { ({ chromium } = await import("playwright-core")); } catch { return null; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-pdf-"));
  const file = path.join(dir, "page.html");
  fs.writeFileSync(file, html, "utf8");
  let browser;
  try {
    browser = await chromium.launch({ executablePath: exe, headless: true, args: ["--no-sandbox", "--disable-gpu", "--no-first-run"] });
    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.goto(`file://${file.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "/$1:")}`, { waitUntil: "load", timeout: 20000 });
    return Buffer.from(await page.pdf({ format: "Letter", printBackground: true, preferCSSPageSize: true }));
  } catch { return null; }
  finally {
    try { await browser?.close(); } catch { /* gone */ }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp folder */ }
  }
}

function asciiForBuiltin(md) {
  return String(md).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, " - ").replace(/…/g, "...").replace(/[•●]/g, "-").replace(/ /g, " ");
}

/**
 * Render the document. Returns { ok, buf, pages, engine, limit, fits, zoom, warning }.
 * With a page limit the content is shrunk step by step (down to 70 percent) until it fits.
 */
export async function renderDocumentPdf({ title = "", markdown = "", html = "", limit = null } = {}) {
  const force = process.env.CC_PDF_ENGINE || "";
  const body = html ? "" : markdownToHtml(markdown);
  const zooms = limit ? [1, 0.92, 0.85, 0.78, 0.7] : [1];
  let last = null;
  if (force !== "builtin") {
    for (const engine of ["electron", "chrome"]) {
      if (force && force !== engine) continue;
      for (const zoom of zooms) {
        let buf = null;
        try { buf = engine === "electron" ? await viaElectron(pageHtml({ title, body, full: html, zoom })) : await viaChrome(pageHtml({ title, body, full: html, zoom })); } catch { buf = null; }
        if (!buf) break;
        const pages = countPages(buf);
        last = { ok: true, buf, pages, engine, limit, zoom };
        if (!limit || pages <= limit) break;
      }
      if (last) break;
    }
  }
  if (!last) {
    const buf = toPdf({ title: "", markdown: asciiForBuiltin(markdown || htmlToMarkdown(html)) });
    last = { ok: true, buf, pages: countPages(buf), engine: "builtin", limit, zoom: 1 };
  }
  last.fits = !limit || last.pages <= limit;
  if (!last.fits) last.warning = `This came out at ${last.pages} pages, but you asked for ${limit === 1 ? "one page" : `${limit} pages`}. Shorten the text and try again.`;
  return last;
}

// ---- save into the project -----------------------------------------------------------------------------------------
function uniquePath(dir, name) {
  const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
  let file = path.join(dir, name);
  for (let n = 2; fs.existsSync(file) && n < 200; n++) file = path.join(dir, `${base}-${n}${ext}`);
  return file;
}

/**
 * Make the document from a finished run and save the .pdf and the .md in the project's folder.
 * Returns { ok, pdf: {name,path,bytes,pages}, md: {name,path}, engine, warning } or { ok:false, error }.
 * `deps` lets tests and callers supply the folder and the MindMedia saver.
 */
export async function makeAndSavePdf({ goal = "", title = "", deliverable = "", tasks = [], projectId = "", missionId = "", name = "", source = "Mission" } = {}, deps = {}) {
  const doc = extractDocument({ deliverable, tasks, goal });
  if (!doc.markdown.trim() && !doc.html) return { ok: false, error: "Not saved: there was no document text to put in a PDF." };
  if (!doc.html && title && !/^#{1,2}\s/m.test(doc.markdown)) doc.markdown = `# ${String(title).replace(/\s+/g, " ").trim()}\n\n${doc.markdown}`;
  const want = name || pdfFileName(goal, title);
  const limit = pageLimit(goal);
  let r;
  try { r = await renderDocumentPdf({ title, markdown: doc.markdown, html: doc.html, limit }); }
  catch (e) { return { ok: false, error: `Not saved: the PDF could not be made (${String(e.message || e).slice(0, 120)}).` }; }
  const mediaDir = deps.projectMediaDir || (await import("./media-jobs.js")).projectMediaDir;
  const saver = deps.saveToMindMedia || (await import("./project-media.js")).saveToMindMedia;
  const pid = String(projectId || "") || "unfiled";
  try {
    const dir = mediaDir(pid);
    fs.mkdirSync(dir, { recursive: true });
    const pdfFile = uniquePath(dir, path.basename(want));
    const mdFile = path.join(dir, path.basename(pdfFile).replace(/\.pdf$/i, ".md"));
    fs.writeFileSync(pdfFile, r.buf);
    fs.writeFileSync(mdFile, doc.markdown.trim() + "\n", "utf8");
    if (fs.readFileSync(pdfFile).subarray(0, 4).toString("latin1") !== "%PDF") return { ok: false, error: `Not saved: ${path.basename(pdfFile)} did not read back as a PDF.` };
    let saved = null;
    try { saved = saver({ files: [{ name: path.basename(pdfFile), path: pdfFile }, { name: path.basename(mdFile), path: mdFile }], projectId: pid, source, status: "Draft", dedupeKey: missionId ? `pdf:${missionId}:${path.basename(pdfFile)}` : undefined }); } catch { /* the files exist; the MindMedia item is a bonus */ }
    return {
      ok: true, engine: r.engine, warning: r.warning || "", fits: r.fits, limit,
      pdf: { name: path.basename(pdfFile), path: pdfFile, bytes: r.buf.length, pages: r.pages },
      md: { name: path.basename(mdFile), path: mdFile },
      projectId: pid, assetId: saved?.items?.[0]?.id || null, where: saved?.where || null,
    };
  } catch (e) {
    return { ok: false, error: `Not saved: ${String(e.message || e).slice(0, 160)}` };
  }
}

// One plain sentence about what was and was not saved
export function savedLine(r) {
  if (!r) return "";
  if (!r.ok) return String(r.error || "Not saved.");
  const pages = r.pdf.pages === 1 ? "1 page" : `${r.pdf.pages} pages`;
  return `Saved ${r.pdf.name} (${pages}) and ${r.md.name} in the project folder: ${path.dirname(r.pdf.path)}.${r.warning ? ` ${r.warning}` : ""}`;
}
