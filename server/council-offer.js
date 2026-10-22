// Council wording and the one-key council (0.4.17).
//
// A council needs answers from different AI companies. Two keys from two companies
// (Claude and ChatGPT, say) give a council. One OpenRouter key also gives one: OpenRouter
// sells models from several companies under one key, so the council seats one model from
// each family (Claude, ChatGPT, Gemini, Grok) through OpenRouter. One key from one company
// is one AI, with no peer review.
//
// Pure: the caller passes the provider registry and a keyed test, so this file has no
// imports and the tests need no server.

// The families one OpenRouter key can seat, in seat order. ns is the OpenRouter id prefix.
export const OPENROUTER_FAMILIES = [
  { provider: "anthropic", ns: "anthropic", family: "Claude" },
  { provider: "openai", ns: "openai", family: "ChatGPT" },
  { provider: "google", ns: "google", family: "Gemini" },
  { provider: "xai", ns: "x-ai", family: "Grok" },
];

// Short names people know. Anything else uses the provider's own name.
const COMPANY = { anthropic: "Claude", openai: "ChatGPT", google: "Gemini", xai: "Grok", openrouter: "OpenRouter" };

function listNames(names) {
  if (names.length <= 1) return names.join("");
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// The model each family offers for a council seat: the balanced model for most jobs,
// the provider's default (its best) in Max quality.
function familyModel(p, mode) {
  const models = Array.isArray(p?.models) ? p.models : [];
  if (!models.length) return null;
  if (mode === "max") return models.find((m) => m.default) || models[0];
  return models.find((m) => m.tier === "balanced") || models.find((m) => m.default) || models[0];
}

// Seats for a council that only has an OpenRouter key. Each seat is a different company's
// model, reached through OpenRouter, priced as that model (priceModel) when OpenRouter
// sends no exact bill. Between 2 and 4 seats.
export function openRouterFamilySeats(providers, { limit = 4, mode = "balanced" } = {}) {
  const cap = Math.max(2, Math.min(4, Number(limit) || 4));
  const seats = [];
  for (const f of OPENROUTER_FAMILIES) {
    const m = familyModel(providers?.[f.provider], mode);
    if (!m) continue;
    seats.push({ provider: "openrouter", model: `${f.ns}/${m.id}`, priceModel: m.id, family: f.family, label: `${f.family} via OpenRouter` });
    if (seats.length >= cap) break;
  }
  return seats.length >= 2 ? seats : [];
}

// A council seat's display name: the family label when it has one, else the provider's name.
export function seatLabel(seat, providers) {
  if (seat?.label) return seat.label;
  return providers?.[seat?.provider]?.name || String(seat?.provider || "");
}

// What the app can offer right now.
// providers: the registry object or an array of providers ({ id, name, kind, demo, custom }).
// keyed(id): true when that provider has a key saved.
export function councilOffer({ providers, keyed } = {}) {
  const list = Array.isArray(providers) ? providers : Object.values(providers || {});
  const has = typeof keyed === "function" ? keyed : () => false;
  const text = list.filter((p) => p && p.id && (p.kind === "text" || p.kind == null || p.custom));
  const real = text.filter((p) => !p.demo && has(p.id));
  const demo = text.filter((p) => p.demo && has(p.id));
  const companies = real.filter((p) => p.id !== "openrouter").map((p) => COMPANY[p.id] || p.name || p.id);
  const openrouter = real.some((p) => p.id === "openrouter");
  const registry = Array.isArray(providers) ? Object.fromEntries(list.map((p) => [p.id, p])) : providers || {};
  const families = openrouter ? openRouterFamilySeats(registry).map((s) => s.family) : [];
  const viaOpenRouter = openrouter && !companies.length && families.length >= 2;
  const practice = !real.length && demo.length >= 2;
  const canCouncil = companies.length + (openrouter ? 1 : 0) >= 2 || viaOpenRouter || practice;
  let line;
  if (practice) line = "Practice mode: the pretend AIs can show you a council. Nothing is spent.";
  else if (!real.length) line = "No AI connected yet. Add a key, or try a practice answer.";
  else if (viaOpenRouter) line = `Your OpenRouter key can seat ${listNames(families)} in a council.`;
  else if (canCouncil) line = `${listNames([...companies, ...(openrouter ? ["OpenRouter"] : [])])} are connected, so you can ask a council.`;
  else line = `One AI is connected (${companies[0]}). Add a second AI company, or an OpenRouter key, to ask a council where AIs check each other.`;
  return { companies, count: companies.length, openrouter, viaOpenRouter, families: viaOpenRouter ? families : [], practice, canCouncil, line };
}
