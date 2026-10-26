// AI employee work in MindMedia (0.4.21). When a mission step done by an AI employee finishes, its text is kept in
// MindMedia. "Queue for my OK" (the default) saves it as Review, "Send on its own" saves it as a Draft. Nothing is
// ever sent or posted from here. One notice per mission, not one per step.
import { saveToMindMedia } from "./project-media.js";
import { getEmployee, approvalFor } from "./employees.js";
import { emit } from "./events.js";

export function keepEmployeeWork(mission) {
  const kept = [];
  for (const t of mission?.tasks || []) {
    if (!t?.employee?.id || t.status !== "done" || !t.output || t.media) continue;
    const e = getEmployee(t.employee.id);
    const mode = approvalFor(t.employee.id);
    const out = saveToMindMedia({
      text: String(t.output),
      name: `${t.title || e?.name || "Result"}`.slice(0, 100),
      projectId: mission.projectId || "",
      source: `AI employee: ${t.employee.name || e?.name || "Employee"}`,
      status: mode === "own" ? "Draft" : "Review",
      dedupeKey: `emp:${mission.id}:${t.id}`,
      provenance: { prompt: String(mission.prompt || "").slice(0, 400), model: t.model || "", provider: t.provider || "", cost: Number.isFinite(Number(t.cost)) ? Number(t.cost) : null },
    });
    kept.push({ mode, out });
  }
  if (kept.length) {
    const review = kept.filter((k) => k.mode !== "own").length;
    emit("mindmedia.employee", {
      count: kept.length, review,
      text: review ? `${review} result${review === 1 ? " is" : "s are"} waiting for your OK in MindMedia.` : `${kept.length} result${kept.length === 1 ? " was" : "s were"} saved to MindMedia.`,
    });
    emit("projectmedia.update", { action: "save" });
  }
  return kept.length;
}
