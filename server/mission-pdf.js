// The mission side of the PDF path (0.4.21, dogfood 07). When the task asks for a PDF, make it from the finished
// run and keep the result on the mission: mission.savedPdf says what was and was not saved. No script is ever
// handed to the person; the app renders it itself.
import { wantsPdf, makeAndSavePdf, savedLine, saysCouldNot } from "./doc-pdf.js";

export async function attachPdf(mission, { goal = "", log = () => {}, deps = {} } = {}) {
  if (!wantsPdf(goal) || !String(mission.deliverable || "").trim()) return null;
  const r = await makeAndSavePdf({ goal, title: mission.title || "", deliverable: mission.deliverable, tasks: mission.tasks, projectId: mission.projectId || "", missionId: mission.id, source: "Mission" }, deps);
  mission.savedPdf = r;
  log(savedLine(r), r.ok && !r.warning ? {} : { level: "error" });
  return r;
}

// a step that answered "I can't run a renderer" is not done, whatever its status said
export function stepNotDone(t) {
  return !!(t && t.status !== "failed" && t.output && saysCouldNot(t.output));
}
