// Test with personas (0.4.14): the persona panel reads an output and suggests fixes; Apply makes a
// revised output. The panel and the prompts live in server/persona-panel.js.
//   GET  /api/personas                                   the panel, output types, the smart default per type
//   GET  /api/personas/pick?kind=&text=                  who the smart default picks for this output
//   POST /api/personas/test { text, kind, personas? }    each persona's reaction, score and fixes
//   POST /api/personas/apply { text, kind, fixes }       the revised output (one fix or all of them)
// Calls go through smart fallback, the ledger and the spend caps. Nothing is sent or posted.
import * as P from "../persona-panel.js";
import { rank, cheapest } from "../router.js";
import { completeFallback } from "../fallback.js";

export const id = "personas";

const bad = (status, message) => Object.assign(new Error(message), { status });

function pickModel() {
  const m = rank({ capability: "writing", difficulty: 2, mode: "economy" })[0] || cheapest(50);
  if (!m) throw bad(400, "Add an AI key in Settings first, so the panel has an AI to read with.");
  return m;
}
async function ask(h, { system, user, maxTokens, role }) {
  const m = pickModel();
  const t0 = Date.now();
  const r = await completeFallback({ provider: m.provider, model: m.model, maxTokens, system, messages: [{ role: "user", content: user }] },
    { role, cls: { capability: "writing", difficulty: 2 }, mode: "economy", tools: false });
  try { h.recordCall?.({ provider: r.provider || m.provider, model: r.model || m.model, usage: r.usage, role, ms: Date.now() - t0 }); } catch { /* the ledger never blocks a result */ }
  return r.text || "";
}
function textOf(body) {
  const text = String(body?.text ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) throw bad(400, "There is nothing to test yet. Make something first.");
  if (text.length > P.MAX_TEXT) throw bad(400, `That is too long to test at once (${P.MAX_TEXT} characters at most).`);
  return text;
}

export async function test(h, body) {
  const text = textOf(body);
  const kind = P.normalizeKind(body?.kind, text);
  const { ids, smart } = P.pickPanel({ kind, text, personas: body?.personas });
  const out = await ask(h, { system: P.testSystem(ids, kind), user: `OUTPUT TO REVIEW:\n${text}`, maxTokens: 1800, role: "personas" });
  const reactions = P.parseReactions(out, ids);
  if (reactions.every((r) => r.missing)) throw bad(502, "The panel's answer could not be read. Try again.");
  return { kind, kindLabel: P.KINDS[kind].label, smart, personas: ids, reactions, note: "Persona reactions are simulated by an AI." };
}
export async function apply(h, body) {
  const text = textOf(body);
  const fixes = P.cleanFixes(body?.fixes);
  if (!fixes.length) throw bad(400, "Pick a fix to apply.");
  const out = P.cleanRevision(await ask(h, { system: P.FIX_SYSTEM, user: P.fixPrompt(text, fixes), maxTokens: 4000, role: "personas-fix" }));
  if (!out) throw bad(502, "The revision came back empty. Try again.");
  return { text: out, applied: fixes.length };
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/personas/, "").replace(/\/$/, "") || "/";
  try {
    if (req.method === "GET" && p === "/") return h.json(res, 200, P.panelView());
    if (req.method === "GET" && p === "/pick") { const text = url.searchParams.get("text") || ""; const kind = P.normalizeKind(url.searchParams.get("kind"), text); return h.json(res, 200, { kind, kindLabel: P.KINDS[kind].label, personas: P.smartPick(kind, text) }); }
    if (req.method === "POST" && p === "/test") return h.json(res, 200, await test(h, body));
    if (req.method === "POST" && p === "/apply") return h.json(res, 200, await apply(h, body));
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code });
  }
  return false;
}
