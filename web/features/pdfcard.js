// The PDF box under a finished run (0.4.21, dogfood 07): where the PDF and .md were saved, with Open file.
import { pdfBoxHtml, notDoneLine } from "/pdf-card.js";
const { api, toast, esc } = window.CC;

function render(el, run) {
  const m = run?.mission;
  if (!m || run.kind !== "mission" || !["done", "done-with-errors", "failed"].includes(run.status || m.status)) { el.innerHTML = ""; return; }
  const html = `${notDoneLine(m, esc)}${pdfBoxHtml(m, esc)}`;
  el.innerHTML = html ? `<div class="pdfcard">${html}</div>` : "";
  el.querySelector("[data-pdf-open]")?.addEventListener("click", async () => {
    try { await api("/docpdf/open", { method: "POST", body: { missionId: m.id } }); } catch (e) { toast(e.message, true); }
  });
  el.querySelector("[data-pdf-make]")?.addEventListener("click", async (ev) => {
    const b = ev.currentTarget; b.disabled = true;
    try { const r = await api("/docpdf/make", { method: "POST", body: { missionId: m.id } }); toast(r.line || "PDF saved."); }
    catch (e) { toast(e.message, true); }
    b.disabled = false;
  });
}

window.CC.register({ id: "pdfcard", deliverable: { order: 6, render } });
