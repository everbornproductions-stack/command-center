// Project menu on the chat composer: the real projects, plus "+ New project…".
// Names are checked here before the create or rename call so an empty or
// duplicate name never leaves the form.

export const NEW_PROJECT = "__new__";

export function projectSlug(name) {
  return String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// exceptId is the project being renamed, so its own name is not a clash.
export function projectNameError(name, projects, exceptId = "") {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return "Type a project name.";
  const list = Array.isArray(projects) ? projects : [];
  const skip = String(exceptId || "");
  const lower = trimmed.toLowerCase();
  if (list.some((p) => p && p.id !== skip && String(p.name || "").trim().toLowerCase() === lower)) {
    return "A project with that name already exists.";
  }
  if (!skip) {
    const slug = projectSlug(trimmed);
    if (slug && list.some((p) => p && p.id === slug)) return "A project with that name already exists.";
  }
  return "";
}

export function projectOptionsHtml(projects, selected) {
  const list = Array.isArray(projects) ? projects : [];
  const rows = [`<option value="">No project</option>`];
  for (const p of list) rows.push(`<option value="${esc(p.id)}" ${p.id === selected ? "selected" : ""}>${esc(p.name)}</option>`);
  rows.push(`<option value="${NEW_PROJECT}">+ New project…</option>`);
  return rows.join("");
}
