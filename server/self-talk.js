// 0.4.29: "Ask about Meldmind", read-only talk to Meldmind about itself (docs/flow/PLAN.md item 26, read-only part).
// The person asks things like "why did my last job cost 3 cents", "which AI did the planning", "why is Gemini resting",
// "what changed in this version" or "how do I make a spreadsheet". Meldmind answers from its OWN records only:
// the ledger (costs and providers per call), recent missions (steps, short log lines, incomplete reasons), the worker
// pool (who is resting until when), the provider lights, the settings that matter (priority, Free only, paid voice),
// What's new (docs/WHATS-NEW.json) and the help articles.
//
// Privacy: the context is built from short summaries only. It never holds a key, a file body, a step's output, an
// answer, an attached file or a private run (private missions are counted, never shown). Every line goes through the
// secret mask and the private-number mask before it is used, so a key pasted into a title still comes out hidden.
//
// Read-only: this file never changes a setting, a helper or a provider. It can suggest a setting with a button that
// opens the right Settings section; the person makes any change there.
//
// The AI that phrases the answer is the cheapest one that works right now (this PC first, then free allowances, then
// the cheapest paid model, and never a paid one while Free only is on). With no AI, or when the AI fails, the answer
// is a plain template filled from the same facts. Nothing here sends anything anywhere except that one AI call.
import { redact } from "./redact-text.js";
import { maskPrivate } from "./mask-private.js";

export const MAX_Q = 600;
const MAX_FACTS = 14;

// ---------- privacy ----------
// Long random-looking tokens (ids from a provider, keys of an unknown shape) are hidden too. Mission ids (m-...) and
// plain words are kept.
const TOKENISH = /\b(?=[A-Za-z0-9_-]{28,}\b)(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]+\b/g;
const KEY_WORDS = /\b(api[_ -]?key|secret|password|passwd|token|bearer)\s*[:=]\s*\S+/gi;
export function scrub(text, max = 200) {
  const s = maskPrivate(redact(String(text ?? ""), 4000))
    .replace(KEY_WORDS, (_m, w) => `${w}: [hidden]`)
    .replace(TOKENISH, "[hidden]")
    .replace(/[—–]/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

// ---------- small helpers ----------
export const money = (n) => {
  const v = Number(n) || 0;
  if (v === 0) return "$0";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
};
const cents = (n) => {
  const v = Number(n) || 0;
  if (v > 0 && v < 1) { const c = v * 100; return `${c < 0.1 ? c.toFixed(3) : c < 1 ? c.toFixed(2) : c.toFixed(1)} cents`; }
  return money(v);
};
const clock = (ms) => { try { return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); } catch { return ""; } };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const lower = (s) => String(s || "").toLowerCase();

// ---------- what the question is about ----------
const TOPIC_RX = {
  cost: /\b(cost|costs|cent|cents|price|priced|spend|spent|spending|charge|charged|bill|billed|expensive|cheap|money|pay|paid|dollar|dollars|credits?)\b|\$/i,
  who: /\b(which|what|who)\b.*\b(ai|model|provider|helper|planning|planned|plan|did|wrote|answered)\b|\bplann(er|ing|ed)\b|\bassembl/i,
  rest: /\b(rest|resting|rested|sleep|sleeping|limit|limits|usage|cooldown|cool down|benched|paused|unavailable|out of)\b/i,
  status: /\b(status|light|lights|red|amber|green|grey|gray|down|offline|broken|working|connected|reach|rejected|key|keys)\b/i,
  news: /\b(what changed|changed|change log|changelog|new in|what's new|whats new|what is new|version|update|updated|release|released)\b/i,
  howto: /\b(how do i|how can i|how to|how would i|where do i|where is|where can|can i|make|create|build|set up|setup|turn on|turn off|use)\b/i,
  settings: /\b(setting|settings|mode|priority|free only|free first|voice|paid voice|fallback|savings|balanced|quality)\b/i,
  mission: /\b(job|jobs|mission|missions|run|runs|task|tasks|step|steps|last|latest|recent|fail|failed|failing|incomplete|not done|didn't|did not|error|stuck)\b/i,
};
export function topicsOf(question) {
  const q = String(question || "");
  const out = new Set();
  for (const [k, rx] of Object.entries(TOPIC_RX)) if (rx.test(q)) out.add(k);
  // "why is Gemini resting" is about helpers, not about how to do something
  if (out.has("rest") || out.has("status")) out.delete("howto");
  if (out.has("cost") || out.has("who")) out.add("mission");
  return out;
}

// Names the person may use for an AI or a helper ("Gemini", "Claude", "Grok Bot").
function nameWords(label) {
  const w = lower(label).replace(/\(.*?\)/g, " ").split(/[^a-z0-9]+/).filter((x) => x.length >= 3 && !["the", "cli", "api", "app", "helper", "google", "free", "pro"].includes(x));
  return [...new Set(w)];
}
export function namedIn(question, rows = []) {
  const q = lower(question);
  return rows.filter((r) => r && nameWords(r.label || r.name || r.id).some((w) => new RegExp(`\\b${w}\\b`).test(q)));
}

// ---------- sources ----------
// The summary kept per mission. Never the prompt body, an output, an answer, a file or the thread.
export function missionFacts(m) {
  if (!m || typeof m !== "object") return null;
  if (m.private) return { id: m.id, private: true, startedAt: m.startedAt || 0 };
  const tasks = Array.isArray(m.tasks) ? m.tasks : [];
  return {
    id: String(m.id || ""), kind: m.kind || "mission", title: scrub(m.title || m.prompt || "", 80), status: m.status || "",
    startedAt: m.startedAt || 0, finishedAt: m.finishedAt || 0, cost: Number(m.cost) || 0, mode: m.mode || "",
    planner: m.planner?.provider ? { provider: m.planner.provider, model: m.planner.model || "", standIn: m.planner.standIn ? { for: m.planner.standIn.for, reason: scrub(m.planner.standIn.reason, 80) } : null } : null,
    assembler: m.assembler?.provider ? { provider: m.assembler.provider, model: m.assembler.model || "" } : null,
    steps: tasks.slice(0, 12).map((t) => ({ title: scrub(t.title, 60), provider: t.provider || "", model: t.model || "", status: t.status || "", cost: Number(t.cost) || 0, error: t.error ? scrub(t.error, 120) : "", tries: Array.isArray(t.attempts) ? t.attempts.length : 0 })),
    incomplete: Array.isArray(m.incomplete?.reasons) ? m.incomplete.reasons.slice(0, 4).map((r) => ({ title: scrub(r.title, 60), reason: scrub(r.reason, 140) })) : [],
    log: Array.isArray(m.log) ? m.log.slice(-3).map((l) => scrub(typeof l === "string" ? l : l?.text, 140)).filter(Boolean) : [],
    error: m.error ? scrub(m.error, 140) : "",
  };
}

// ---------- the context ----------
/**
 * Build the compact, privacy-safe context for one question.
 * src = {
 *   ledger: [entry], missions: [missionFacts or raw missions, any order], workers: [worker rows from worker-pool.js],
 *   status: { [providerId]: { status, detail } }, providers: { [id]: { id, name, kind, demo } },
 *   settings: { defaultMode, freeOnly, speechPaid, fallbackOn, demo }, news: { [version]: { bullets } }, version,
 *   help: [{ id, title, summary, excerpt }] (already searched for this question), now
 * }
 * Returns { topics, facts: [{ source, label, text }], suggest: [{ label, focus?, article? }], named: { workers, providers } }.
 */
export function buildContext(question, src = {}) {
  const now = src.now || Date.now();
  const topics = topicsOf(question);
  const facts = [];
  const suggest = [];
  const add = (source, label, text) => { const t = scrub(text, 320); if (t) facts.push({ source, label: scrub(label, 60), text: t }); };
  const pname = (pid) => scrub(src.providers?.[pid]?.name || workerLabel(pid) || pid || "an AI", 40);
  const workerLabel = (pid) => (src.workers || []).find((w) => w.id === pid || w.id === `api:${pid}`)?.label || "";
  const any = topics.size === 0;

  // Missions, newest first. Private runs are counted only.
  const all = (src.missions || []).map((m) => (m && m.steps ? m : missionFacts(m))).filter(Boolean).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  const hiddenPrivate = all.filter((m) => m.private).length;
  const open = all.filter((m) => !m.private);
  const idInQ = String(question || "").match(/\bm-[a-z0-9-]{3,}\b/i)?.[0];
  const last = (idInQ && open.find((m) => m.id === idInQ)) || open[0] || null;
  const ledger = Array.isArray(src.ledger) ? src.ledger : [];
  const isDemo = (e) => String(e?.provider || "").startsWith("demo-");

  if (last && (any || topics.has("mission") || topics.has("cost") || topics.has("who"))) {
    const lbl = `last ${last.kind === "council" ? "council" : "mission"} ${last.id}`;
    const when = last.startedAt ? `, started ${new Date(last.startedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "";
    add("mission", lbl, `Last ${last.kind === "council" ? "council" : "mission"} ${last.id}: "${last.title}", status ${last.status || "unknown"}, cost ${money(last.cost)}${when}.`);
    if (last.planner) add("mission", lbl, `Planning on ${last.id} was done by ${pname(last.planner.provider)}${last.planner.model ? ` (${last.planner.model})` : ""}${last.planner.standIn ? `, standing in for ${pname(last.planner.standIn.for)} because it was ${last.planner.standIn.reason}` : ""}.`);
    if (last.assembler) add("mission", lbl, `The final answer on ${last.id} was put together by ${pname(last.assembler.provider)}${last.assembler.model ? ` (${last.assembler.model})` : ""}.`);
    if (last.steps?.length) add("mission", lbl, `Steps on ${last.id}: ${last.steps.slice(0, 6).map((s) => `${s.title} by ${pname(s.provider)} (${s.status}${s.cost ? `, ${money(s.cost)}` : ""}${s.tries ? `, ${plural(s.tries + 1, "try", "tries")}` : ""})`).join("; ")}.`);
    if (last.incomplete?.length) add("mission", lbl, `Not finished on ${last.id}: ${last.incomplete.map((r) => `${r.title}: ${r.reason}`).join(" ")}`);
    if (last.error) add("mission", lbl, `Error on ${last.id}: ${last.error}`);
    if ((topics.has("mission") || any) && last.log?.length) add("mission", lbl, `Last log lines on ${last.id}: ${last.log.join(" | ")}`);
    // The ledger lines for that mission: count, total and who was paid what.
    const calls = ledger.filter((e) => e && e.missionId === last.id);
    if (calls.length) {
      const by = {};
      for (const e of calls) {
        const k = e.provider || "unknown";
        by[k] ||= { n: 0, cost: 0, roles: new Set(), free: 0 };
        by[k].n += 1; by[k].cost += isDemo(e) ? 0 : (Number(e.cost) || 0); if (e.role) by[k].roles.add(e.role); if (e.free) by[k].free += 1;
      }
      const total = Object.values(by).reduce((s, x) => s + x.cost, 0);
      const parts = Object.entries(by).sort((a, b) => b[1].cost - a[1].cost).map(([pid, x]) => `${pname(pid)} ${plural(x.n, "call")} ${money(x.cost)}${x.roles.size ? ` (${[...x.roles].slice(0, 3).join(", ")})` : ""}${x.free ? `, ${x.free} free` : ""}`);
      add("ledger", `ledger ${plural(calls.length, "call")}`, `Ledger for ${last.id}: ${plural(calls.length, "call")}, ${money(total)} in all (${cents(total)}): ${parts.join("; ")}.`);
    }
  }
  if (hiddenPrivate && (any || topics.has("mission"))) add("mission", "private runs", `${plural(hiddenPrivate, "private run")} not shown here.`);

  // Ledger in general: today, this month, the latest calls.
  if (topics.has("cost") || any) {
    const real = ledger.filter((e) => e && !isDemo(e));
    const d0 = new Date(now); const startDay = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()).getTime(); const startMonth = new Date(d0.getFullYear(), d0.getMonth(), 1).getTime();
    const sum = (from) => real.filter((e) => (e.ts || 0) >= from).reduce((s, e) => s + (Number(e.cost) || 0), 0);
    const today = real.filter((e) => (e.ts || 0) >= startDay);
    if (ledger.length) add("ledger", `ledger ${plural(today.length, "call")} today`, `Spent today: ${money(sum(startDay))} over ${plural(today.length, "call")}. This month: ${money(sum(startMonth))}.${ledger.some(isDemo) ? " Practice AI calls cost nothing." : ""}`);
    const recent = ledger.slice(-4).reverse().map((e) => `${pname(e.provider)}${e.model ? ` ${e.model}` : ""}${e.role ? ` for ${e.role}` : ""}: ${isDemo(e) ? "$0 (practice)" : e.free ? "$0 (free)" : money(e.cost)}`);
    if (recent.length) add("ledger", "latest ledger lines", `Latest calls: ${recent.join("; ")}.`);
    else if (Array.isArray(src.ledger)) add("ledger", "ledger", "The ledger has no AI calls yet, so nothing has been spent.");
    suggest.push({ label: "Change the default priority", focus: "#s-mode" });
  }

  // The worker pool: resting and switched-off helpers, and any helper named in the question.
  const workers = Array.isArray(src.workers) ? src.workers : [];
  const namedWorkers = namedIn(question, workers);
  if (workers.length && (any || topics.has("rest") || topics.has("who") || topics.has("status") || namedWorkers.length)) {
    const show = namedWorkers.length ? namedWorkers : workers.filter((w) => w.status === "resting" || w.status === "off");
    for (const w of show.slice(0, 4)) {
      const until = w.restingUntil && w.restingUntil > now ? `resting until ${clock(w.restingUntil)}` : "";
      const state = until || lower(w.statusLabel || w.status || "unknown");
      add("workers", "worker pool", `Helper ${w.label}: ${state}${w.lastError ? `. Last limit message: ${w.lastError}` : ""}${w.status === "resting" && w.cooldownHours ? `. It rests ${w.cooldownHours} h after a limit unless the AI says when it is back` : ""}.`);
    }
    const ready = workers.filter((w) => w.status === "ready").map((w) => w.label);
    add("workers", "worker pool", `Helpers ready now: ${ready.length ? ready.slice(0, 6).join(", ") : "none"} (${ready.length} of ${workers.length}).`);
    if (topics.has("rest") || namedWorkers.length) suggest.push({ label: "Open Your AI helpers", focus: "#cc-helpers" });
  }

  // Provider lights: the named ones, else any that are not green.
  const status = src.status || {};
  const provRows = Object.values(src.providers || {}).filter((p) => p && p.kind === "text" && !p.demo).map((p) => ({ id: p.id, label: p.name || p.id }));
  const namedProv = namedIn(question, provRows);
  if (topics.has("status") || topics.has("rest") || namedProv.length || any) {
    const ids = namedProv.length ? namedProv.map((p) => p.id) : Object.keys(status).filter((id) => status[id] && ["red", "amber"].includes(status[id].status) && src.providers?.[id] && !src.providers[id].demo);
    for (const id of ids.slice(0, 4)) {
      const st = status[id] || { status: "grey", detail: "no key" };
      add("status", "provider lights", `${pname(id)} light: ${st.status || "grey"}${st.detail ? ` (${st.detail})` : ""}${st.trouble ? `. Smart fallback is skipping it for now: ${st.trouble}` : ""}.`);
    }
    if (namedProv.length || topics.has("status")) suggest.push({ label: "Open My AIs", focus: "#settings-keys" });
  }

  // Settings that matter for cost and routing.
  const s = src.settings || {};
  if (src.settings && (topics.has("settings") || topics.has("cost") || any)) {
    const PRI = { savings: "Max savings", economy: "Max savings", balanced: "Balanced", quality: "Max quality", fast: "Fastest" };
    add("settings", "settings", `Settings: priority ${PRI[s.defaultMode] || s.defaultMode || "Balanced"}, Free only ${s.freeOnly ? "on (nothing is charged)" : "off (free AIs still go first)"}, paid voice ${s.speechPaid ? "on" : "off"}, smart fallback ${s.fallbackOn === false ? "off" : "on"}${s.demo ? ", practice AIs on" : ""}.`);
    if (/voice/i.test(question)) suggest.push({ label: "Open Voice settings", focus: "#vo-settings" });
  }

  // What's new in this version.
  if (topics.has("news") || any) {
    const v = String(src.version || "");
    const entry = src.news?.[v] || (src.news ? src.news[Object.keys(src.news).sort(cmpVer).pop()] : null);
    const ver = src.news?.[v] ? v : (src.news ? Object.keys(src.news).sort(cmpVer).pop() : v);
    if (entry?.bullets?.length) add("news", `What's new ${ver}`, `What's new in ${ver}: ${entry.bullets.slice(0, any ? 2 : 5).join(" ")}`);
    else if (v) add("news", "version", `This is Meldmind ${v}.`);
  }

  // Help articles found for the question.
  if ((topics.has("howto") || any || !facts.length) && Array.isArray(src.help)) {
    for (const h of src.help.slice(0, 2)) {
      const body = String(h.excerpt || h.summary || "").replace(/[#*`>_]+/g, " ").replace(/\s+/g, " ").trim();
      const text = body.toLowerCase().startsWith(String(h.title || "").toLowerCase()) ? body.slice(String(h.title).length).trim() : body;
      add("help", `help: ${h.title}`, `Help guide "${h.title}": ${text || h.summary || ""}`);
      if (h.id && !suggest.some((x) => x.article)) suggest.push({ label: `Open the guide: ${scrub(h.title, 40)}`, article: h.id });
    }
  }

  return { topics: [...topics], facts: facts.slice(0, MAX_FACTS), suggest: dedupe(suggest).slice(0, 3), named: { workers: namedWorkers.map((w) => w.id), providers: namedProv.map((p) => p.id) }, last: last ? last.id : null };
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((x) => { const k = x.focus || x.article || x.label; if (seen.has(k)) return false; seen.add(k); return true; });
}
function cmpVer(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}

// "From: last mission m-..., ledger 3 calls, worker pool"
export function fromLine(facts = []) {
  const labels = [...new Set(facts.map((f) => f.label).filter(Boolean))];
  return labels.length ? `From: ${labels.join(", ")}` : "From: nothing on record";
}

// ---------- the no-AI answer ----------
/** A short plain answer made only from the facts, for when no AI is available or the AI failed. */
export function templateAnswer(question, ctxOut = {}) {
  const facts = ctxOut.facts || [];
  const topics = new Set(ctxOut.topics || topicsOf(question));
  const pick = (source, rx) => facts.filter((f) => f.source === source && (!rx || rx.test(f.text)));
  const NOT_FOUND = "I could not find anything about that in Meldmind's own records on this computer. Try asking about your last job, its cost, your AI helpers, or what changed in this version.";
  if (!topics.size) return facts[0] ? `${NOT_FOUND} Here is what I do know: ${facts[0].text}` : NOT_FOUND;
  const lines = [];
  const take = (list, n = 1) => { for (const f of list.slice(0, n)) if (!lines.includes(f.text)) lines.push(f.text); };
  if (topics.has("cost")) { take(pick("ledger", /^Ledger for/)); take(pick("mission", /^Last (mission|council)/)); if (!lines.length) take(pick("ledger")); }
  if (topics.has("who")) take(pick("mission", /^(Planning|The final answer|Steps)/), 2);
  if (topics.has("rest") || (ctxOut.named?.workers || []).length) take(pick("workers", /^Helper /), 2);
  if (topics.has("status") || (ctxOut.named?.providers || []).length) take(pick("status"), 2);
  if (topics.has("news")) take(pick("news"));
  if (topics.has("settings")) take(pick("settings"));
  if (topics.has("mission") && !topics.has("cost")) { take(pick("mission", /^Not finished|^Error/)); take(pick("mission", /^Last (mission|council)/)); }
  if (topics.has("howto") || !lines.length) take(pick("help"), 1);
  if (!lines.length) take(facts, 2);
  if (!lines.length) return NOT_FOUND;
  return lines.slice(0, 3).join(" ");
}

// ---------- choosing the AI ----------
/**
 * Candidate AIs, cheapest first: 0 this PC (no key), 1 a free allowance, 3 paid (cheapest model). Practice AIs,
 * subscription apps, red lights, benched or switched-off providers are left out, and paid ones too while Free only is on.
 * deps = { providers, hasSecret(id, keyEnv), statusOf(id), troubled(id), usable(id), freeOnly, freeNow(id, model), freeModels: { [id]: [model] }, priceOf(model) }
 */
export function pickProviders(deps = {}) {
  const out = [];
  for (const p of Object.values(deps.providers || {})) {
    if (!p || p.kind !== "text" || p.demo || String(p.id || "").startsWith("demo-") || String(p.id || "").startsWith("plan-")) continue;
    const local = !!p.custom && !!p.noKey;
    if (!local && !p.noKey && typeof deps.hasSecret === "function" && !deps.hasSecret(p.id, p.keyEnv)) continue;
    const st = typeof deps.statusOf === "function" ? deps.statusOf(p.id) : null;
    if (st?.status === "red") continue;
    if (typeof deps.troubled === "function" && deps.troubled(p.id)) continue;
    if (typeof deps.usable === "function" && !deps.usable(p.id)) continue;
    const models = (p.models || []).filter((m) => m && m.id && m.kind !== "image" && m.kind !== "embed");
    if (!models.length) continue;
    const freeIds = (deps.freeModels || {})[p.id] || [];
    const freeModel = models.find((m) => freeIds.includes(m.id) && (typeof deps.freeNow !== "function" || deps.freeNow(p.id, m.id)));
    if (local) { out.push({ providerId: p.id, model: (models.find((m) => m.default) || models[0]).id, tier: 0, cost: 0 }); continue; }
    if (freeModel) { out.push({ providerId: p.id, model: freeModel.id, tier: 1, cost: 0 }); continue; }
    if (deps.freeOnly) continue;
    const price = (m) => { try { return typeof deps.priceOf === "function" ? Number(deps.priceOf(m.id)) || 0 : 0; } catch { return 0; } };
    const cheapest = [...models].sort((a, b) => price(a) - price(b) || (b.tier === "economy") - (a.tier === "economy"))[0];
    out.push({ providerId: p.id, model: cheapest.id, tier: 3, cost: price(cheapest) });
  }
  return out.sort((a, b) => a.tier - b.tier || a.cost - b.cost);
}

export const SYSTEM = [
  "You are Meldmind, a desktop app, answering a question about yourself.",
  "Use ONLY the facts below. They are Meldmind's own records on this computer.",
  "If the facts do not answer the question, say that Meldmind's records do not show it, and say what the facts do show.",
  "Never invent numbers, names, times, steps or settings. Keep amounts exactly as written.",
  "Answer in two to four short, plain sentences. No headings, no lists, no dashes as punctuation.",
  "You cannot change anything. If a setting would help, name it and say it is in Settings.",
].join(" ");

/**
 * Answer one question. deps = { sources(question) -> src (async), candidates() -> [pick], complete(opts) -> { text, usage },
 * record(entry) } . Returns { answer, facts, from, suggest, provider, model, source: "ai" | "facts" }.
 */
export async function askSelf(question, deps = {}) {
  const q = String(question || "").replace(/\s+/g, " ").trim();
  if (!q) throw Object.assign(new Error("Type a question first."), { status: 400 });
  if (q.length > MAX_Q) throw Object.assign(new Error(`Keep the question under ${MAX_Q} characters.`), { status: 400 });
  const src = (await deps.sources?.(q)) || {};
  const c = buildContext(q, src);
  const base = { facts: c.facts, from: fromLine(c.facts), suggest: c.suggest, topics: c.topics };
  const picks = typeof deps.candidates === "function" ? (deps.candidates() || []) : [];
  if (picks.length && typeof deps.complete === "function" && c.facts.length) {
    const factText = c.facts.map((f, i) => `${i + 1}. ${f.text}`).join("\n");
    for (const pick of picks.slice(0, 2)) {
      const t0 = Date.now();
      try {
        const out = await deps.complete({ provider: pick.providerId, model: pick.model, system: `${SYSTEM}\n\nFacts:\n${factText}`, messages: [{ role: "user", content: scrub(q, MAX_Q) }], maxTokens: 300 });
        const text = scrub(out?.text || "", 1200);
        if (!text) continue;
        try { deps.record?.({ provider: pick.providerId, model: pick.model, usage: { ...(out.usage || { input: 0, output: 0 }), free: pick.tier <= 1 }, role: "self-talk", ms: Date.now() - t0 }); } catch { /* the answer stands */ }
        return { ...base, answer: text, provider: pick.providerId, model: pick.model, source: "ai", free: pick.tier <= 1 };
      } catch { /* try the next one, then the template */ }
    }
  }
  return { ...base, answer: templateAnswer(q, c), provider: null, model: null, source: "facts" };
}
