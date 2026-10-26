// Working-in project bar: shows which project the open page is working for, lets the person
// change it, and jumps between the tools for that project. Pure helpers, no DOM access, so the
// tests can import it. app.js mounts it above the page when the projectbar flag is on.

export const BAR_VIEWS = ["command", "images", "media", "remix", "builders", "webbuilders", "publish"];
export const BAR_TOOLS = [
  ["command", "Chat"],
  ["images", "Images"],
  ["media", "Media"],
  ["remix", "Remix"],
  ["builders", "Builders"],
  ["publish", "Publish"],
];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function barShows(view, flagOn) {
  return !!flagOn && BAR_VIEWS.includes(view);
}

export function barHtml({ projects, selected, view }) {
  const list = Array.isArray(projects) ? projects : [];
  const has = !!selected && list.some((p) => p.id === selected);
  const opts = [`<option value=""${has ? "" : " selected"}>No project</option>`]
    .concat(list.map((p) => `<option value="${esc(p.id)}"${p.id === selected ? " selected" : ""}>${esc(p.name)}</option>`)).join("");
  const tools = has
    ? BAR_TOOLS.map(([id, label]) => `<button type="button" class="btn sm${id === view ? " on" : ""}" data-pb-go="${id}"${id === view ? ' aria-current="page"' : ""}>${label}</button>`).join("")
    : "";
  const cont = has ? `<button type="button" class="btn sm" id="pb-continue">Continue this project</button>` : "";
  return `<span class="pb-lbl"><span class="pb-lbl-pick">Project:</span><span class="pb-lbl-tools">Project tools:</span></span>
    <select id="pb-select" aria-label="Project">${opts}</select>
    ${cont}<span class="pb-tools">${tools}</span>`;
}

// The newest run of a project, so Continue can put its last words back in the box.
export function lastRunFor(missions, projectId) {
  const rows = (Array.isArray(missions) ? missions : []).filter((m) => m && m.projectId === projectId);
  rows.sort((a, b) => (Number(b.startedAt) || 0) - (Number(a.startedAt) || 0));
  return rows[0] || null;
}
