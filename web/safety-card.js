// The "Safety check" card as plain HTML, no DOM access, so tests can import it. web/features/safety.js shows it.
// Words are short and plain. A secret is only ever shown as its first 3 characters + ****.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const LIGHT = {
  green: { label: "All clear", dot: "\u{1F7E2}", word: "Green" },
  amber: { label: "Worth a look", dot: "\u{1F7E1}", word: "Amber" },
  red: { label: "Fix before you publish", dot: "\u{1F534}", word: "Red" },
};
export const PRIVACY_LINE = "This check runs on your computer. No code leaves your PC.";

export function lightHtml(light) {
  const l = LIGHT[light] || LIGHT.green;
  return `<span class="sc-light sc-${esc(light || "green")}" role="img" aria-label="${esc(l.word)} light">${l.dot}</span> <b>${esc(l.label)}</b>`;
}

function groupHtml(g) {
  const where = (g.files || []).map((f) => `<li><span class="mono">${esc(f.path)}${f.line ? `:${esc(f.line)}` : ""}</span><br><code class="sc-line">${esc(f.snippet)}</code></li>`).join("");
  const more = g.count > (g.files || []).length ? `<li class="dim small">and ${esc(g.count - g.files.length)} more</li>` : "";
  return `<details class="sc-group sc-sev-${esc(g.severity)}"${g.severity === "high" ? " open" : ""}>
    <summary><b>${esc(g.title)}</b> <span class="chip">${esc(g.count)}</span></summary>
    <p class="sc-tldr"><b>TL;DR:</b> ${esc(g.tldr)}</p>
    ${g.mayBeFalseAlarm ? `<p class="dim small sc-fa">This may be a false alarm. Check the exact line.</p>` : ""}
    ${g.ignored ? `<p class="dim small">Left out: ${esc(g.ignoreReason)}</p>` : ""}
    <ul class="sc-files">${where}${more}</ul>
    ${g.fixable ? `<button type="button" class="btn sm primary" data-sf-fix="${esc(g.fixId)}">Fix it</button>` : ""}
  </details>`;
}

export function cardHtml(result, opts = {}) {
  if (!result) return `<section class="sc-card" aria-label="Safety check"><h4>Safety check</h4><p class="dim">Checking...</p></section>`;
  const issues = (result.groups || []).map(groupHtml).join("");
  const left = (result.ignored || []);
  const ignored = left.length ? `<details class="sc-ignored"><summary class="dim small">Left out on purpose (${esc(left.reduce((a, g) => a + g.count, 0))})</summary>${left.map(groupHtml).join("")}</details>` : "";
  const anyFix = (result.groups || []).some((g) => g.fixable);
  const note = opts.fixNote ? `<p class="sc-note">${esc(opts.fixNote)}</p>` : "";
  const done = opts.fixMessage ? `<p class="sc-done"><b>${esc(opts.fixMessage)}</b></p>` : "";
  return `<section class="sc-card sc-${esc(result.light)}" aria-label="Safety check">
    <h4>Safety check ${lightHtml(result.light)}</h4>
    <p class="sc-summary">${esc(result.summary)}</p>
    ${done}${note}${issues}${ignored}
    <div class="row sc-actions" style="gap:8px;flex-wrap:wrap">
      ${anyFix ? `<button type="button" class="btn sm primary" data-sf-fix="all">Fix it</button>` : ""}
      <button type="button" class="btn sm" data-sf-rescan>Rescan</button>
      ${opts.extra || ""}
    </div>
    <p class="dim small">${esc(PRIVACY_LINE)}</p>
  </section>`;
}

// One line for the Publish preview.
export function previewLine(safety) {
  if (!safety) return "";
  return `<div class="sc-prev sc-${esc(safety.light)}">Safety check: ${lightHtml(safety.light)}. ${esc(safety.summary)}</div>`;
}
