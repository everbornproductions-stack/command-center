// Memories (0.4.21): the routes behind Settings > Memories, "remember that ..." / "forget ..." and Undo.
// The store is server/memories.js. Nothing here leaves the computer.
import * as M from "../memories.js";
import { memoryOf, FIELDS, LABELS } from "../project-memory.js";
export const id = "memories";

// Notes the person wrote or imported for a project (HQ files, project voice and facts) and the files they
// added to it count as This project memory. They are shown read only here; they are edited on the project.
function linked(h) {
  const out = [];
  for (const pr of h.listProjects()) {
    const m = memoryOf(pr.id);
    for (const f of FIELDS) if (typeof m[f] === "string" && m[f].trim()) out.push({ id: `note-${pr.id}-${f}`, bucket: "project", projectId: pr.id, text: `${LABELS[f]}: ${m[f].trim().replace(/\s+/g, " ").slice(0, 160)}`, importance: 3, source: "project notes", readOnly: true });
  }
  return out;
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/memories/, "");
  const m = req.method;
  const fail = (r, code = 400) => h.json(res, r.status || code, { error: r.message || r.error, refused: !!r.refused });
  if (m === "GET" && (p === "" || p === "/")) {
    return h.json(res, 200, { ...M.overview(), linked: linked(h), projects: h.listProjects().map((x) => ({ id: x.id, name: x.name })), smarter: await M.smarterState() });
  }
  if (m === "GET" && p === "/recall") {
    const q = url.searchParams.get("q") || "", pid = url.searchParams.get("projectId") || null;
    return h.json(res, 200, { items: M.recall({ query: q, projectId: pid }), block: M.recallBlock(q, pid) });
  }
  if (m === "POST" && p === "/enabled") { const on = M.setOn(body?.on !== false); h.emit("log", { text: `Memory turned ${on ? "on" : "off"}.` }); return h.json(res, 200, { enabled: on }); }
  if (m === "POST" && p === "/smarter") { const r = await M.setSmarter(body?.on === true); return r.ok ? h.json(res, 200, { ...r, smarter: await M.smarterState() }) : h.json(res, 400, { error: r.error, smarter: await M.smarterState() }); }
  if (m === "POST" && p === "/remember") {
    if (body?.bucket || body?.importance) {
      const r = M.isOn() ? M.add({ text: body.text, bucket: body.bucket, projectId: body.projectId, importance: body.importance, source: body.source || "settings" }) : { ok: false, status: 400, error: "Memory is off. Turn it on in Settings > Memories." };
      if (!r.ok) return fail(r);
      return h.json(res, 200, r);
    }
    const r = M.remember(body?.text, { projectId: body?.projectId, source: body?.source || "chat" });
    if (!r.ok) return fail(r);
    if (!r.duplicate) h.emit("memory.saved", { saved: [r.memory], forgotten: [] });
    return h.json(res, 200, { ...r, line: `Remembered: ${r.memory.text}` });
  }
  if (m === "POST" && p === "/forget") {
    const r = M.forget(body?.text);
    if (!r.ok) return fail(r);
    if (r.removed.length) h.emit("memory.saved", { saved: [], forgotten: r.removed });
    return h.json(res, 200, { ...r, line: r.removed.length ? `Forgot: ${r.removed.map((x) => x.text).join("; ")}` : r.message });
  }
  if (m === "POST" && p === "/restore") {
    // Undo of a forget: put the memory back as it was
    const t = body?.memory || {};
    const r = M.add({ text: t.text, bucket: t.bucket, projectId: t.projectId, importance: t.importance, source: t.source || "undo" });
    return r.ok ? h.json(res, 200, r) : fail(r);
  }
  if (m === "POST" && p === "/clear") {
    if (body?.confirm !== true) return h.json(res, 400, { error: "Confirm to clear all memories." });
    return h.json(res, 200, { removed: M.clearAll() });
  }
  const one = p.match(/^\/([a-z0-9-]+)$/);
  if (one) {
    if (m === "DELETE") return M.remove(one[1]) ? h.json(res, 200, { ok: true }) : h.json(res, 404, { error: "That memory is gone." });
    if (m === "POST" || m === "PATCH" || m === "PUT") { const r = M.update(one[1], body || {}); return r.ok ? h.json(res, 200, r) : fail(r); }
  }
  if (m === "POST" && (p === "" || p === "/")) {
    const r = M.add({ text: body?.text, bucket: body?.bucket, projectId: body?.projectId, importance: body?.importance, source: "settings" });
    return r.ok ? h.json(res, 200, r) : fail(r);
  }
  return false;
}
