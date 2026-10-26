// Server side of the next actions slice (flag_nextactions, 0.4.19): the Remix folder path check,
// the credits retry plan, and the free stand-in pick. No network here. The plugin does the I/O.
import path from "node:path";
import { troubleKind, FREE_TIERS, freeNow } from "./fallback.js";

const REMIX_ID = /^remix-[a-z0-9]+$/;

// The saved folder of a Remix project, only when the id has the Remix shape and stays under projects/.
export function remixFolder(dataDir, projectId) {
  if (!dataDir || !REMIX_ID.test(String(projectId || ""))) return null;
  const root = path.resolve(dataDir, "projects");
  const folder = path.resolve(root, String(projectId));
  return folder.startsWith(root + path.sep) ? folder : null;
}

// After a mission ends: did a provider run out of credits? Returns the providers to skip on one retry.
export function creditsRetry(mission) {
  if (!mission || !["failed", "done-with-errors"].includes(mission.status)) return { retry: false, skip: [] };
  const tasks = Array.isArray(mission.tasks) ? mission.tasks : (mission.tasks && typeof mission.tasks === "object" ? Object.values(mission.tasks) : []);
  const skip = new Set();
  let any = false;
  for (const t of tasks) {
    if (!t || t.status !== "failed" || !t.error) continue;
    const kind = troubleKind({ message: String(t.error) });
    if (kind === "credits" || kind === "cap") { any = true; if (t.provider) skip.add(String(t.provider)); }
  }
  if (!any && troubleKind({ message: String(mission.error || "") }) === "credits") any = true;
  return { retry: any, skip: [...skip] };
}

// The first free tier route that has room today. Null when none is switched on and keyed.
export function freeStandIn(tiers = FREE_TIERS, ok = freeNow) {
  for (const [provider, tier] of Object.entries(tiers)) {
    const model = tier.models?.[0];
    if (model && ok(provider, model)) return { provider, model, name: tier.name };
  }
  return null;
}
