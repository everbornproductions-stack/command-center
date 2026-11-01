import { loadCatalog } from "../free-catalog.js";
import { PROVIDERS } from "../registry.js";

export const id = "free-catalog";
export async function routes(req, res, url, body, h) {
  if (req.method !== "GET" || url.pathname !== "/api/free-catalog") return false;
  const catalog = loadCatalog();
  return h.json(res, 200, {
    version: catalog.version, updated: catalog.updated, signed: !!catalog.signed,
    apps: catalog.entries.filter((e) => e.kind === "app"),
    keys: catalog.entries.filter((e) => e.kind === "key" && e.page).map((e) => ({ ...e, connectable: !!e.provider && !!PROVIDERS[e.provider] })),
  });
}
