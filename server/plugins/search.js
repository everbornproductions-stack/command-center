// Live web search (Phase 15): the routes behind Settings > Web search and the "Search the web"
// toggles in Command. The engine logic lives in server/search.js (core, used by chat, council and
// mission). Keys go to the vault under "search-<engine>" after one test search; a refused key is
// never kept and the previous key is put back. Keys are never logged or echoed (masked only).
import { ENGINES, NATIVE, MODES, searchSettings, saveSearchSettings, secretId, engineKeyed, engineMasked, resolveEngine, runSearch, priceOf, capStopped } from "../search.js";
import { demoActive } from "../mock.js";

export const id = "search";

function view(h) {
  const s = searchSettings();
  const led = h.ledgerSummary();
  const spendOf = (pid) => led.byProvider?.[pid] || { month: 0, searches: 0 };
  const engines = Object.values(ENGINES).map((e) => ({
    id: e.id, name: e.name, vendor: e.vendor, color: e.color, looks: e.looks, keysUrl: e.keysUrl, pricingUrl: e.pricingUrl, note: e.note,
    listPrice: e.perSearch, perSearch: priceOf(e.id), cap: s.caps[e.id] || null, capStopped: capStopped(e.id),
    keyed: engineKeyed(e.id), masked: engineMasked(e.id), fromEnv: !!h.getSecret(secretId(e.id), e.envName)?.fromEnv,
    spendMonth: +(spendOf(secretId(e.id)).month || 0).toFixed(4), searches: spendOf(secretId(e.id)).searches || 0,
  }));
  const native = Object.entries(NATIVE).map(([pid, n]) => ({ provider: pid, providerName: h.PROVIDERS[pid]?.name || pid, name: n.name, unit: n.unit, note: n.note, listPrice: n.perSearch, perSearch: priceOf(pid), keyed: h.hasSecret(pid, h.PROVIDERS[pid]?.keyEnv), cap: s.caps[pid] || null }));
  const active = resolveEngine({});
  return { engine: s.engine, maxResults: s.maxResults, on: s.on, caps: s.caps, prices: s.prices, engines, native, active, demo: demoActive(), searchMonth: led.searchMonth || 0, searchesMonth: led.searches || 0, modes: MODES };
}

const bad = (res, h, msg) => h.json(res, 400, { error: msg, code: "search_invalid" });

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/search/, "");
  if (req.method === "GET" && (p === "" || p === "/")) return h.json(res, 200, view(h));
  if (req.method === "DELETE" && p.startsWith("/key/")) {
    const eng = p.slice("/key/".length);
    if (!ENGINES[eng]) return bad(res, h, "unknown search engine");
    await h.setSecret(secretId(eng), null);
    h.emit("log", { text: `${ENGINES[eng].name} key removed.` });
    return h.json(res, 200, view(h));
  }
  if (req.method !== "POST") return false;

  if (p === "/settings") {
    try { saveSearchSettings(body || {}); } catch (e) { return h.json(res, e.status || 400, { error: e.message }); }
    return h.json(res, 200, view(h));
  }
  if (p === "/toggle") {
    const mode = String(body.mode || "");
    if (!MODES.includes(mode)) return bad(res, h, "mode must be single, council or mission");
    saveSearchSettings({ on: { [mode]: !!body.on } });
    const v = view(h);
    if (body.on && !v.active.engine) h.emit("log", { text: `Search the web is on for ${mode}, but ${v.active.reason}` });
    return h.json(res, 200, v);
  }

  // paste → one test search → vault. The key is read once from the body and never touches a log or an event.
  if (p === "/key") {
    const eng = String(body.engine || "");
    const e = ENGINES[eng];
    if (!e) return bad(res, h, "unknown search engine");
    const key = String(body.key || "").trim();
    if (!key) return bad(res, h, "Paste the key first.");
    if (key.length > 4000 || /\s/.test(key)) return bad(res, h, "That does not look like an API key (it has spaces or is far too long).");
    const prev = h.getSecret(secretId(eng)); // stored value only, restored if the new key is refused
    try { await h.setSecret(secretId(eng), { key }); } catch (err) { return h.json(res, err.status || 400, { error: err.message, code: err.code }); }
    try {
      const r = await runSearch("Meldmind key check", { engine: eng, maxResults: 1, role: "key-check" });
      h.emit("log", { text: `${e.name} key saved to the vault (one test search, $${r.cost.toFixed(4)}).` });
      return h.json(res, 200, { ok: true, engine: eng, kept: true, label: "Key works", tone: "green", detail: `${r.sources.length} result returned.`, masked: engineMasked(eng), cost: r.cost, view: view(h) });
    } catch (err) {
      await h.setSecret(secretId(eng), prev && !prev.fromEnv ? prev : null);
      const tone = err.rejected || err.network ? "red" : "amber";
      const label = err.rejected ? "Key rejected" : err.network ? `Could not reach ${e.name}` : "Not saved";
      return h.json(res, 200, { ok: false, engine: eng, kept: false, label, tone, detail: err.message, masked: engineMasked(eng), view: view(h) });
    }
  }

  // one search by hand (a click in Settings; costs one search like any other)
  if (p === "/test") {
    const q = String(body.q || "").trim();
    if (!q) return bad(res, h, "Type something to search for.");
    const pick = body.engine ? (ENGINES[body.engine] ? { engine: body.engine, name: ENGINES[body.engine].name } : { engine: null, reason: "unknown search engine" }) : resolveEngine({});
    if (!pick.engine || pick.native) return h.json(res, 400, { error: pick.reason || "Pick Tavily, Brave or Serper for a test search." });
    try {
      const r = await runSearch(q, { engine: pick.engine, role: "test" });
      return h.json(res, 200, { ok: true, engine: r.engine, name: r.name, demo: r.demo, sources: r.sources, ms: r.ms, cost: r.cost });
    } catch (err) { return h.json(res, err.status === 402 ? 402 : 400, { error: err.message, engine: pick.engine }); }
  }
  return false;
}
