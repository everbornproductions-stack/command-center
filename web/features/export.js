// Download the answer as PDF or Word. Pro. Only the requested document is exported, with a real file name, and the PDF
// is also kept in the project folder (server/doc-pdf.js). Nothing is sent.
// When the answer holds a table (a pipe table or a ```csv block) the table is drawn as a real table here, with
// Download CSV and Download Markdown beside the PDF and Word buttons, and Send to HighLevel. Sending always
// shows the rows first and waits for a second click on Send.
import { extractTables, toCsv } from "/table-extract.js";
const { api, toast, esc } = window.CC;

// The preview and the send both stop here, so a very long table never runs away.
const HL_MAX = 100;

function saveFile(r) {
  const bin = atob(r.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: r.mime }));
  window.CC.downloadBlob(url, r.filename);
}

async function download(kind, run) {
  const id = run?.id || window.CC.S.live?.id;
  if (!id) { toast("There is no answer to export yet.", true); return; }
  try {
    const r = await api(`/export/${kind}`, { method: "POST", body: { missionId: id } });
    saveFile(r);
    toast(kind === "pdf" ? (r.savedAs ? `${r.filename} downloaded and saved in ${r.savedAs}` : `${r.filename || "PDF"} downloaded.`) : "Word document downloaded.");
  } catch (e) { toast(e.message, true); }
}

function keepName(run) {
  const p = String(run?.mission?.prompt || run?.prompt || run?.mission?.title || "").replace(/\s+/g, " ").trim();
  return (p ? p.slice(0, 60) : "Answer") + " (kept)";
}

// The same words as the answer, safe to use as a file name.
function fileName(run, ext) {
  const p = String(run?.mission?.prompt || run?.prompt || run?.mission?.title || "").replace(/\s+/g, " ").trim().replace(/[\\/:*?"<>|]+/g, " ").trim();
  return `${p ? p.slice(0, 60) : "Answer"}.${ext}`;
}

function saveText(text, type, name) {
  window.CC.downloadBlob(URL.createObjectURL(new Blob([text], { type })), name);
}

// Keep: files the answer in MindMedia as Review. The same key is used by the automatic keep on agent runs, so it never doubles.
async function keep(run, text, btn) {
  const id = run?.id || window.CC.S.live?.id;
  try {
    const r = await window.CC.saveToMindMedia({ kind: "text", text, name: keepName(run), status: "Review", source: "Answer", dedupeKey: id ? `mission:${id}` : undefined, projectId: run?.mission?.projectId || undefined });
    if (btn) btn.textContent = "Kept";
    return r;
  } catch (e) { /* saveToMindMedia already showed the message */ }
}

// ---------- the table, as a real table ----------
function tablesHtml(tables) {
  return tables.map((t, i) => `<div class="ex-table" style="overflow:auto;max-width:100%;margin:8px 0">
    <table style="border-collapse:collapse;font-size:.875rem">
      ${tables.length > 1 ? `<caption class="dim small" style="text-align:left;padding:0 0 4px">Table ${i + 1}</caption>` : ""}
      <thead><tr>${t.headers.map((h) => `<th scope="col" style="text-align:left;padding:4px 10px;border-bottom:1px solid var(--line, #556);white-space:nowrap">${esc(h)}</th>`).join("")}</tr></thead>
      <tbody>${t.rows.map((r) => `<tr>${r.map((c) => `<td style="padding:4px 10px;border-bottom:1px solid var(--line, #556);vertical-align:top">${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>`).join("");
}

// ---------- Send to HighLevel: rows first, the click second ----------
let hlOk = false;
let hlAskedAt = 0;
async function highLevelConnected() {
  if (hlOk) return true;
  const now = Date.now();
  if (now - hlAskedAt < 30000) return false;
  hlAskedAt = now;
  try { hlOk = !!(await api("/highlevel"))?.connect?.connected; } catch { hlOk = false; }
  return hlOk;
}

function contactCols(headers) {
  const at = (re) => (headers || []).findIndex((h) => re.test(String(h || "").trim()));
  let name = at(/(^|[^a-z])(name|lead|contact|person|customer|client|company|business)([^a-z]|$)/i);
  if (name < 0) name = 0; // with no name column, the first column stands in
  return { name, email: at(/e-?mail/i), phone: at(/phone|mobile|cell/i) };
}

function contactRows(tables) {
  const out = [];
  for (const t of tables) {
    const c = contactCols(t.headers);
    (t.rows || []).forEach((row, i) => {
      const cell = (n) => (n >= 0 ? String(row[n] ?? "").trim() : "");
      out.push({ name: cell(c.name), email: cell(c.email), phone: cell(c.phone), where: `row ${i + 1}` });
    });
  }
  return out;
}

function hlPreviewHtml(rows) {
  const shown = rows.slice(0, HL_MAX);
  const ready = shown.filter((r) => r.name || r.email).length;
  const more = rows.length - shown.length;
  const li = (r) => r.name || r.email
    ? `<li>${esc(r.name || r.email)}${r.name && r.email ? ` · ${esc(r.email)}` : ""}${r.phone ? ` · ${esc(r.phone)}` : ""}</li>`
    : `<li>${esc(r.where)}: left out, it has no name and no email.</li>`;
  return `<div class="ex-hl" style="border:1px solid var(--line, #556);border-radius:8px;padding:8px 12px;margin:8px 0">
    <b>${ready === 1 ? "1 row is ready for HighLevel" : `${ready} rows are ready for HighLevel`}</b>
    <div class="dim small">Nothing was sent. Look over the rows, then press Send.</div>
    <ul class="small" style="margin:6px 0 6px 18px;padding:0;max-height:240px;overflow:auto">${shown.map(li).join("")}</ul>
    ${more > 0 ? `<div class="dim small">Only the first ${HL_MAX} rows are shown.</div>` : ""}
    ${ready ? `<div class="row" style="gap:8px;margin-top:6px"><button class="btn sm primary" type="button" id="ex-hl-send">Send</button><button class="btn sm" type="button" id="ex-hl-cancel">Cancel</button></div>` : `<div class="row" style="margin-top:6px"><button class="btn sm" type="button" id="ex-hl-cancel">Close</button></div>`}
  </div>`;
}

function openHlPreview(el, tables) {
  const slot = el.querySelector("[data-hlbox]");
  if (!slot) return;
  slot.innerHTML = hlPreviewHtml(contactRows(tables));
  slot.querySelector("#ex-hl-cancel")?.addEventListener("click", () => { slot.innerHTML = ""; });
  slot.querySelector("#ex-hl-send")?.addEventListener("click", async () => {
    const btn = slot.querySelector("#ex-hl-send");
    btn.disabled = true;
    const rows = contactRows(tables).filter((r) => r.name || r.email).slice(0, HL_MAX);
    let saved = 0, held = 0, failed = 0;
    for (const r of rows) {
      try {
        // every row goes through the same plan, and the run needs confirmed: true
        const plan = await api("/highlevel/preview", { method: "POST", body: { action: "create_contact", name: r.name, email: r.email, phone: r.phone } });
        if (!plan?.planId) { failed++; continue; }
        if ((plan.warnings || []).some((w) => w.level && w.level !== "info")) { held++; continue; }
        await api("/highlevel/run", { method: "POST", body: { planId: plan.planId, confirmed: true } });
        saved++;
      } catch { failed++; }
    }
    const parts = [`${saved} of ${rows.length} rows saved in HighLevel`];
    if (held) parts.push(`${held} held back for a check`);
    if (failed) parts.push(`${failed} did not go through`);
    toast(`${parts.join(", ")}.`, failed > 0);
    slot.innerHTML = "";
  });
}

CC.register({
  id: "export",
  deliverable: { order: 7, render(el, run) {
    const text = run?.deliverable || run?.verdict?.text;
    if (!text) { el.innerHTML = ""; return; }
    const tables = extractTables(text);
    const tableBtns = tables.length
      ? `<button class="btn sm" type="button" id="ex-csv">Download CSV</button><button class="btn sm" type="button" id="ex-md">Download Markdown</button><button class="btn sm" type="button" id="ex-hl" hidden>Send to HighLevel</button>`
      : "";
    el.innerHTML = `<div class="row small" id="ex-bar" style="margin-top:8px;gap:8px;flex-wrap:wrap"><button class="btn sm" type="button" id="ex-keep" title="Keeps this answer in MindMedia as Review. Nothing is sent.">Keep</button><button class="btn sm" type="button" id="ex-pdf">Download PDF</button><button class="btn sm" type="button" id="ex-docx">Download Word</button>${tableBtns}<span class="dim">Headings, bold text, and lists stay in the file. Keys are left out. Pro.</span></div>${tablesHtml(tables)}<div data-hlbox></div>`;
    window.CC._lastResult = { kind: "text", text, name: keepName(run), source: "Answer" };
    el.querySelector("#ex-keep").addEventListener("click", () => keep(run, text, el.querySelector("#ex-keep")));
    el.querySelector("#ex-pdf").addEventListener("click", () => download("pdf", run));
    el.querySelector("#ex-docx").addEventListener("click", () => download("docx", run));
    if (!tables.length) return;
    el.querySelector("#ex-csv").addEventListener("click", () => {
      saveText(tables.map((t) => toCsv(t)).join("\r\n"), "text/csv;charset=utf-8", fileName(run, "csv"));
      toast("CSV downloaded.");
    });
    el.querySelector("#ex-md").addEventListener("click", () => {
      saveText(text, "text/markdown;charset=utf-8", fileName(run, "md"));
      toast("Markdown downloaded.");
    });
    const hl = el.querySelector("#ex-hl");
    hl.addEventListener("click", () => openHlPreview(el, tables));
    highLevelConnected().then((on) => { if (on) hl.hidden = false; });
  } },
});
