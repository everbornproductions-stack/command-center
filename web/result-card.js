// The result card (0.4.21, dogfood fixes). Pure helpers, no DOM: they return HTML strings from a mission so the
// feature (web/features/resultcard.js) and the tests share one source of truth. Plain words, no jargon.
const escDefault = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const PREVIEW_WIDTHS = { phone: 390, desktop: 1100 };

// "Incomplete" when anything failed or was not checked; "Done" only when nothing did.
export function runLabel(m) {
  if (!m) return "";
  if (m.status === "failed") return "Failed";
  if (m.status === "aborted") return "Stopped";
  if (m.incomplete) return "Incomplete";
  if (m.banner) return "Placeholder only";
  if (m.status === "done-with-errors") return "Done with problems";
  if (m.status === "done") return "Done";
  return "";
}
export function isIncomplete(m) { return !!(m && (m.incomplete || m.status === "done-with-errors" && (m.tasks || []).some((t) => t.status === "failed"))); }

export function bannerHtml(m, esc = escDefault) {
  if (!m?.banner) return "";
  return `<div class="rc-banner" role="alert" style="border:2px solid var(--red, #c0392b);background:rgba(192,57,43,.12);padding:10px 12px;border-radius:8px;margin:8px 0"><b>This is not a real ${esc((m.banner.kinds || ["result"]).join(" or "))}.</b> ${esc(m.banner.text)}</div>`;
}

export function incompleteHtml(m, esc = escDefault) {
  const inc = m?.incomplete;
  if (!inc?.reasons?.length) return "";
  return `<div class="rc-incomplete" role="alert" style="border:2px solid var(--amber, #d68910);background:rgba(214,137,16,.12);padding:10px 12px;border-radius:8px;margin:8px 0">
    <div><b>Incomplete.</b> Part of this job did not work, so it is not marked Done.</div>
    <ul style="margin:6px 0 6px 18px;padding:0">${inc.reasons.map((r) => `<li><b>${esc(r.title)}</b>: ${esc(r.reason)}</li>`).join("")}</ul>
    <button type="button" class="btn sm primary" data-rc-retry>Try again on another AI</button></div>`;
}

export function qaScoresHtml(m, esc = escDefault) {
  const rows = (m?.tasks || []).filter((t) => t.review);
  if (!rows.length) return "";
  return `<div class="rc-qa small" style="margin:8px 0"><b>Checks</b>${rows.map((t) => {
    const r = t.review;
    const word = r.unchecked ? "could not be checked" : r.pass ? "passed" : "did not pass";
    const score = r.score != null ? ` (${esc(r.score)} of 10)` : "";
    return `<div class="row small" data-rc-qa="${esc(t.id)}"><span style="flex:1">${esc(t.title)}</span><span class="chip ${r.pass ? "green" : "red"}">${word}${score}</span></div>`;
  }).join("")}</div>`;
}

export function fileBoxHtml(m, esc = escDefault) {
  const f = m?.savedFile;
  if (!f) return "";
  if (!f.ok) return `<div class="rc-file rc-notsaved" role="alert" style="border:2px solid var(--red, #c0392b);padding:8px 12px;border-radius:8px;margin:8px 0"><b>Not saved.</b> ${esc(String(f.error || `${f.name} was not written.`).replace(/^Not saved:\s*/i, ""))}</div>`;
  return `<div class="rc-file" style="border:1px solid var(--line, #556);padding:8px 12px;border-radius:8px;margin:8px 0">
    <div class="row small" style="gap:8px;flex-wrap:wrap"><b>Saved as ${esc(f.name)}</b><span class="dim mono" style="flex:1;word-break:break-all">${esc(f.path)}</span>
      <button type="button" class="btn sm" data-rc-open>Open file</button>
      ${f.previewable ? `<button type="button" class="btn sm" data-rc-preview="phone">Phone view</button><button type="button" class="btn sm" data-rc-preview="desktop">Desktop view</button>` : `<button type="button" class="btn sm" data-rc-preview="text">Preview</button>`}</div>
    <div class="rc-preview" data-rc-pane hidden style="margin-top:8px"></div></div>`;
}

// the card: banner first, then why it is incomplete, the file, the checks
export function cardHtml(m, esc = escDefault) {
  if (!m) return "";
  return `${bannerHtml(m, esc)}${incompleteHtml(m, esc)}${fileBoxHtml(m, esc)}${qaScoresHtml(m, esc)}`;
}

// a preview pane for a saved file: a web page in a sandboxed frame at phone or desktop width, anything else as text
export function previewHtml(file, mode, esc = escDefault) {
  if (!file?.ok) return `<div class="small">${esc(file?.error || "Not saved.")}</div>`;
  if (file.previewable && mode !== "text") {
    const w = PREVIEW_WIDTHS[mode] || PREVIEW_WIDTHS.phone;
    // no scripts, no forms, no top navigation: the page can only be looked at
    return `<div style="overflow:auto;max-width:100%"><iframe sandbox="" title="Preview of ${esc(file.name)}" style="width:${w}px;max-width:100%;height:560px;border:1px solid var(--line, #556);background:#fff;border-radius:8px" srcdoc="${esc(file.text || "")}"></iframe></div><div class="dim small">${mode === "desktop" ? "Desktop width" : "Phone width"} (${w} px). Scripts are off in this preview.</div>`;
  }
  return `<pre class="mono small" style="white-space:pre-wrap;max-height:420px;overflow:auto;margin:0">${esc(String(file.text || "").slice(0, 20000))}</pre>`;
}
