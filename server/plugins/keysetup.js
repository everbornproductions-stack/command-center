// Guided API-key setup (Phase 1): one provider at a time, with where to get the key, what it looks
// like, paste, a test call, and only then the vault. A key that the provider rejects is never kept:
// the previous key (if any) is put back. A key that works but has no credits is kept (amber) with a
// pointer to the billing page. Keys are never logged, never echoed back, and never written anywhere
// but the vault. Progress (which providers were linked or skipped) is the "keysetup.state" document.
import { PROVIDERS } from "../registry.js";
import { getSecret, setSecret, maskedKey, vaultInfo } from "../vault.js";
import { checkProvider, getStatus } from "../health.js";

export const id = "keysetup";
const KIND = "keysetup.state";
export const DEFAULTS = { startedAt: null, completedAt: null, skipped: [], linked: [] };

// Per-provider walkthrough. `steps` are shown in order; `looks` is the shape of a real key; `free`
// says whether a free allowance exists; `billing` is named only when a step needs it.
export const GUIDES = {
  anthropic: { why: "Claude: strong writing, reasoning and code. The QA and chair roles in councils and missions often land here.", looks: "sk-ant-api03-...", free: false,
    steps: ["Sign in to the Anthropic console (platform.claude.com).", "Open Billing and add credit (Claude keys only work with a positive balance).", "Open API keys, click Create Key, give it a name, copy it once.", "Paste it below. If your organisation uses workspaces, add the workspace ID too (optional)."] },
  openai: { why: "ChatGPT: all-rounder for writing, analysis and math; GPT models often chair councils.", looks: "sk-proj-...", free: false,
    steps: ["Sign in to the OpenAI platform (platform.openai.com).", "Open Billing and add credit (a few dollars is enough to start).", "Open API keys, click Create new secret key, copy it once.", "Paste it below."] },
  xai: { why: "Grok: research and current-events answers with a strong reasoning model.", looks: "xai-...", free: false,
    steps: ["Sign in to the xAI console (console.x.ai).", "Add credits under Billing (new accounts sometimes get a starter allowance).", "Open API keys, click Create API key, copy it once.", "Paste it below."] },
  google: { why: "Google Gemini: fast, cheap, long context, and a free allowance for small jobs.", looks: "AIza...", free: true,
    steps: ["Sign in to Google AI Studio (aistudio.google.com).", "Click Get API key, then Create API key (a Google Cloud project is made for you).", "Copy the key (it starts with AIza).", "Paste it below. The free tier works without a card."] },
  perplexity: { why: "Perplexity: live web answers with sources; the router picks it for research.", looks: "pplx-...", free: false,
    steps: ["Sign in to Perplexity and open Settings, then API.", "Buy API credits (prepaid).", "Click Generate under API keys, copy it once.", "Paste it below. The key is verified on the first real call."] },
  openrouter: { why: "OpenRouter: one key for 300+ models, exact billed costs, and the fallback route when another provider is out of credits.", looks: "sk-or-v1-...", free: true,
    steps: ["Sign in to openrouter.ai.", "Open Credits and add a prepaid amount (free models work without credits).", "Open Keys, click Create key, copy it once.", "Paste it below."] },
  deepseek: { why: "DeepSeek: very cheap reasoning and code, with off-peak discounts the scheduler can use.", looks: "sk-...", free: false,
    steps: ["Sign in to the DeepSeek platform (platform.deepseek.com).", "Top up a small balance under Billing.", "Open API keys, click Create new API key, copy it once.", "Paste it below."] },
  groq: { why: "Groq: the fastest answers for simple jobs, with a free tier.", looks: "gsk_...", free: true,
    steps: ["Sign in to the Groq console (console.groq.com).", "Open API Keys, click Create API Key, copy it once.", "Paste it below. The free tier has rate limits; add a card later for more."] },
  mistral: { why: "Mistral: solid European models at low prices, good for writing and classification.", looks: "a 32-character key", free: true,
    steps: ["Sign in to the Mistral console (console.mistral.ai).", "Pick a plan under Billing (the Experiment plan is free with limits).", "Open API keys, click Create new key, copy it once.", "Paste it below."] },
  elevenlabs: { why: "ElevenLabs: voice-overs for reels and videos; credits are tracked live.", looks: "sk_...", free: true,
    steps: ["Sign in to ElevenLabs.", "Open Settings, then API keys, click Create API key, copy it once.", "Paste it below. The free plan includes a monthly character allowance."] },
  kling: { why: "Kling: AI video generation for the Studio pipeline.", looks: "an access key and a secret key", free: false,
    steps: ["Sign in to Kling and open the developer area (app.klingai.com/global/dev).", "Create an API key pair: an access key and a secret key.", "Paste both below. Credits are tracked from what you log."] },
  syncso: { why: "Sync.so: lip-sync for music videos.", looks: "sk-...", free: false,
    steps: ["Sign in to sync.so and open the API keys page.", "Create a key, copy it once.", "Paste it below."] },
};
const GENERIC = { why: "A provider you added yourself.", looks: "the key the provider gave you", free: false, steps: ["Open the provider's key page.", "Create a key and copy it once.", "Paste it below."] };

// Pure: which providers the wizard walks through, in a sensible order (free ones early, media last).
export function setupOrder(providers) {
  const list = Object.values(providers).filter((p) => p.api && !p.demo && !p.noKey);
  const rank = (p) => (p.kind === "text" ? 0 : 1) * 100 + (GUIDES[p.id] ? 0 : 50) + (GUIDES[p.id]?.free ? 0 : 10);
  return list.sort((a, b) => rank(a) - rank(b) || Object.keys(providers).indexOf(a.id) - Object.keys(providers).indexOf(b.id)).map((p) => p.id);
}

// Pure: what a check result means for the wizard. Red that is not a network problem = refused.
export function verdict(status) {
  const st = status?.status || "grey";
  if (st === "green") return { ok: true, keep: true, label: "Key works", tone: "green" };
  if (st === "amber") return { ok: true, keep: true, label: "Key works, but check your balance", tone: "amber" };
  if (st === "red" && status?.network) return { ok: false, keep: false, label: "Could not reach the provider", tone: "red" };
  if (st === "red") return { ok: false, keep: false, label: "Key rejected", tone: "red" };
  return { ok: false, keep: false, label: "Not checked", tone: "grey" };
}

const state = (h) => { const s = { ...DEFAULTS, ...h.doc(KIND, () => ({ ...DEFAULTS })) }; s.skipped = Array.isArray(s.skipped) ? s.skipped : []; s.linked = Array.isArray(s.linked) ? s.linked : []; return s; };
const save = (h, patch) => h.putDoc(KIND, { ...state(h), ...patch });
const guideOf = (p) => GUIDES[p.id] || { ...GENERIC, why: p.custom ? GENERIC.why : `${p.name} (${p.vendor}).` };

function view(h) {
  const s = state(h);
  const order = setupOrder(h.PROVIDERS);
  const providers = order.map((pid) => {
    const p = h.PROVIDERS[pid]; const g = guideOf(p); const st = getStatus(pid);
    return { id: pid, name: p.name, vendor: p.vendor, color: p.color, kind: p.kind, custom: !!p.custom, keyHint: p.keyHint || null,
      keysUrl: p.links?.keys || p.links?.console || null, billingUrl: p.links?.billing || null, consoleUrl: p.links?.console || null,
      why: g.why, looks: g.looks, free: !!g.free, steps: g.steps, fields: { secret: pid === "kling", workspaceId: pid === "anthropic" },
      keyed: h.hasSecret(pid, p.keyEnv), masked: maskedKey(pid, p.keyEnv), status: { status: st.status, detail: st.detail || "" },
      skipped: s.skipped.includes(pid) };
  });
  return { ...s, providers, total: providers.length, linkedCount: providers.filter((p) => p.keyed).length, vault: vaultInfo() };
}

const bad = (res, h, msg) => h.json(res, 400, { error: msg, code: "keysetup_invalid" });

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/keysetup/, "");
  if (req.method === "GET" && (p === "" || p === "/")) return h.json(res, 200, view(h));
  if (req.method !== "POST") return false;
  if (p === "/start") { save(h, { startedAt: Date.now(), completedAt: null }); return h.json(res, 200, view(h)); }
  if (p === "/skip") {
    const pid = String(body.provider || "");
    if (!h.PROVIDERS[pid]) return bad(res, h, "unknown provider");
    const s = state(h); if (!s.skipped.includes(pid)) save(h, { skipped: [...s.skipped, pid] });
    return h.json(res, 200, view(h));
  }
  if (p === "/complete") { save(h, { completedAt: Date.now() }); return h.json(res, 200, view(h)); }
  if (p === "/reset") { h.putDoc(KIND, { ...DEFAULTS }); return h.json(res, 200, view(h)); }

  // paste → test call → vault. The key is read once from the body and never touches a log or an event.
  if (p === "/save") {
    const pid = String(body.provider || "");
    const prov = h.PROVIDERS[pid];
    if (!prov) return bad(res, h, "unknown provider");
    if (!prov.api || prov.demo) return bad(res, h, `${prov.name} has no API key to set up.`);
    const key = String(body.key || "").trim();
    if (!key) return bad(res, h, "Paste the key first.");
    if (key.length > 4000 || /\s/.test(key)) return bad(res, h, "That does not look like an API key (it has spaces or is far too long).");
    const value = { key };
    if (pid === "kling") { const sec = String(body.secret || "").trim(); if (!sec) return bad(res, h, "Kling needs both the access key and the secret key."); value.secret = sec; }
    const prev = getSecret(pid); // stored value only (no env fallback), restored if the new key is refused
    if (prov.custom && prev?.headers) value.headers = prev.headers;
    if (pid === "anthropic") {
      const ws = body.workspaceId !== undefined ? String(body.workspaceId || "").trim() : prev?.workspaceId || "";
      if (ws && !/^[A-Za-z0-9_-]{4,100}$/.test(ws)) return bad(res, h, "That does not look like a workspace ID (letters, digits, _ and - only).");
      if (ws) value.workspaceId = ws;
    }
    try { await setSecret(pid, value); } catch (e) { return h.json(res, e.status || 400, { error: e.message, code: e.code }); }
    const t0 = Date.now() - 1;
    const status = await checkProvider(pid);
    const v = verdict(status);
    if (!v.keep) {
      // put things back exactly as they were, then re-check so the status strip is honest
      await setSecret(pid, prev && !prev.fromEnv && !prev.managed ? prev : null);
      await checkProvider(pid);
      return h.json(res, 200, { ok: false, provider: pid, verdict: v, status: { status: status.status, detail: status.detail || "" }, kept: false, masked: maskedKey(pid, prov.keyEnv), billingUrl: prov.links?.billing || null });
    }
    const s = state(h);
    save(h, { linked: s.linked.includes(pid) ? s.linked : [...s.linked, pid], skipped: s.skipped.filter((x) => x !== pid) });
    const demoRetired = h.retireDemoIfReal ? await h.retireDemoIfReal(t0) : false;
    h.emit("log", { text: `${prov.name} key saved to the vault (${v.label.toLowerCase()}).` });
    return h.json(res, 200, { ok: true, provider: pid, verdict: v, status: { status: status.status, detail: status.detail || "" }, kept: true, masked: maskedKey(pid, prov.keyEnv), demoRetired, billingUrl: prov.links?.billing || null });
  }
  return false;
}
