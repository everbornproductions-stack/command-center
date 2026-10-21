// Download the answer as PDF or Word. Pro. The file is saved by the browser. Nothing is sent.
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
    toast(kind === "pdf" ? "PDF downloaded." : "Word document downloaded.");
  } catch (e) { toast(e.message, true); }
}

CC.register({
  id: "export",
  deliverable: { order: 7, render(el, run) {
    const text = run?.deliverable || run?.verdict?.text;
    if (!text) { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="row small" id="ex-bar" style="margin-top:8px;gap:8px;flex-wrap:wrap"><button class="btn sm" type="button" id="ex-pdf">Download PDF</button><button class="btn sm" type="button" id="ex-docx">Download Word</button><span class="dim">Headings, bold text, and lists stay in the file. Keys are left out. Pro.</span></div>`;
    el.querySelector("#ex-pdf").addEventListener("click", () => download("pdf", run));
    el.querySelector("#ex-docx").addEventListener("click", () => download("docx", run));
  } },
});
