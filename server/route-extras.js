// Extra rows the router can score. Apps register here after the person allows them.
// A source that throws must not blank the rest of the list.

const sources = [];

export function addRouteSource(fn) {
  if (typeof fn === "function" && !sources.includes(fn)) sources.push(fn);
}

export function extraRouteModels() {
  const out = [];
  for (const fn of sources) {
    try {
      const rows = fn() || [];
      for (const row of rows) if (row) out.push(row);
    } catch { /* one source stays out */ }
  }
  return out;
}
