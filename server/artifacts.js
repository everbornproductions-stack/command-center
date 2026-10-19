// Artifacts side panel (Phase 20): generated HTML / JS, SVG, charts, Markdown, mini apps and Python, kept
// with every version, rendered in a sandboxed frame and exported as a file.
//
//  - Storage: one per-user document "artifacts" (local: data folder; hosted: the user's own rows). Each
//    artifact keeps all its versions; an edit always adds a version, an old one is never overwritten.
//  - Sandbox: the web panel puts frameHtml() into <iframe sandbox="allow-scripts" srcdoc>. No
//    allow-same-origin, so the frame has an opaque origin: it cannot read the app page (or its session
//    token), and anything it sends to the local server carries "Origin: null", which the server refuses
//    (403). On top of that the frame's own Content-Security-Policy blocks every network request
//    (connect-src 'none'). "Allow internet" per artifact opens https: only (CDN scripts, images), never
//    http:, so the loopback API stays out of reach either way.
//  - Python runs through Pyodide in a Web Worker started inside the frame, loaded only when a Python
//    artifact is run (lazy). The runner is PY_RUNNER below; the tests run the same function in Node.
//  - Nothing here calls an AI, spends or sends anything.
import crypto from "node:crypto";
import { doc, putDoc } from "./store.js";

export const DOC = "artifacts";
export const KINDS = ["html", "svg", "markdown", "chart", "js", "python"];
export const MAX_CONTENT = 400_000, MAX_VERSIONS = 50, MAX_ARTIFACTS = 300, MAX_TITLE = 120;
export const PYODIDE_DEFAULT = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
const EXT = { html: "html", svg: "svg", markdown: "md", chart: "svg", js: "js", python: "py" };
const MIME = { html: "text/html; charset=utf-8", svg: "image/svg+xml", markdown: "text/markdown; charset=utf-8", chart: "image/svg+xml", js: "text/javascript; charset=utf-8", python: "text/x-python; charset=utf-8" };

const bad = (msg, status = 400, code) => Object.assign(new Error(msg), { status, code });
const now = () => new Date().toISOString();
const newId = () => "art_" + crypto.randomBytes(6).toString("hex");
const store = () => doc(DOC, () => ({ items: [] }));
const save = (d) => putDoc(DOC, d);
const escAttr = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]);
const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function cleanKind(k) {
  const v = String(k || "").toLowerCase().trim();
  const alias = { htm: "html", md: "markdown", javascript: "js", py: "python", json: "chart" };
  const kind = alias[v] || v;
  if (!KINDS.includes(kind)) throw bad(`Unknown artifact kind "${k}". Use one of: ${KINDS.join(", ")}.`);
  return kind;
}
function cleanContent(kind, c) {
  const s = typeof c === "string" ? c : kind === "chart" && c && typeof c === "object" ? JSON.stringify(c, null, 2) : "";
  if (!s.trim()) throw bad("The artifact is empty.");
  if (s.length > MAX_CONTENT) throw bad(`The artifact is too large (${Math.round(s.length / 1000)} KB, the limit is ${MAX_CONTENT / 1000} KB).`);
  if (kind === "chart") parseChart(s); // throws a clear 400 when the spec is unusable
  return s;
}
const cleanTitle = (t, kind) => String(t || "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE) || `${kind === "js" ? "Script" : kind[0].toUpperCase() + kind.slice(1)} artifact`;

const summary = (a) => ({ id: a.id, title: a.title, kind: a.kind, projectId: a.projectId || null, runId: a.runId || null, net: !!a.net, versions: a.versions.length, latest: a.versions.length, created: a.created, updated: a.updated });

export function listArtifacts({ projectId, runId } = {}) {
  return store().items.filter((a) => (!projectId || a.projectId === projectId) && (!runId || a.runId === runId)).map(summary).sort((a, b) => (a.updated < b.updated ? 1 : -1));
}
export function getArtifact(id) {
  const a = store().items.find((x) => x.id === id);
  if (!a) throw bad("No such artifact.", 404);
  return a;
}
export function pickVersion(a, v) {
  if (v === undefined || v === null || v === "" || v === "latest") return a.versions[a.versions.length - 1];
  const n = Number(v), ver = a.versions.find((x) => x.v === n);
  if (!ver) throw bad(`Version ${v} does not exist (this artifact has ${a.versions.length}).`, 404);
  return ver;
}

export function createArtifact({ title, kind, content, projectId, runId, net, source } = {}) {
  const k = cleanKind(kind), body = cleanContent(k, content);
  const d = store();
  if (d.items.length >= MAX_ARTIFACTS) throw bad(`You have ${MAX_ARTIFACTS} artifacts. Delete a few to make room.`, 409);
  const t = now();
  const a = { id: newId(), title: cleanTitle(title, k), kind: k, projectId: projectId ? String(projectId) : null, runId: runId ? String(runId) : null, net: !!net, source: source ? String(source).slice(0, 40) : "manual", created: t, updated: t, versions: [{ v: 1, content: body, at: t, note: "first version" }] };
  d.items.push(a); save(d);
  return a;
}

// An edit is always a new version; earlier versions stay exactly as they were.
export function addVersion(id, { content, note, title, net } = {}) {
  const d = store(), a = d.items.find((x) => x.id === id);
  if (!a) throw bad("No such artifact.", 404);
  const last = a.versions[a.versions.length - 1];
  const body = content === undefined ? last.content : cleanContent(a.kind, content);
  if (body === last.content && title === undefined && net === undefined) throw bad("Nothing changed, so no new version was made.");
  if (body !== last.content) {
    const v = last.v + 1;
    a.versions.push({ v, content: body, at: now(), note: String(note || `edit ${v}`).slice(0, 200) });
    if (a.versions.length > MAX_VERSIONS) a.versions.splice(1, a.versions.length - MAX_VERSIONS); // keep version 1 and the newest
  }
  if (title !== undefined) a.title = cleanTitle(title, a.kind);
  if (net !== undefined) a.net = !!net;
  a.updated = now(); save(d);
  return a;
}

export function deleteArtifact(id) {
  const d = store(), i = d.items.findIndex((x) => x.id === id);
  if (i < 0) throw bad("No such artifact.", 404);
  d.items.splice(i, 1); save(d);
  return { ok: true };
}

// ---------------- finding artifacts in an AI answer ----------------
const FENCE = /```([\w+-]*)[^\n]*\n([\s\S]*?)```/g;
function kindForFence(lang, body) {
  const l = lang.toLowerCase();
  if (["html", "htm"].includes(l)) return "html";
  if (l === "svg" || (l === "xml" && /^\s*<svg[\s>]/i.test(body))) return "svg";
  if (["markdown", "md"].includes(l)) return "markdown";
  if (l === "chart") return "chart";
  if (l === "json") { try { parseChart(body); return "chart"; } catch { return null; } }
  if (["js", "javascript"].includes(l)) return "js";
  if (["python", "py"].includes(l)) return "python";
  if (!l && /^\s*(<!doctype html|<html[\s>])/i.test(body)) return "html";
  if (!l && /^\s*<svg[\s>]/i.test(body)) return "svg";
  return null;
}
function titleFor(kind, body, before, n) {
  if (kind === "html") { const m = body.match(/<title>([^<]{1,120})<\/title>/i) || body.match(/<h1[^>]*>([^<]{1,120})<\/h1>/i); if (m) return m[1].trim(); }
  if (kind === "chart") { try { const c = parseChart(body); if (c.title) return c.title; } catch {} }
  if (kind === "markdown") { const m = body.match(/^#{1,3} (.+)$/m); if (m) return m[1].trim(); }
  const h = [...before.matchAll(/^#{1,4} (.+)$/gm)].pop();
  if (h) return h[1].replace(/[*`]/g, "").trim();
  return `${cleanTitle("", kind)} ${n}`;
}
// Returns [{ kind, title, content }] for every block worth keeping, in order.
export function findArtifacts(text) {
  const out = [], src = String(text || "");
  let m, n = 0;
  FENCE.lastIndex = 0;
  while ((m = FENCE.exec(src))) {
    const body = m[2].replace(/\s+$/, "");
    const kind = kindForFence(m[1] || "", body);
    if (!kind || body.trim().length < 12) continue;
    n++;
    out.push({ kind, title: titleFor(kind, body, src.slice(0, m.index), n), content: body });
  }
  return out;
}
// Save every artifact found in a deliverable. A block already saved for the same run is not added twice.
export function extractArtifacts({ text, projectId, runId } = {}) {
  const found = findArtifacts(text);
  const items = store().items;
  const out = [];
  for (const f of found) {
    const dup = runId && items.find((a) => a.runId === runId && a.kind === f.kind && a.versions[0].content === f.content);
    out.push(dup || createArtifact({ ...f, projectId, runId, source: "deliverable" }));
  }
  return out;
}

// ---------------- charts: a small JSON spec drawn as SVG ----------------
// { "type": "bar" | "line" | "pie", "title": "...", "labels": ["Jan", ...], "series": [{ "name": "...", "values": [1, 2] }] }
// "data": [{ "label": "Jan", "value": 3 }] is accepted as a one-series shortcut.
export function parseChart(src) {
  let c;
  try { c = typeof src === "string" ? JSON.parse(src) : src; } catch { throw bad("The chart is not valid JSON."); }
  if (!c || typeof c !== "object") throw bad("The chart must be a JSON object.");
  if (Array.isArray(c.data) && !c.series) { c = { ...c, labels: c.data.map((d) => d.label ?? d.name ?? ""), series: [{ name: c.title || "value", values: c.data.map((d) => d.value) }] }; }
  const type = String(c.type || "bar").toLowerCase();
  if (!["bar", "line", "pie"].includes(type)) throw bad(`Chart type "${c.type}" is not supported. Use bar, line or pie.`);
  if (!Array.isArray(c.labels) || !c.labels.length || !Array.isArray(c.series) || !c.series.length) throw bad("A chart needs \"labels\" and \"series\" (or \"data\").");
  const series = c.series.slice(0, 8).map((s, i) => ({ name: String(s?.name ?? `Series ${i + 1}`), values: c.labels.map((_, j) => { const v = Number(s?.values?.[j]); return Number.isFinite(v) ? v : 0; }) }));
  return { type, title: c.title ? String(c.title).slice(0, MAX_TITLE) : "", labels: c.labels.slice(0, 60).map(String), series };
}
const PALETTE = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#a855f7", "#84cc16", "#ec4899"];
const fmt = (n) => (Math.abs(n) >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : String(Math.round(n * 100) / 100));
export function chartSvg(src) {
  const c = parseChart(src);
  const W = 720, H = 400, L = 56, R = 16, T = c.title ? 44 : 20, B = 64;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui, sans-serif" font-size="12"><rect width="${W}" height="${H}" fill="#fff"/>`];
  if (c.title) parts.push(`<text x="${W / 2}" y="26" text-anchor="middle" font-size="16" font-weight="600" fill="#111">${escHtml(c.title)}</text>`);
  const legend = () => c.series.map((s, i) => `<rect x="${L + i * 130}" y="${H - 22}" width="10" height="10" fill="${PALETTE[i % 8]}"/><text x="${L + i * 130 + 14}" y="${H - 13}" fill="#333">${escHtml(s.name.slice(0, 18))}</text>`).join("");
  if (c.type === "pie") {
    const vals = c.series[0].values.map((v) => Math.max(0, v)), total = vals.reduce((a, b) => a + b, 0) || 1;
    const cx = W / 2 - 100, cy = (T + H - B) / 2 + 10, r = Math.min(W, H - T - B) / 2;
    let a0 = -Math.PI / 2;
    vals.forEach((v, i) => {
      const a1 = a0 + (v / total) * Math.PI * 2, large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a) => `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
      parts.push(v >= total ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${PALETTE[i % 8]}"/>` : `<path d="M${cx},${cy} L${p(a0)} A${r},${r} 0 ${large} 1 ${p(a1)} Z" fill="${PALETTE[i % 8]}" stroke="#fff"/>`);
      parts.push(`<rect x="${cx + r + 40}" y="${T + i * 20}" width="10" height="10" fill="${PALETTE[i % 8]}"/><text x="${cx + r + 56}" y="${T + i * 20 + 9}" fill="#333">${escHtml(c.labels[i].slice(0, 24))} (${fmt(v)}, ${Math.round((v / total) * 100)}%)</text>`);
      a0 = a1;
    });
  } else {
    const all = c.series.flatMap((s) => s.values), max = Math.max(0, ...all), min = Math.min(0, ...all), span = max - min || 1;
    const pw = W - L - R, ph = H - T - B, y = (v) => T + ph - ((v - min) / span) * ph;
    for (let k = 0; k <= 4; k++) { const v = min + (span * k) / 4; parts.push(`<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#e5e7eb"/><text x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" fill="#666">${fmt(v)}</text>`); }
    const n = c.labels.length, slot = pw / n;
    c.labels.forEach((lb, j) => parts.push(`<text x="${(L + slot * j + slot / 2).toFixed(1)}" y="${T + ph + 16}" text-anchor="middle" fill="#444">${escHtml(lb.slice(0, 12))}</text>`));
    if (c.type === "bar") {
      const bw = (slot * 0.8) / c.series.length;
      c.series.forEach((s, i) => s.values.forEach((v, j) => { const x = L + slot * j + slot * 0.1 + bw * i, y0 = y(Math.max(0, v)), h = Math.abs(y(v) - y(0)); parts.push(`<rect x="${x.toFixed(1)}" y="${y0.toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}" fill="${PALETTE[i % 8]}"><title>${escHtml(s.name)}: ${fmt(v)}</title></rect>`); }));
    } else {
      c.series.forEach((s, i) => { const pts = s.values.map((v, j) => `${(L + slot * j + slot / 2).toFixed(1)},${y(v).toFixed(1)}`); parts.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${PALETTE[i % 8]}" stroke-width="2.5"/>` + pts.map((p, j) => `<circle cx="${p.split(",")[0]}" cy="${p.split(",")[1]}" r="3.5" fill="${PALETTE[i % 8]}"><title>${escHtml(s.name)}: ${fmt(s.values[j])}</title></circle>`).join("")); });
    }
    parts.push(legend());
  }
  parts.push("</svg>");
  return parts.join("");
}

// ---------------- Markdown (escaped first, then a few safe transforms) ----------------
export function markdownHtml(src) {
  let s = escHtml(src);
  const blocks = [];
  s = s.replace(/```[\w-]*\n([\s\S]*?)```/g, (m, c) => { blocks.push(`<pre><code>${c}</code></pre>`); return `\u0000${blocks.length - 1}\u0000`; });
  s = s.replace(/^(\|.+\|)\n(\|[\s:|-]+\|)\n((?:\|.*\|\n?)*)/gm, (m, h, sep, rows) => {
    const cells = (r) => r.split("|").slice(1, -1).map((c) => c.trim());
    return `<table><thead><tr>${cells(h).map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rows.trim().split("\n").map((r) => `<tr>${cells(r).map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>\n`;
  });
  s = s.replace(/^### (.*)$/gm, "<h3>$1</h3>").replace(/^## (.*)$/gm, "<h2>$1</h2>").replace(/^# (.*)$/gm, "<h1>$1</h1>");
  s = s.replace(/^&gt; (.*)$/gm, "<blockquote>$1</blockquote>");
  s = s.replace(/^(?:[-*] .*(?:\n|$))+/gm, (m) => `<ul>${m.trim().split("\n").map((l) => `<li>${l.replace(/^[-*] /, "")}</li>`).join("")}</ul>\n`);
  s = s.replace(/^(?:\d+\. .*(?:\n|$))+/gm, (m) => `<ol>${m.trim().split("\n").map((l) => `<li>${l.replace(/^\d+\. /, "")}</li>`).join("")}</ol>\n`);
  s = s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>").replace(/`([^`\n]+)`/g, "<code>$1</code>");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.split(/\n{2,}/).map((p) => (/^\s*<(h\d|ul|ol|table|pre|blockquote)|\u0000/.test(p) ? p : `<p>${p.replace(/\n/g, "<br>")}</p>`)).join("\n");
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => blocks[i]);
}

// ---------------- the sandboxed frame ----------------
// Python runner. It runs inside the frame's worker (as source text) and in Node in the tests, so it only
// touches the pyodide object it is given: stdout and stderr are collected, the last expression is returned.
export const PY_RUNNER = async function runPython(pyodide, code) {
  const out = [], err = [];
  pyodide.setStdout({ batched: (s) => out.push(s) });
  pyodide.setStderr({ batched: (s) => err.push(s) });
  try {
    if (pyodide.loadPackagesFromImports) await pyodide.loadPackagesFromImports(code);
    const r = await pyodide.runPythonAsync(code);
    let result = null;
    if (r !== undefined && r !== null) { try { result = r.toJs ? JSON.stringify(r.toJs()) : String(r); } catch { result = String(r); } if (r.destroy) r.destroy(); }
    return { ok: true, stdout: out.join("\n"), stderr: err.join("\n"), result };
  } catch (e) {
    return { ok: false, stdout: out.join("\n"), stderr: err.join("\n"), error: String(e && e.message || e) };
  }
};

export function cspFor(kind, { net = false, pyodideUrl = PYODIDE_DEFAULT } = {}) {
  const web = net ? " https:" : "";
  const py = kind === "python" ? ` ${new URL(pyodideUrl).origin}` : "";
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:${web}${py}`,
    `style-src 'unsafe-inline'${web}`,
    `img-src data: blob:${web}`,
    `font-src data:${web}`,
    `media-src data: blob:${web}`,
    `connect-src ${net || py ? (web + py).trim() : "'none'"}`,
    "worker-src blob:",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

// Reports size and errors to the panel with postMessage (the only way out of the frame).
const BOOT = `(function(){var P=function(m){try{parent.postMessage(Object.assign({ccArtifact:1},m),"*")}catch(e){}};
window.__cc=P;
window.addEventListener("error",function(e){P({type:"error",text:String(e.message||e)})});
window.addEventListener("unhandledrejection",function(e){P({type:"error",text:String(e.reason&&e.reason.message||e.reason)})});
var h=function(){P({type:"size",height:Math.min(4000,document.documentElement.scrollHeight)})};
window.addEventListener("load",function(){h();P({type:"ready"});if(window.ResizeObserver)new ResizeObserver(h).observe(document.documentElement)});})();`;
const BASE_CSS = `html,body{margin:0;padding:0}body{font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#111;background:#fff;padding:14px}pre{background:#f4f4f5;padding:10px;border-radius:6px;overflow:auto}code{font-family:ui-monospace,Consolas,monospace;font-size:13px}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 8px}#cc-out{white-space:pre-wrap;font-family:ui-monospace,Consolas,monospace;font-size:13px}.cc-err{color:#b91c1c}.cc-dim{color:#666}`;

function shell(csp, body, { css = BASE_CSS, head = "" } = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escAttr(csp)}"><meta name="referrer" content="no-referrer"><script>${BOOT}</script><style>${css}</style>${head}</head><body>${body}</body></html>`;
}

function jsBody(code) {
  const src = JSON.stringify(code).replace(/</g, "\\u003c");
  return `<div class="cc-dim">Console output</div><div id="cc-out"></div><script>(function(){var o=document.getElementById("cc-out");
var w=function(cls){return function(){var d=document.createElement("div");if(cls)d.className=cls;d.textContent=[].map.call(arguments,function(a){try{return typeof a==="string"?a:JSON.stringify(a)}catch(e){return String(a)}}).join(" ");o.appendChild(d)}};
console.log=w("");console.info=w("");console.warn=w("cc-err");console.error=w("cc-err");
try{var r=(0,eval)(${src});if(r!==undefined)w("cc-dim")("=> "+(typeof r==="string"?r:JSON.stringify(r)))}catch(e){w("cc-err")(String(e&&e.message||e))}})();</script>`;
}

function pyBody(code, pyodideUrl) {
  const runner = `var runPython=${PY_RUNNER.toString()};`;
  const worker = `${runner}var ready=null;self.onmessage=async function(e){try{if(!ready){importScripts(${JSON.stringify(pyodideUrl + "pyodide.js")});ready=loadPyodide({indexURL:${JSON.stringify(pyodideUrl)}});}var py=await ready;self.postMessage(await runPython(py,e.data.code));}catch(err){self.postMessage({ok:false,stdout:"",stderr:"",error:"Could not load Python (Pyodide): "+String(err&&err.message||err)})}};`;
  return `<div class="cc-dim" id="cc-st">Loading Python (Pyodide, about 10 MB the first time)...</div><div id="cc-out"></div><script>(function(){
var st=document.getElementById("cc-st"),o=document.getElementById("cc-out");
var wk=new Worker(URL.createObjectURL(new Blob([${JSON.stringify(worker).replace(/</g, "\\u003c")}],{type:"text/javascript"})));
var t0=Date.now();
wk.onmessage=function(e){var r=e.data;st.textContent=(r.ok?"Finished":"Failed")+" in "+((Date.now()-t0)/1000).toFixed(1)+" s";
var add=function(t,c){if(!t)return;var d=document.createElement("div");if(c)d.className=c;d.textContent=t;o.appendChild(d)};
add(r.stdout,"");add(r.stderr,"cc-err");if(r.result!=null)add("=> "+r.result,"cc-dim");add(r.error,"cc-err");window.__cc({type:"python",result:r})};
wk.postMessage({code:${JSON.stringify(code).replace(/</g, "\\u003c")}});})();</script>`;
}

// The complete srcdoc for one version. HTML artifacts keep their own document; the CSP and the reporter
// are put first in its <head> so they apply before any of its scripts.
export function frameHtml(kind, content, opts = {}) {
  const k = cleanKind(kind);
  const pyodideUrl = String(opts.pyodideUrl || PYODIDE_DEFAULT).replace(/\/?$/, "/");
  if (!/^https:\/\/[^\s"'<>]+$/.test(pyodideUrl)) throw bad("The Pyodide address must be an https:// address.");
  const csp = cspFor(k, { net: !!opts.net, pyodideUrl });
  if (k === "html") {
    const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escAttr(csp)}"><meta name="referrer" content="no-referrer"><script>${BOOT}</script>`;
    if (/<head[^>]*>/i.test(content)) return content.replace(/<head[^>]*>/i, (m) => m + head);
    if (/<html[^>]*>/i.test(content)) return content.replace(/<html[^>]*>/i, (m) => `${m}<head>${head}</head>`);
    return `<!doctype html><html><head>${head}<style>${BASE_CSS}</style></head><body>${content}</body></html>`;
  }
  if (k === "svg") return shell(csp, content, { css: BASE_CSS + "svg{max-width:100%;height:auto}" });
  if (k === "chart") return shell(csp, chartSvg(content), { css: BASE_CSS + "svg{max-width:100%;height:auto}" });
  if (k === "markdown") return shell(csp, markdownHtml(content), { css: BASE_CSS + "body{max-width:820px}img{max-width:100%}" });
  if (k === "js") return shell(csp, jsBody(content));
  return shell(csp, pyBody(content, pyodideUrl));
}

// The file a person downloads: the version's own text (a chart is exported as its SVG drawing).
export function exportFile(a, ver) {
  const slug = a.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "artifact";
  const body = a.kind === "chart" ? chartSvg(ver.content) : ver.content;
  return { filename: `${slug}-v${ver.v}.${EXT[a.kind]}`, mime: MIME[a.kind], body };
}
