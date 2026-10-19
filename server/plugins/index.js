// Server plugin loader. Each plugin is one module in this folder exporting:
//   export const id = "pipelines";
//   export async function routes(req, res, url, body, helpers) -> true if it handled the request
//   export function onEvent(ev) {}                 (optional) every bus event
//   export function init(helpers) {}               (optional) once at startup
// helpers = { json, emit, bus, settings(), PROVIDERS, rank, classify, runMission, runCouncil, ... } supplied by index.js.
// Routes are mounted under /api/<id>/... ; a plugin only sees requests whose path starts with its id.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const plugins = [];
let helpersRef = null;

export async function loadPlugins(helpers) {
  helpersRef = helpers;
  for (const f of fs.readdirSync(here)) {
    if (!f.endsWith(".js") || f === "index.js") continue;
    try {
      const mod = await import(`./${f}`);
      if (!mod.id) continue;
      plugins.push(mod);
      await mod.init?.(helpers);
      if (mod.onEvent) helpers.bus.on("event", (ev) => { try { mod.onEvent(ev, helpers); } catch (e) { console.error(`[plugin ${mod.id}] onEvent`, e.message); } });
      console.log(`[plugins] loaded ${mod.id}`);
    } catch (e) { console.error(`[plugins] failed to load ${f}:`, e.message); }
  }
  return plugins;
}

// Called by index.js for /api/<id>/... before its own 404.
export async function handlePlugin(req, res, url, body) {
  const seg = url.pathname.replace(/^\/api\//, "").split("/")[0];
  const p = plugins.find((x) => x.id === seg);
  if (!p?.routes) return false;
  try {
    return (await p.routes(req, res, url, body, helpersRef)) !== false;
  } catch (e) {
    // tier gates throw with status 402; anything else is a plugin bug
    helpersRef.json(res, e.status || 500, { error: e.message, code: e.code });
    return true;
  }
}

export const loadedPlugins = () => plugins.map((p) => p.id);
