// The PDF box on a finished run (0.4.21, dogfood 07). Pure helpers, no DOM, so the page and the tests share them.
// It says plainly what was and was not saved, where, and how many pages. No script is ever offered to run.
const escDefault = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function pagesWord(n) { return n === 1 ? "1 page" : `${n} pages`; }

// steps that answered "I can't run a renderer" and the like: shown as not done, never green
export function notDoneSteps(m) { return (m?.tasks || []).filter((t) => t.notDone || t.status === "failed"); }

export function pdfBoxHtml(m, esc = escDefault) {
  const f = m?.savedPdf;
  if (!f) return "";
  if (!f.ok) {
    return `<div class="rc-pdf rc-notsaved" role="alert" style="border:2px solid var(--red, #c0392b);padding:8px 12px;border-radius:8px;margin:8px 0"><b>PDF not saved.</b> ${esc(String(f.error || "The PDF could not be made.").replace(/^Not saved:\s*/i, ""))}
      <div class="row small" style="margin-top:6px"><button type="button" class="btn sm" data-pdf-make>Try making the PDF again</button></div></div>`;
  }
  const warn = f.warning ? `<div class="small" style="margin-top:4px;color:var(--amber, #d68910)"><b>Check the length.</b> ${esc(f.warning)}</div>` : "";
  return `<div class="rc-pdf" style="border:1px solid var(--line, #556);padding:8px 12px;border-radius:8px;margin:8px 0">
    <div class="row small" style="gap:8px;flex-wrap:wrap"><b>Saved ${esc(f.pdf.name)}</b><span class="chip ${f.fits === false ? "amber" : "green"}">${esc(pagesWord(f.pdf.pages))}</span><span class="dim">and ${esc(f.md.name)}</span>
      <button type="button" class="btn sm" data-pdf-open>Open file</button></div>
    <div class="dim small mono" style="word-break:break-all;margin-top:4px">${esc(f.pdf.path)}</div>${warn}</div>`;
}

// one plain line above the steps when some did not do their job
export function notDoneLine(m, esc = escDefault) {
  const bad = notDoneSteps(m);
  if (!bad.length) return "";
  const names = bad.map((t) => `"${esc(t.title)}"`).join(", ");
  const rescued = m?.savedPdf?.ok ? " Meldmind made the PDF itself from the rest of the answer." : "";
  return `<div class="rc-notdone small" role="status" style="margin:8px 0"><b>${bad.length === 1 ? "1 step did not do its job" : `${bad.length} steps did not do their job`}:</b> ${names}.${rescued}</div>`;
}

// shown after Download PDF
export function downloadedLine(r, esc = escDefault) {
  if (!r) return "";
  const where = r.savedAs ? ` Saved in ${esc(r.savedAs)}.` : "";
  return `${esc(r.filename || "PDF")} is ready.${where}`;
}
