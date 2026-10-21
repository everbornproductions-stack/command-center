// Settings > Performance and the Add-ons manager.
// This file is in SERVER_DEMAND, so it loads on the first /api/perf request,
// not at startup.
import { scheduler } from "../perf/scheduler.js";
import { perfState } from "../perf/power.js";
import { listAddons, installAddon, removeAddon, chooseRoute } from "../perf/addons.js";
import { demandForView } from "../../web/perf/registry.js";
import { BASELINE, installerCap, IDLE_RAM_BUDGET } from "../perf/budget.js";

export const id = "perf";

function status(h) {
  return {
    lightMode: !!h.settings()?.lightMode,
    power: perfState(),
    jobs: scheduler.list(),
    addons: listAddons(h.DATA_DIR),
    budget: {
      installerBytes: BASELINE.installerBytes,
      installerCap: installerCap(),
      idleRamBytes: IDLE_RAM_BUDGET,
    },
  };
}

export async function routes(req, res, url, body, h) {
  const parts = url.pathname.replace(/^\/api\/perf\/?/, "").split("/").filter(Boolean);
  const m = req.method;
  try {
    if (m === "GET" && parts.length === 0) return h.json(res, 200, status(h));
    if (m === "POST" && parts[0] === "light" && parts.length === 1) {
      const on = body?.on === true;
      h.putDoc("settings", { ...h.settings(), lightMode: on });
      return h.json(res, 200, { lightMode: on });
    }
    if (m === "GET" && parts[0] === "addons" && parts.length === 1) return h.json(res, 200, { addons: listAddons(h.DATA_DIR) });
    if (m === "POST" && parts[0] === "addons" && parts[1]) {
      const row = await installAddon(parts[1], { approve: body?.approve === true, dataDir: h.DATA_DIR });
      return h.json(res, 200, row);
    }
    if (m === "DELETE" && parts[0] === "addons" && parts[1]) return h.json(res, 200, removeAddon(parts[1], h.DATA_DIR));
    if (m === "GET" && parts[0] === "route" && parts.length === 1) {
      const tool = url.searchParams.get("tool") || "";
      return h.json(res, 200, chooseRoute(h.DATA_DIR, tool));
    }
    if (m === "POST" && parts[0] === "open" && parts.length === 1) {
      const { ensurePlugin } = await import("./index.js");
      const view = String(body?.view || "");
      const loaded = [];
      for (const row of demandForView(view)) {
        const mod = await ensurePlugin(row.id);
        if (mod?.id) loaded.push(mod.id);
      }
      if (!loaded.includes("perf")) loaded.push("perf");
      return h.json(res, 200, { view, loaded });
    }
    return false;
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message || "Performance request failed." });
  }
}
