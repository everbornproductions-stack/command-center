// Download the answer as PDF or Word. Pro. Only the requested document is exported, with a real file name, and the PDF
// is also kept in the project folder (server/doc-pdf.js). Nothing is sent.
const { api, toast } = window.CC;

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
// Keep: files the answer in MindMedia as Review. The same key is used by the automatic keep on agent runs, so it never doubles.
async function keep(run, text, btn) {
  const id = run?.id || window.CC.S.live?.id;
  try {
    const r = await window.CC.saveToMindMedia({ kind: "text", text, name: keepName(run), status: "Review", source: "Answer", dedupeKey: id ? `mission:${id}` : undefined, projectId: run?.mission?.projectId || undefined });
    if (btn) btn.textContent = "Kept";
    return r;
  } catch (e) { /* saveToMindMedia already showed the message */ }
}

CC.register({
  id: "export",
  deliverable: { order: 7, render(el, run) {
    const text = run?.deliverable || run?.verdict?.text;
    if (!text) { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="row small" id="ex-bar" style="margin-top:8px;gap:8px;flex-wrap:wrap"><button class="btn sm" type="button" id="ex-keep" title="Keeps this answer in MindMedia as Review. Nothing is sent.">Keep</button><button class="btn sm" type="button" id="ex-pdf">Download PDF</button><button class="btn sm" type="button" id="ex-docx">Download Word</button><span class="dim">Headings, bold text, and lists stay in the file. Keys are left out. Pro.</span></div>`;
    window.CC._lastResult = { kind: "text", text, name: keepName(run), source: "Answer" };
    el.querySelector("#ex-keep").addEventListener("click", () => keep(run, text, el.querySelector("#ex-keep")));
    el.querySelector("#ex-pdf").addEventListener("click", () => download("pdf", run));
    el.querySelector("#ex-docx").addEventListener("click", () => download("docx", run));
  } },
});
