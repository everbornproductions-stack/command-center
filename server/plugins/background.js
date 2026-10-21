// Routes for background runs. Starting one is gated in the chat, council, and mission routes.
import { backgroundView, seeBackground, noteBackgroundUpdate } from "../background.js";
import { gateAllows } from "../feature-gate.js";
import { licenseState } from "../license.js";
export const id = "background";

export function onEvent(ev) {
  if (ev.type === "mission.update" && ev.mission) noteBackgroundUpdate(ev.mission);
  if (ev.type === "council.update" && ev.council) {
    noteBackgroundUpdate({
      id: ev.council.id,
      kind: "council",
      status: ev.council.status,
      title: ev.council.title || String(ev.council.prompt || "").slice(0, 120),
      finishedAt: ev.council.finishedAt,
    });
  }
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/background/, "");
  const allowed = gateAllows(licenseState().tier, "backgroundRuns");
  if (req.method === "GET" && (p === "" || p === "/")) return h.json(res, 200, { ...backgroundView(), allowed });
  if (req.method === "POST" && p === "/seen") return h.json(res, 200, seeBackground(body?.id));
  return false;
}
