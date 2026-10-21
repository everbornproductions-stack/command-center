// Extra models the router may pick, registered by a local AI or an allowed app.
// Empty until something registers. A broken source is skipped so the router still runs.

const sources = [];

export function addRouteSource(fn) {
  if (typeof fn === "function" && !sources.includes(fn)) sources.push(fn);
}

export function extraRouteModels() {
  const out = [];
  for (const fn of sources) {
    try {
      const rows = fn() || [];
      for (const row of rows) if (row && row.model) out.push(row);
    } catch { /* one source must not blank the router */ }
  }
  return out;
}
