// Which connected AIs can really take work right now (0.4.21). The Send dialog and "Who will read this" list only
// these, and name the AI that will really plan: the same pick the Mission planner makes. An AI that is paused for
// credits, busy, or refusing its key sits out until a real call works again.
import { trouble } from "./fallback.js";
import { describePause } from "./pause.js";

export function canRun(pid) {
  try { if (trouble(pid)) return false; } catch { /* no table yet */ }
  try { if (describePause(pid)) return false; } catch { /* no health row yet */ }
  return true;
}
export const runnableOnly = (list) => (Array.isArray(list) ? list : []).filter((m) => !m?.provider || canRun(m.provider));
