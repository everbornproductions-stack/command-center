// Server plugin loader. Each plugin is one module in this folder exporting:
//   export const id = "pipelines";
//   export async function routes(req, res, url, body, helpers) -> true if it handled the request
//   export function onEvent(ev) {}                 (optional) every bus event
//   export function init(helpers) {}               (optional) once, when the module loads
// helpers = { json, emit, bus, settings(), PROVIDERS, rank, classify, runMission, runCouncil, ... } supplied by index.js.
// Routes are mounted under /api/<id>/... ; a plugin only sees requests whose path starts with its id.
//
// Files listed in web/perf/registry.js SERVER_DEMAND are not imported here.
// The first request, or POST /api/perf/open, imports them.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SERVER_DEMAND } from "../../web/perf/registry.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const plugins = [];
const lazy = new Map();
const loading = new Map();
let helpersRef = null;

const demandFile = new Map(SERVER_DEMAND.map((row) => [row.file, row.id]));

async function importOne(file) {
  const mod = await import(`./${file}`);
  if (!mod?.id) return null;
  if (plugins.some((p) => p.id === mod.id)) return mod;
  plugins.push(mod);
  await mod.init?.(helpersRef);
  if (mod.onEvent && helpersRef?.bus) {
    helpersRef.bus.on("event", (ev) => { try { mod.onEvent(ev, helpersRef); } catch (e) { console.error(`[plugin ${mod.id}] onEvent`, e.message); } });
  }
  console.log(`[plugins] loaded ${mod.id}`);
  return mod;
}

export async function loadPlugins(helpers) {
  helpersRef = helpers;
  for (const row of SERVER_DEMAND) lazy.set(row.id, row.file);
  for (const f of fs.readdirSync(here)) {
    if (!f.endsWith(".js") || f === "index.js") continue;
    if (demandFile.has(f)) {
      console.log(`[plugins] deferred ${demandFile.get(f)}`);
      continue;
    }
    try { await importOne(f); }
    catch (e) { console.error(`[plugins] failed to load ${f}:`, e.message); }
  }
  return plugins;
}

export function ensurePlugin(id) {
  const have = plugins.find((p) => p.id === id);
  if (have) return Promise.resolve(have);
  const file = lazy.get(id);
  if (!file) return Promise.resolve(null);
  if (loading.has(id)) return loading.get(id);
  const job = importOne(file).finally(() => loading.delete(id));
  loading.set(id, job);
  return job;
}

// Called by index.js for /api/<id>/... before its own 404.
export async function handlePlugin(req, res, url, body) {
  const seg = url.pathname.replace(/^\/api\//, "").split("/")[0];
  let p = plugins.find((x) => x.id === seg);
  if (!p && lazy.has(seg)) p = await ensurePlugin(seg);
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
