// Free includes one user-connected service. Pro, Studio and Owner include all of them.
// A local app (Cursor) and a handoff (open in the browser) are not a connection the person made.
// Already-connected services can be saved again. Council AI keys are not services.
import { guard, TIERS, licenseState } from "./license.js";

function counted(items) {
  return (items || []).filter((it) => it.status === "Connected" && it.flow?.type !== "open");
}

// Refuse before a write when these catalog ids are not connected yet and Free is already at the cap.
export async function assertServiceSlots(ids) {
  const want = [...new Set((ids || []).filter(Boolean))];
  if (!want.length) return;
  const { buildCatalog } = await import("./connect-setup.js");
  const items = buildCatalog();
  const known = new Set(items.map((it) => it.id));
  const have = new Set(counted(items).map((it) => it.id));
  const fresh = want.filter((id) => known.has(id) && !have.has(id));
  if (!fresh.length) return;
  const limit = TIERS[licenseState().tier].connectedServices;
  if (have.size + fresh.length > limit) guard("connectedService", { count: limit });
}
