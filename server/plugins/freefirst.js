// Free first (0.4.18): the view for Settings and the welcome screen, the switches, and the install buttons.
//   GET  /api/freefirst            routes with status, today's counter, the graphics card offer
//   POST /api/freefirst/settings   { on?, qualityToo?, routes?, limits?, ollamaModel? }
//   POST /api/freefirst/install    { what, consent: true, model? }   nothing runs without consent: true
import { freeSettings, saveFreeSettings, allStates, usage, todayLine, ORDER, ROUTES, clearCache } from "../free-first.js";
import { detectGpu, recommend } from "../gpu.js";
import { runInstall, LINKS } from "../free-install.js";
import { clearStatusCache } from "../sub-routes.js";
import { HOSTED } from "../store.js";

export const id = "freefirst";
let gpuCache = null;

async function view({ refresh = false, developer = false } = {}) {
  if (refresh) { clearCache(); clearStatusCache(); }
  const s = freeSettings();
  const states = await allStates({ fresh: refresh });
  if (!gpuCache || refresh) { try { gpuCache = await detectGpu(); } catch { gpuCache = { found: false }; } }
  const u = usage();
  return {
    on: s.on, qualityToo: s.qualityToo, order: ORDER,
    routes: states.map((r) => ({ ...r, on: s.routes[r.id], perDay: s.limits[r.id], usedToday: u.counts[r.id] || 0 })),
    today: { jobs: u.jobs, savedUsd: u.savedUsd, line: todayLine(u) },
    gpu: gpuCache, local: recommend(gpuCache, { developer }), ollamaModel: s.ollamaModel, links: LINKS,
    names: Object.fromEntries(ORDER.map((k) => [k, ROUTES[k].name])),
  };
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/freefirst/, "") || "/";
  try {
    const developer = url.searchParams.get("dev") === "1";
    if (req.method === "GET" && p === "/") return h.json(res, 200, await view({ refresh: url.searchParams.get("refresh") === "1", developer }));
    if (req.method === "POST" && p === "/settings") { saveFreeSettings(body || {}); return h.json(res, 200, await view({ developer })); }
    if (req.method === "POST" && p === "/install") {
      const b = body || {};
      if (HOSTED) return h.json(res, 400, { error: "Installing apps works in the desktop app only.", code: "hosted" });
      if (b.consent !== true) return h.json(res, 400, { error: "Meldmind installs nothing without your OK.", code: "consent" });
      h.emit("log", { text: `Free AI setup: ${String(b.what || "").slice(0, 40)} started after your OK.` });
      const r = await runInstall(String(b.what || ""), { consent: true, model: String(b.model || "") });
      if (r.ok && b.what === "ollama-model" && b.model) saveFreeSettings({ ollamaModel: String(b.model), routes: { ollama: true } });
      return h.json(res, 200, { ...r, view: await view({ refresh: true, developer }) });
    }
  } catch (e) { return h.json(res, e.status || 500, { error: e.message }); }
  return false;
}
