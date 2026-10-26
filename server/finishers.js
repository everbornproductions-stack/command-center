// Category finishers (flag_finishers, 0.4.19). Small editors for documents, accounting tables,
// automations, music, presentations, programs and games. Each piece of work is one item kept on this PC.
// Nothing here sends, books, pays, posts or deploys. Anything that changes the outside world waits for a
// click that carries confirmed: true. Reuses doc-export.js (Word and PDF) and schedules.js (activate).
import { doc, putDoc } from "./store.js";
import { toDocx, toPdf, fileSlug } from "./doc-export.js";

export const DOC = "finishers";
export const KINDS = [
  { id: "document", label: "Document or report", editor: "Documents" },
  { id: "accounting", label: "Accounting table", editor: "Accounting" },
  { id: "automation", label: "Automation", editor: "Automations" },
  { id: "music", label: "Music or audio", editor: "Music" },
  { id: "presentation", label: "Presentation", editor: "Presentations" },
  { id: "program", label: "Program", editor: "Programs" },
  { id: "game", label: "Game items", editor: "Games" },
];
export const LIMITS = { items: 100, title: 120, text: 200000, sections: 80, rows: 500, steps: 30, tracks: 30, slides: 60, bullets: 12, gameItems: 200, code: 200000 };
export const THEMES = ["light", "dark", "warm"];
const KIND_IDS = new Set(KINDS.map((k) => k.id));
export const isKind = (k) => KIND_IDS.has(k);

const DASH = String.fromCharCode(8212);
const err = (status, message, code) => Object.assign(new Error(message), { status, code: code || "error" });
const txt = (s, n) => String(s ?? "").replaceAll(DASH, "-").slice(0, n);
const line = (s, n) => txt(s, n).replace(/[\r\n]+/g, " ").trim();
const num = (v, lo, hi, d = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const KEYISH = /\b(?:sk-(?:ant-|or-|proj-)?[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|xai-[A-Za-z0-9]{12,}|gsk_[A-Za-z0-9]{12,})\b/g;
const hide = (s) => String(s || "").replace(KEYISH, "[hidden]");

// ---------- documents: sections ----------
export function splitSections(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const out = [];
  let cur = null;
  let fence = false;
  for (const l of lines) {
    if (/^\s*```/.test(l)) fence = !fence;
    const h = !fence && /^(#{1,3})\s+(.*)$/.exec(l);
    if (h) { cur = { title: line(h[2], 200), level: h[1].length, body: [] }; out.push(cur); continue; }
    if (!cur) { cur = { title: "", level: 0, body: [] }; out.push(cur); }
    cur.body.push(l);
  }
  return out.slice(0, LIMITS.sections).map((s) => ({ title: s.title, level: s.level, text: s.body.join("\n").replace(/^\n+|\n+$/g, "") }));
}
export function joinSections(sections) {
  return sections.map((s) => (s.level ? `${"#".repeat(s.level)} ${s.title}\n\n` : "") + (s.text || "")).join("\n\n").trim() + "\n";
}
// A claim is a line with a number, a date or a quote. The person ticks each one as checked. Nothing is looked up online.
export function claimsOf(markdown) {
  const claims = [];
  for (const l of String(markdown || "").split(/\r?\n/)) {
    const t = l.replace(/^[-*>\s]+/, "").trim();
    if (!t || /^#/.test(t)) continue;
    if (/\d{2,}|\b(19|20)\d{2}\b|percent|%|according to|\bstudy\b|\bsource\b/i.test(t)) claims.push(t.slice(0, 200));
    if (claims.length >= 40) break;
  }
  return claims;
}

// ---------- accounting ----------
const cents = (v) => Math.round(num(v, -1e9, 1e9, 0) * 100);
export function accountingTotals(data) {
  const rows = (data.rows || []).map((r) => ({ ...r, amount: Math.round(num(r.qty, -1e6, 1e6, 0) * cents(r.price)) / 100 }));
  const sub = rows.reduce((a, r) => a + Math.round(r.amount * 100), 0);
  const tax = Math.round(sub * num(data.taxRate, 0, 100, 0) / 100);
  return { rows, subtotal: sub / 100, tax: tax / 100, total: (sub + tax) / 100 };
}
const csvCell = (v) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s; // stops a sheet from running text as a formula
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
export function accountingCsv(data) {
  const t = accountingTotals(data);
  const rows = [["Description", "Qty", "Price", "Amount"], ...t.rows.map((r) => [r.description, r.qty, Number(r.price).toFixed(2), r.amount.toFixed(2)]), [], ["", "", "Subtotal", t.subtotal.toFixed(2)], ["", "", `Tax ${data.taxRate || 0}%`, t.tax.toFixed(2)], ["", "", "Total", t.total.toFixed(2)]];
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// ---------- automations ----------
let cronMod = null;
async function schedules() { return cronMod || (cronMod = await import("./schedules.js")); }
export async function testAutomation(data) {
  const checks = [];
  const add = (ok, text) => checks.push({ ok, text });
  const steps = data.steps || [];
  add(steps.length > 0, steps.length ? `${steps.length} step${steps.length === 1 ? "" : "s"} found.` : "Add at least one step.");
  const risky = /\b(send|email|text|post|publish|pay|charge|invoice|book|delete|transfer)\b/i;
  const flagged = steps.filter((s) => risky.test(s.text));
  add(true, flagged.length ? `${flagged.length} step${flagged.length === 1 ? "" : "s"} would reach outside Meldmind. In a test they are only listed, never done.` : "No step reaches outside Meldmind.");
  if (data.when?.type === "cron") {
    try { const s = await schedules(); const c = s.parseCron(data.when.cron); const next = s.nextRun(c, Date.now()); add(true, `Repeat pattern is valid. Next run: ${next ? new Date(next).toLocaleString("en-US") : "not found"}.`); }
    catch (e) { add(false, e.message); }
  } else add(true, "No repeat set. It runs only when you start it.");
  const ok = checks.every((c) => c.ok);
  return { ok, checks, steps: steps.map((s, i) => ({ n: i + 1, text: s.text, wouldReachOut: risky.test(s.text), result: "listed only" })), at: Date.now() };
}

// ---------- music ----------
export function musicPlan(data) {
  const tracks = data.tracks || [];
  const cues = tracks.map((t, i) => `${i + 1}. ${t.name}  start ${t.start}s  length ${t.length}s  volume ${t.volume}%  fade in ${t.fadeIn}s  fade out ${t.fadeOut}s`);
  const filters = tracks.map((t, i) => {
    const f = [`volume=${(t.volume / 100).toFixed(2)}`];
    if (t.fadeIn > 0) f.push(`afade=t=in:st=0:d=${t.fadeIn}`);
    if (t.fadeOut > 0 && t.length > t.fadeOut) f.push(`afade=t=out:st=${t.length - t.fadeOut}:d=${t.fadeOut}`);
    if (t.start > 0) f.push(`adelay=${Math.round(t.start * 1000)}|${Math.round(t.start * 1000)}`);
    return `[${i}:a]${f.join(",")}[a${i}]`;
  });
  const mix = tracks.length ? `${filters.join(";")};${tracks.map((_, i) => `[a${i}]`).join("")}amix=inputs=${tracks.length}:normalize=0[out]` : "";
  return { cues, ffmpeg: mix ? `ffmpeg ${tracks.map((t, i) => `-i "input${i + 1}.wav"`).join(" ")} -filter_complex "${mix}" -map "[out]" mix.wav` : "" };
}

// ---------- presentations ----------
export function slidesFromOutline(text) {
  const slides = [];
  let cur = null;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    const h = /^#{1,3}\s+(.*)$/.exec(l);
    if (h) { cur = { title: line(h[1], 120), bullets: [], notes: "" }; slides.push(cur); continue; }
    if (!cur) { cur = { title: line(l, 120), bullets: [], notes: "" }; slides.push(cur); continue; }
    cur.bullets.push(line(l.replace(/^[-*]\s+/, ""), 200));
  }
  return slides.slice(0, LIMITS.slides);
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const THEME_CSS = { light: ["#ffffff", "#1a1a1a", "#2563eb"], dark: ["#14161a", "#f2f2f2", "#7aa2ff"], warm: ["#fff6e8", "#3b2a1a", "#c2410c"] };
export function slidesHtml(data, title) {
  const [bg, fg, ac] = THEME_CSS[data.theme] || THEME_CSS.light;
  const body = (data.slides || []).map((s, i) => `<section class="s"><h1>${esc(s.title)}</h1><ul>${(s.bullets || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul><p class="n">${i + 1}</p></section>`).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{margin:0;background:${bg};color:${fg};font-family:Segoe UI,Arial,sans-serif}.s{min-height:100vh;box-sizing:border-box;padding:8vh 8vw;page-break-after:always;position:relative;overflow-wrap:anywhere}h1{color:${ac};font-size:2.4rem}li{font-size:1.5rem;margin:.5rem 0}.n{position:absolute;right:4vw;bottom:3vh;opacity:.5}</style></head><body>\n${body}\n</body></html>\n`;
}

// ---------- programs ----------
const CODE_NOTES = [
  [/\beval\s*\(/, "Uses eval, which runs any text as code."],
  [/\bchild_process\b|\bos\.system\b|\bsubprocess\b/, "Starts other programs on the computer."],
  [/\bTODO\b|\bFIXME\b/, "Has TODO or FIXME notes left in it."],
  [/(password|secret|token|api[_-]?key)\s*[:=]\s*["'][^"']{6,}["']/i, "Looks like a password or key is typed into the code."],
  [/\brm\s+-rf\b|\bformat\s+c:|\bdel\s+\/[sq]/i, "Has a command that deletes files."],
];
export async function testProgram(data) {
  const code = String(data.code || "");
  const checks = [];
  const add = (ok, text) => checks.push({ ok, text });
  add(code.trim().length > 0, code.trim() ? `${code.split(/\r?\n/).length} lines of code.` : "There is no code yet.");
  for (const [re, msg] of CODE_NOTES) if (re.test(code)) add(false, msg);
  let checked = false;
  if (code.trim() && (data.language === "javascript" || data.language === "json")) {
    checked = true;
    try {
      if (data.language === "json") JSON.parse(code);
      else { const vm = await import("node:vm"); new vm.Script(code, { filename: "check.js" }); } // compile only, never run
      add(true, "It reads without errors. Nothing was run.");
    } catch (e) { add(false, "It does not read cleanly: " + line(e.message, 160)); }
  } else if (code.trim()) add(true, `${data.language} cannot be read here, so it was not checked for errors. Test it where it will run.`);
  const ok = !!code.trim() && checks.every((c) => c.ok);
  return { ok, checked, checks, at: Date.now() };
}

// ---------- games ----------
export const GAME_TYPES = ["character", "enemy", "weapon", "item", "level"];
export function gameProblems(data) {
  const out = [];
  const seen = new Set();
  for (const it of data.items || []) {
    const k = it.name.toLowerCase();
    if (seen.has(k)) out.push(`Two items are named ${it.name}.`);
    seen.add(k);
    if (!it.name) out.push("An item has no name.");
  }
  return out;
}

// ---------- cleaning data per kind ----------
export function normalize(kind, data = {}, prev = {}) {
  if (kind === "document") {
    const sections = Array.isArray(data.sections) ? data.sections.slice(0, LIMITS.sections).map((s) => ({ title: line(s?.title, 200), level: num(s?.level, 0, 3, 1), text: txt(s?.text, LIMITS.text) })) : data.markdown !== undefined ? splitSections(txt(data.markdown, LIMITS.text)) : prev.sections || [];
    const checked = Array.isArray(data.checked) ? data.checked.slice(0, 40).map((c) => line(c, 200)) : prev.checked || [];
    return { sections: sections.length ? sections : [{ title: "", level: 0, text: "" }], checked };
  }
  if (kind === "accounting") {
    const rows = (Array.isArray(data.rows) ? data.rows : []).slice(0, LIMITS.rows).map((r) => ({ description: line(r?.description, 200), qty: num(r?.qty, -1e6, 1e6, 1), price: num(r?.price, -1e9, 1e9, 0) }));
    return { kind: ["invoice", "expenses", "ledger"].includes(data.kind) ? data.kind : "invoice", party: line(data.party, 120), taxRate: num(data.taxRate, 0, 100, 0), rows };
  }
  if (kind === "automation") {
    const steps = (Array.isArray(data.steps) ? data.steps : []).slice(0, LIMITS.steps).map((s) => ({ text: line(typeof s === "string" ? s : s?.text, 300) })).filter((s) => s.text);
    const w = data.when || {};
    const when = w.type === "cron" ? { type: "cron", cron: line(w.cron, 100) } : { type: "manual" };
    return { steps, when, capUsd: num(data.capUsd, 0.01, 100, 1) };
  }
  if (kind === "music") {
    const tracks = (Array.isArray(data.tracks) ? data.tracks : []).slice(0, LIMITS.tracks).map((t) => ({ name: line(t?.name, 120) || "Track", start: num(t?.start, 0, 36000, 0), length: num(t?.length, 1, 36000, 30), volume: num(t?.volume, 0, 200, 100), fadeIn: num(t?.fadeIn, 0, 60, 0), fadeOut: num(t?.fadeOut, 0, 60, 0) }));
    return { tracks, notes: txt(data.notes, 4000) };
  }
  if (kind === "presentation") {
    const slides = (Array.isArray(data.slides) ? data.slides : []).slice(0, LIMITS.slides).map((s) => ({ title: line(s?.title, 120), bullets: (Array.isArray(s?.bullets) ? s.bullets : []).slice(0, LIMITS.bullets).map((b) => line(b, 200)).filter(Boolean), notes: txt(s?.notes, 2000) }));
    return { theme: THEMES.includes(data.theme) ? data.theme : "light", slides };
  }
  if (kind === "program") {
    const language = ["javascript", "python", "json", "other"].includes(data.language) ? data.language : "javascript";
    return { language, code: hide(txt(data.code, LIMITS.code)) };
  }
  if (kind === "game") {
    const items = (Array.isArray(data.items) ? data.items : []).slice(0, LIMITS.gameItems).map((i) => ({ name: line(i?.name, 60), type: GAME_TYPES.includes(i?.type) ? i.type : "item", description: line(i?.description, 300), hp: num(i?.hp, 0, 100000, 0), attack: num(i?.attack, 0, 100000, 0), speed: num(i?.speed, 0, 1000, 0) }));
    return { items };
  }
  throw err(400, "Pick one of the listed kinds.", "kind");
}

const seedFor = (kind, seed = "") => {
  const s = txt(seed, LIMITS.text);
  if (kind === "document") return { markdown: s || "# Untitled\n\nWrite here." };
  if (kind === "presentation") return { slides: s ? slidesFromOutline(s) : [{ title: "Title", bullets: ["First point"], notes: "" }] };
  if (kind === "accounting") return { rows: [{ description: "Item", qty: 1, price: 0 }] };
  if (kind === "automation") return { steps: s ? s.split(/\r?\n/).filter(Boolean).map((t) => ({ text: t })) : [] };
  if (kind === "program") return { code: s };
  return {};
};

// ---------- the items ----------
const store = () => doc(DOC, () => ({ items: [] }));
const stamp = () => Date.now();
const idOf = () => "fin_" + stamp().toString(36) + Math.random().toString(36).slice(2, 6);
// What the browser gets: the work, plus approval and test state that apply only to the current edit.
export function view(it) {
  if (!it) return null;
  const out = { ...it, approved: !!it.approval && it.approval.rev === it.rev, tested: !!it.test && it.test.rev === it.rev, testOk: !!it.test && it.test.rev === it.rev && !!it.test.result?.ok };
  if (it.kind === "accounting") out.totals = accountingTotals(it.data);
  if (it.kind === "document") out.claims = claimsOf(joinSections(it.data.sections));
  if (it.kind === "music") out.plan = musicPlan(it.data);
  if (it.kind === "game") out.problems = gameProblems(it.data);
  if (it.kind === "program") out.notes = CODE_NOTES.filter(([re]) => re.test(it.data.code)).map(([, m]) => m);
  return out;
}
export const listItems = (kind) => store().items.filter((i) => !kind || i.kind === kind).map((i) => ({ id: i.id, kind: i.kind, title: i.title, updatedAt: i.updatedAt, approved: !!i.approval && i.approval.rev === i.rev, active: !!i.activeScheduleId }));
export const getItem = (id) => view(store().items.find((i) => i.id === id));
function raw(id) { const it = store().items.find((i) => i.id === id); if (!it) throw err(404, "That item was not found.", "missing"); return it; }
function save() { putDoc(DOC, store()); }

export function createItem({ kind, title, seed } = {}) {
  if (!isKind(kind)) throw err(400, "Pick one of the listed kinds.", "kind");
  const d = store();
  if (d.items.length >= LIMITS.items) throw err(400, `You can keep up to ${LIMITS.items} finish items. Delete one first.`, "limit");
  const it = { id: idOf(), kind, title: line(title, LIMITS.title) || KINDS.find((k) => k.id === kind).label, data: normalize(kind, seedFor(kind, seed)), rev: 1, approval: null, test: null, activeScheduleId: null, createdAt: stamp(), updatedAt: stamp() };
  d.items.unshift(it);
  save();
  return view(it);
}
export function updateItem(id, { title, data } = {}) {
  const it = raw(id);
  if (title !== undefined) it.title = line(title, LIMITS.title) || it.title;
  if (data !== undefined) {
    it.data = normalize(it.kind, data, it.data);
    it.rev += 1; // an edit clears approval and test results
  }
  it.updatedAt = stamp();
  save();
  return view(it);
}
export function editSection(id, { index, title, text } = {}) {
  const it = raw(id);
  if (it.kind !== "document") throw err(400, "Only a document has sections.", "kind");
  const i = Math.floor(Number(index));
  const s = it.data.sections[i];
  if (!s) throw err(404, "That section was not found.", "section");
  const sections = it.data.sections.map((x, n) => (n === i ? { ...x, title: title === undefined ? x.title : title, text: text === undefined ? x.text : text } : x));
  return updateItem(id, { data: { sections } });
}
export function deleteItem(id) {
  const d = store();
  const it = d.items.find((i) => i.id === id);
  if (!it) throw err(404, "That item was not found.", "missing");
  if (it.activeScheduleId) throw err(409, "Turn the automation off before you delete it.", "active");
  d.items = d.items.filter((i) => i.id !== id);
  save();
  return { ok: true };
}

// A click with confirmed: true is the only way past an approval.
const needConfirm = (body) => { if (body?.confirmed !== true) throw err(400, "Press the confirm button to do this. It does not happen on its own.", "confirm"); };

export function approveItem(id, body) {
  needConfirm(body);
  const it = raw(id);
  if (it.kind === "program" && !(it.test && it.test.rev === it.rev && it.test.result?.ok)) throw err(409, "Run the test first. A program can only be approved after a test passes.", "test");
  if (it.kind === "game" && gameProblems(it.data).length) throw err(409, "Fix the listed problems first.", "problems");
  if (it.kind === "accounting" && !it.data.rows.length) throw err(409, "Add at least one row first.", "empty");
  it.approval = { rev: it.rev, at: stamp() };
  save();
  return view(it);
}
export function unapproveItem(id) { const it = raw(id); it.approval = null; save(); return view(it); }

export async function testItem(id) {
  const it = raw(id);
  let result;
  if (it.kind === "automation") result = await testAutomation(it.data);
  else if (it.kind === "program") result = await testProgram(it.data);
  else throw err(400, "Only automations and programs have a test.", "kind");
  it.test = { rev: it.rev, result };
  save();
  return view(it);
}

// Exports. Accounting needs an approval for the current edit. Everything else can be exported at any time.
export function exportItem(id, format) {
  const it = raw(id);
  const name = fileSlug(it.title);
  const out = (ext, mime, bytes) => ({ filename: `${name}.${ext}`, mime, base64: Buffer.from(bytes).toString("base64") });
  const f = String(format || "").toLowerCase();
  if (it.kind === "document") {
    const markdown = hide(joinSections(it.data.sections));
    if (f === "docx") return out("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", toDocx({ title: it.title, markdown }));
    if (f === "pdf") return out("pdf", "application/pdf", toPdf({ title: it.title, markdown }));
    return out("md", "text/markdown", markdown);
  }
  if (it.kind === "accounting") {
    if (!(it.approval && it.approval.rev === it.rev)) throw err(409, "Approve this table first. Any edit takes the approval away.", "approval");
    return out("csv", "text/csv", accountingCsv(it.data));
  }
  if (it.kind === "music") {
    const p = musicPlan(it.data);
    return out("txt", "text/plain", `${it.title}\r\n\r\n${p.cues.join("\r\n")}\r\n\r\nMix command (swap in your file names):\r\n${p.ffmpeg}\r\n${it.data.notes ? "\r\nNotes:\r\n" + it.data.notes + "\r\n" : ""}`);
  }
  if (it.kind === "presentation") {
    if (f === "md") return out("md", "text/markdown", it.data.slides.map((s) => `# ${s.title}\n\n${s.bullets.map((b) => `- ${b}`).join("\n")}\n${s.notes ? `\nNotes: ${s.notes}\n` : ""}`).join("\n"));
    return out("html", "text/html", slidesHtml(it.data, it.title));
  }
  if (it.kind === "program") {
    const ext = { javascript: "js", python: "py", json: "json", other: "txt" }[it.data.language];
    return out(ext, "text/plain", it.data.code);
  }
  if (it.kind === "game") return out("json", "application/json", JSON.stringify({ title: it.title, items: it.data.items }, null, 2));
  throw err(400, "There is nothing to export for this kind.", "kind");
}

// Automation: schedule only saves the plan. Activate creates a real schedule and needs the confirm click,
// a passing test for this edit, and an approval for this edit.
export function scheduleItem(id, body = {}) {
  const it = raw(id);
  if (it.kind !== "automation") throw err(400, "Only an automation can be scheduled.", "kind");
  const cron = line(body.cron ?? it.data.when?.cron, 100);
  if (!cron) throw err(400, "Pick when it repeats first, for example 0 9 * * 1-5.", "cron");
  return updateItem(id, { data: { ...it.data, when: { type: "cron", cron } } });
}
export async function activateItem(id, body, { createSchedule, setEnabled } = {}) {
  needConfirm(body);
  const it = raw(id);
  if (it.kind !== "automation") throw err(400, "Only an automation can be turned on.", "kind");
  if (it.activeScheduleId) throw err(409, "It is already on.", "active");
  if (it.data.when?.type !== "cron") throw err(409, "Set when it repeats first.", "cron");
  if (!(it.test && it.test.rev === it.rev && it.test.result?.ok)) throw err(409, "Run the test first. It has to pass for the current steps.", "test");
  if (!(it.approval && it.approval.rev === it.rev)) throw err(409, "Approve it first. Turning it on lets it run by itself.", "approval");
  const mod = createSchedule ? null : await schedules();
  const make = createSchedule || mod.createSchedule;
  const r = make({ name: line(it.title, 80), target: { kind: "chat", text: it.data.steps.map((s, i) => `${i + 1}. ${s.text}`).join("\n") }, trigger: { type: "cron", cron: it.data.when.cron }, capUsd: it.data.capUsd, enabled: true });
  it.activeScheduleId = r.schedule.id;
  it.updatedAt = stamp();
  save();
  return view(it);
}
export async function deactivateItem(id, { setEnabled } = {}) {
  const it = raw(id);
  if (!it.activeScheduleId) return view(it);
  const set = setEnabled || (await schedules()).setEnabled;
  try { set(it.activeScheduleId, false); } catch {}
  it.activeScheduleId = null;
  save();
  return view(it);
}
