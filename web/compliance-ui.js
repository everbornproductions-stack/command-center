// Plain-words review box for the compliance guard. Shows what looks risky and why, with Fix it
// and Send anyway. Send anyway is a person's own click, and it is never offered for a block.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function warningsHtml(warnings) {
  const rows = (warnings || []).filter((w) => w.level !== "info");
  const notes = (warnings || []).filter((w) => w.level === "info");
  if (!rows.length && !notes.length) return "";
  return `<div class="panel" data-compliance role="alert" style="margin-top:8px">
    ${rows.length ? `<b>Check before you send</b>` : ""}
    ${rows.map((w) => `<div class="small" style="margin-top:6px"><b>${esc(w.plain)}</b><div class="dim">${esc(w.why)}</div>${w.level === "block" ? `<div class="small">This cannot be sent.</div>` : ""}</div>`).join("")}
    ${notes.map((w) => `<div class="dim small" style="margin-top:6px">${esc(w.plain)} ${esc(w.why)}</div>`).join("")}
  </div>`;
}

// Draws the box after `anchor` and the two buttons. onFix: put the cursor back in the message.
// onSendAnyway: resend with sendAnyway true. When any warning is a block, only Fix it shows.
export function showReview(anchor, warnings, { onFix, onSendAnyway } = {}) {
  anchor.parentNode?.querySelector("[data-compliance-wrap]")?.remove();
  const wrap = document.createElement("div");
  wrap.setAttribute("data-compliance-wrap", "");
  const blocked = (warnings || []).some((w) => w.level === "block");
  wrap.innerHTML = warningsHtml(warnings) + `<div class="row" style="gap:8px;margin-top:6px"><button type="button" class="btn sm primary" data-fix>Fix it</button>${blocked ? "" : `<button type="button" class="btn sm" data-anyway>Send anyway</button>`}</div>`;
  anchor.insertAdjacentElement("afterend", wrap);
  wrap.querySelector("[data-fix]").addEventListener("click", () => { wrap.remove(); onFix?.(); });
  wrap.querySelector("[data-anyway]")?.addEventListener("click", () => { wrap.remove(); onSendAnyway?.(); });
  return wrap;
}
