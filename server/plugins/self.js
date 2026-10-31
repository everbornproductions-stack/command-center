// 0.4.29: Ask about Meldmind. POST /api/self/ask { question } -> { answer, facts: [...], from, suggest, provider }.
// Read-only: it gathers Meldmind's own records (ledger, recent missions, the worker pool, provider lights, a few
// settings, What's new, the help articles), asks the cheapest working AI to phrase a short answer from those facts
// only, and falls back to a plain template when no AI is available. It never changes anything. The question is not
// written to the log. The engine is server/self-talk.js.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../paths.js";
import { askSelf, missionFacts, pickProviders, MAX_Q } from "../self-talk.js";
import { getStatus, allStatus } from "../health.js";
import { allEntries } from "../ledger.js";
import { FREE_TIERS, fallbackSettings, trouble, freeNow } from "../fallback.js";
import { freeOnlyOn } from "../free-first.js";
import { listWorkers, workersView, apiProviderList, workerUsable, apiId } from "../worker-pool.js";
import { HELP_DIR, loadHelp, searchArticles, hitOf } from "../help.js";
import { estimateCost } from "../registry.js";

export const id = "self";

// One stable summarizer, so the store's per-file memo is reused (an O(1) poll after warm-up, LESSONS 2026-10-28).
const SUMMARY = (m) => missionFacts(m);

let newsCache = null;
function whatsNew() {
  try {
    const file = path.join(ROOT, "docs", "WHATS-NEW.json");
    const st = fs.statSync(file);
    if (!newsCache || newsCache.mtime !== st.mtimeMs) newsCache = { mtime: st.mtimeMs, value: JSON.parse(fs.readFileSync(file, "utf8")) };
    return newsCache.value;
  } catch { return {}; }
}

async function workerRows() {
  // The full view checks what is installed; give it a moment, else use the stored list (resting and off are stored).
  const quick = (async () => listWorkers({ apiProviders: await apiProviderList() }))();
  try {
    const v = await Promise.race([workersView(), new Promise((r) => setTimeout(() => r(null), 1500))]);
    return v?.workers || await quick;
  } catch { return quick.catch(() => []); }
}

async function sources(h, question) {
  const c = h.ctx();
  let missions = [];
  try { missions = (c.store.listMissions(SUMMARY) || []).filter(Boolean).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, 8); } catch { /* none */ }
  const status = {};
  try {
    const all = allStatus();
    for (const [pid, st] of Object.entries(all)) {
      const t = trouble(pid);
      status[pid] = { status: st.status, detail: st.detail || "", trouble: t ? (t.reason || t.kind || "") : "" };
    }
  } catch { /* none */ }
  let help = [];
  try { help = searchArticles(loadHelp(HELP_DIR).articles, question, 2).map(hitOf); } catch { /* none */ }
  const s = h.settings() || {};
  let fb = {};
  try { fb = fallbackSettings(); } catch { /* defaults */ }
  return {
    ledger: (allEntries() || []).slice(-400),
    missions,
    workers: await workerRows(),
    status,
    providers: h.PROVIDERS,
    settings: { defaultMode: s.defaultMode || "balanced", freeOnly: freeOnlyOn(), speechPaid: s.speechPaid === true, fallbackOn: fb.on !== false, demo: Object.values(h.PROVIDERS).some((p) => p?.demo) },
    news: whatsNew(),
    version: h.VERSION,
    help,
  };
}

function candidates(h) {
  return pickProviders({
    providers: h.PROVIDERS,
    hasSecret: h.hasSecret,
    statusOf: getStatus,
    troubled: (pid) => !!trouble(pid),
    usable: (pid) => workerUsable(apiId(pid)),
    freeOnly: freeOnlyOn(),
    freeNow,
    freeModels: Object.fromEntries(Object.entries(FREE_TIERS).map(([k, v]) => [k, v.models])),
    priceOf: (model) => estimateCost(model, 3000, 300),
  });
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/self\/?/, "");
  if (req.method === "POST" && p === "ask") {
    const question = String(body?.question || "").replace(/\s+/g, " ").trim();
    if (!question) return h.json(res, 400, { error: "Type a question first." });
    if (question.length > MAX_Q) return h.json(res, 400, { error: `Keep the question under ${MAX_Q} characters.` });
    try {
      const out = await askSelf(question, {
        sources: (q) => sources(h, q),
        candidates: () => candidates(h),
        complete: (opts) => h.complete(opts),
        record: (entry) => h.recordCall(entry),
      });
      return h.json(res, 200, out);
    } catch (e) {
      return h.json(res, e.status || 500, { error: e.status ? e.message : "Meldmind could not look that up just now." });
    }
  }
  return false;
}
