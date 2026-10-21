// Receipt and renewal email parser (Phase 25). Pure: takes one email (from, subject, date, text or
// html) and returns the extracted fields with a confidence per field, or { ok: false, reason }.
// The email body is only read here, in memory; callers store the extracted fields and the message id,
// never the body or the subject.

// Services people pay for that have no balance API. vendor groups plans for the duplicate hint;
// provider links the row to the registry (ledger and credit activity); needsName means the sender
// domain alone is not enough (google.com sends many kinds of receipts).
export const SERVICES = [
  { id: "google-ai", name: "Google AI", vendor: "google", provider: "flow", domains: ["google.com"], needsName: true, names: /google ai (?:ultra|pro)|google one ai premium|gemini advanced/i, plan: /(Google AI (?:Ultra|Pro)(?: for Business)?|Google One AI Premium|Gemini Advanced)/i, url: "https://one.google.com/ai" },
  { id: "chatgpt", name: "ChatGPT", vendor: "openai", provider: "openai", domains: ["openai.com"], names: /chatgpt/i, plan: /(ChatGPT (?:Plus|Pro|Team|Business|Go))\b/i, url: "https://chatgpt.com/#settings" },
  { id: "claude", name: "Claude", vendor: "anthropic", provider: "anthropic", domains: ["anthropic.com", "claude.ai"], names: /\bclaude\b/i, plan: /(Claude (?:Max(?: \d+x)?|Pro|Team))\b|\b(Max(?: \d+x)?|Pro|Team) plan\b/i, url: "https://claude.ai/settings/billing" },
  { id: "kling", name: "Kling AI", vendor: "kling", provider: "kling", domains: ["klingai.com", "kuaishou.com"], names: /\bkling\b/i, plan: /\b(Standard|Pro|Premier|Ultra) (?:plan|membership|subscription)\b/i, url: "https://app.klingai.com/global/membership" },
  { id: "suno", name: "Suno", vendor: "suno", provider: "suno", domains: ["suno.com"], names: /\bsuno\b/i, plan: /\b(Pro|Premier) (?:plan|subscription|membership)\b/i, url: "https://suno.com/account" },
  { id: "midjourney", name: "Midjourney", vendor: "midjourney", provider: null, domains: ["midjourney.com"], names: /midjourney/i, plan: /\b(Basic|Standard|Pro|Mega) Plan\b/i, url: "https://www.midjourney.com/account" },
  { id: "elevenlabs", name: "ElevenLabs", vendor: "elevenlabs", provider: "elevenlabs", domains: ["elevenlabs.io"], names: /eleven ?labs/i, plan: /\b(Starter|Creator|Pro|Scale|Business)\b(?: (?:plan|tier|subscription))?/i, url: "https://elevenlabs.io/app/subscription" },
  { id: "grok", name: "Grok", vendor: "xai", provider: "xai", domains: ["x.ai"], names: /supergrok|\bgrok\b/i, plan: /(SuperGrok(?: Heavy)?)/i, url: "https://grok.com" },
  { id: "cursor", name: "Cursor", vendor: "cursor", provider: "cursor", domains: ["cursor.com", "cursor.sh", "anysphere.inc"], names: /\bcursor\b/i, plan: /\bCursor (Pro\+?|Ultra|Business|Teams)\b/i, url: "https://cursor.com/settings" },
  { id: "perplexity", name: "Perplexity", vendor: "perplexity", provider: "perplexity", domains: ["perplexity.ai"], names: /perplexity/i, plan: /(Perplexity (?:Pro|Max))\b/i, url: "https://www.perplexity.ai/settings/account" },
  { id: "runway", name: "Runway", vendor: "runway", provider: null, domains: ["runwayml.com"], names: /\brunway\b/i, plan: /\b(Standard|Pro|Unlimited) plan\b/i, url: "https://app.runwayml.com" },
];
export const serviceById = (id) => SERVICES.find((s) => s.id === id) || null;

// vendor of a registry provider id (so a subscription row and an email from the same company group together)
const PROVIDER_VENDOR = { anthropic: "anthropic", openai: "openai", xai: "xai", google: "google", flow: "google", kling: "kling", suno: "suno", elevenlabs: "elevenlabs", cursor: "cursor", perplexity: "perplexity" };
export function vendorOf(sub) {
  if (!sub) return null;
  if (sub.vendor) return String(sub.vendor);
  if (sub.provider && PROVIDER_VENDOR[sub.provider]) return PROVIDER_VENDOR[sub.provider];
  const byName = SERVICES.find((s) => s.names.test(String(sub.name || "")));
  if (byName) return byName.vendor;
  return sub.provider || String(sub.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-") || null;
}

export const CYCLES = ["monthly", "yearly", "weekly"];
export function monthlyOf(price, cycle) {
  if (price == null || price === "" || !Number.isFinite(Number(price))) return null;
  const p = Number(price);
  const m = cycle === "yearly" ? p / 12 : cycle === "weekly" ? (p * 52) / 12 : p;
  return +m.toFixed(2);
}

// ---------- dates ----------
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => {
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
};
const MON = "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
const MONX = MON.replace(/^\(/, "(?:"); // same months, no capture group, for use inside larger patterns
export const DATE_SRC = `(?:\\d{4}-\\d{2}-\\d{2}|${MONX} \\d{1,2}(?:st|nd|rd|th)?,? \\d{4}|\\d{1,2} ${MONX},? \\d{4}|\\d{1,2}\\/\\d{1,2}\\/\\d{4})`;
// One date string → YYYY-MM-DD (null when it is not a date). US order for d/d/yyyy unless the first part is over 12.
export function parseDate(str) {
  const s = String(str || "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(new RegExp(`^${MON} (\\d{1,2})(?:st|nd|rd|th)?,? (\\d{4})$`, "i"));
  if (m) return iso(+m[3], MONTHS[m[1].toLowerCase().slice(0, m[1].toLowerCase().startsWith("sept") ? 4 : 3)], +m[2]);
  m = s.match(new RegExp(`^(\\d{1,2}) ${MON},? (\\d{4})$`, "i"));
  if (m) return iso(+m[3], MONTHS[m[2].toLowerCase().slice(0, m[2].toLowerCase().startsWith("sept") ? 4 : 3)], +m[1]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return +m[1] > 12 ? iso(+m[3], +m[2], +m[1]) : iso(+m[3], +m[1], +m[2]);
  return null;
}
export function addCycle(isoDate, cycle, times = 1) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (cycle === "yearly") dt.setUTCFullYear(dt.getUTCFullYear() + times);
  else if (cycle === "weekly") dt.setUTCDate(dt.getUTCDate() + 7 * times);
  else { const day = dt.getUTCDate(); dt.setUTCDate(1); dt.setUTCMonth(dt.getUTCMonth() + times); const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate(); dt.setUTCDate(Math.min(day, last)); }
  return dt.toISOString().slice(0, 10);
}

// ---------- text ----------
export function htmlToText(html) {
  return String(html || "")
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#36;|&dollar;/gi, "$").replace(/&euro;/gi, "€").replace(/&pound;/gi, "£").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
function senderOf(from) {
  const s = String(from || "");
  const addr = (s.match(/<([^>]+)>/)?.[1] || s.match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || "").toLowerCase();
  const name = s.replace(/<[^>]*>/, "").replace(/"/g, "").trim();
  return { addr, domain: addr.split("@")[1] || "", name };
}
const domainIs = (domain, list) => list.some((d) => domain === d || domain.endsWith(`.${d}`));

// ---------- money ----------
const CUR = { "$": "USD", "US$": "USD", "USD": "USD", "€": "EUR", "EUR": "EUR", "£": "GBP", "GBP": "GBP" };
const MONEY = /(US\$|\$|€|£|USD ?|EUR ?|GBP ?)\s?(\d{1,5}(?:,\d{3})*(?:\.\d{1,2})?)\b|\b(\d{1,5}(?:,\d{3})*(?:\.\d{1,2})?) ?(USD|EUR|GBP)\b/g;
function findPrice(text) {
  const out = [];
  const lines = text.split("\n");
  for (const line of lines) {
    for (const m of line.matchAll(MONEY)) {
      const sym = (m[1] || m[4] || "").trim();
      const value = Number(String(m[2] || m[3]).replace(/,/g, ""));
      if (!Number.isFinite(value)) continue;
      const l = line.toLowerCase();
      let score = 1;
      if (/\b(tax|vat|gst|discount|credit applied|refund)\b/.test(l) && !/\btotal\b/.test(l)) score = 0.2;
      else if (/\b(total|amount (?:paid|charged|due)|you paid|charged|payment of)\b/.test(l) && !/subtotal/.test(l)) score = 3;
      else if (/\b(price|billed|subtotal|per month|per year|\/ ?mo|\/ ?yr|plan)\b/.test(l)) score = 2;
      out.push({ value, currency: CUR[sym] || "USD", score, line });
    }
  }
  if (!out.length) return null;
  const best = out.slice().sort((a, b) => b.score - a.score)[0];
  const distinct = new Set(out.map((x) => x.value)).size;
  const conf = best.score >= 3 ? 0.9 : best.score >= 2 ? 0.75 : distinct === 1 ? 0.65 : 0.4;
  return { value: best.value, currency: best.currency, conf, line: best.line };
}

// ---------- cycle ----------
const CYC = {
  monthly: /\b(monthly|per month|a month|each month|every month|\/ ?mo(?:nth)?\b|1 month|month-to-month)/i,
  yearly: /\b(annual(?:ly)?|yearly|per year|a year|every year|\/ ?(?:yr|year)\b|12 months)/i,
  weekly: /\b(weekly|per week|every week|\/ ?wk\b)/i,
};
function findCycle(text, priceLine) {
  if (priceLine) for (const c of CYCLES) if (CYC[c].test(priceLine)) return { value: c, conf: 0.9 };
  const hits = CYCLES.filter((c) => CYC[c].test(text));
  if (hits.length === 1) return { value: hits[0], conf: 0.8 };
  if (hits.length > 1) return { value: hits[0], conf: 0.45 };
  return null;
}

// ---------- renewal ----------
const RENEW = new RegExp(`(?:renews?|renewal(?: date)?|auto-renews?|next (?:billing|payment|charge|invoice|bill)(?: date)?|will (?:automatically )?(?:renew|be (?:charged|billed))|billing period ends?|current period ends?|valid until|active until)\\b[^\\n]{0,40}?(${DATE_SRC})`, "i");
const PERIOD = new RegExp(`(${DATE_SRC})\\s*(?:-|–|to|through)\\s*(${DATE_SRC})`, "i");
function findRenewal(text) {
  const m = text.match(RENEW);
  if (m) { const d = parseDate(m[1]); if (d) return { value: d, conf: /\d{1,2}\/\d{1,2}\/\d{4}/.test(m[1]) ? 0.7 : 0.9 }; }
  const p = text.match(PERIOD);
  if (p) { const d = parseDate(p[2]); if (d) return { value: d, conf: 0.7, fromPeriod: true }; }
  return null;
}

const RECEIPTISH = /receipt|invoice|subscription|renew|payment|your plan|billing|order confirmation|membership|thanks for (?:your )?(?:purchase|subscribing)/i;
const W = { service: 0.3, price: 0.3, cycle: 0.15, renews: 0.15, plan: 0.1 };
export const LOW_CONFIDENCE = 0.6;
export const HIGH_CONFIDENCE = 0.8;
const r2 = (n) => Math.round(n * 100) / 100;

// High confidence (the scan adds the row with no confirm step, labelled "auto-detected"). All of:
//  1. a known AI service from SERVICES, recognised by its sender domain (service confidence 0.95;
//     a product name in the text alone is not enough),
//  2. an amount was found,
//  3. the plan name matched that service's own plan pattern, or the email states a renewal date
//     (a date estimated from the receipt date does not count),
//  4. the overall score is at least HIGH_CONFIDENCE.
// Anything else stays a suggestion that waits for a click.
export function isHighConfidence(r) {
  if (!r?.ok || !r.serviceId || !serviceById(r.serviceId)) return false;
  if ((r.fields?.service?.conf ?? 0) < 0.95) return false;
  if (r.price == null) return false;
  const plan = (r.fields?.plan?.conf ?? 0) >= 0.85;
  const renewal = !!r.renews && !r.renewsEstimated;
  if (!plan && !renewal) return false;
  return r.confidence >= HIGH_CONFIDENCE;
}

// email: { from, subject, date (any Date-parsable string), text?, html? }
export function parseReceipt(email) {
  const from = senderOf(email?.from);
  const subject = String(email?.subject || "");
  const body = email?.text ? String(email.text) : htmlToText(email?.html || "");
  const text = `${subject}\n${body}`.slice(0, 40000);
  // which service: sender domain (strong), a product name in the subject or body (weaker), else a generic receipt
  let svc = null, svcConf = 0;
  for (const s of SERVICES) {
    const dom = domainIs(from.domain, s.domains);
    const named = s.names.test(text) || s.names.test(from.name);
    if (dom && (!s.needsName || named)) { svc = s; svcConf = 0.95; break; }
    if (named && !svc) { svc = s; svcConf = 0.7; }
  }
  const price = findPrice(text);
  const renewal = findRenewal(text);
  if (!svc) {
    if (!RECEIPTISH.test(subject) || !price) return { ok: false, reason: "Not a receipt or renewal email from a service we know." };
  }
  if (!price && !renewal) return { ok: false, reason: "No price or renewal date found in this email." };
  const cycle = findCycle(text, price?.line);
  let plan = null;
  if (svc) { const m = text.match(svc.plan); if (m) plan = { value: (m[1] || m[2] || m[0]).trim(), conf: 0.85 }; }
  if (!plan) { const m = text.match(/\b([A-Z][A-Za-z0-9+]*(?: [A-Z][A-Za-z0-9+]*)?) (?:plan|subscription|membership)\b/); if (m && !/^(Your|The|This|Our|A|Monthly|Annual|Yearly)$/i.test(m[1])) plan = { value: m[1], conf: 0.5 }; }
  // a generic receipt: the sender's display name stands in for the service
  let service, vendor, provider = null, url = null;
  if (svc) { service = svc.name; vendor = svc.vendor; provider = svc.provider; url = svc.url; }
  else {
    service = from.name.replace(/\b(billing|receipts?|payments?|team|support|no-?reply|via stripe|via paddle)\b/gi, "").replace(/[^\p{L}\p{N} .&+-]/gu, "").replace(/\s+/g, " ").trim() || from.domain.split(".").slice(-2, -1)[0] || "Unknown service";
    vendor = (from.domain.split(".").slice(-2, -1)[0] || service).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    svcConf = 0.35;
  }
  // no renewal date but a receipt date and a cycle: the next renewal is one cycle after the receipt
  let renews = renewal;
  if (!renews && cycle && email?.date) {
    const d = new Date(email.date);
    if (!Number.isNaN(d.getTime())) renews = { value: addCycle(d.toISOString().slice(0, 10), cycle.value), conf: 0.5, estimated: true };
  }
  const fields = {
    service: { value: service, conf: r2(svcConf) },
    plan: plan ? { value: plan.value, conf: plan.conf } : null,
    price: price ? { value: price.value, conf: price.conf } : null,
    currency: price ? { value: price.currency, conf: price.conf } : null,
    cycle: cycle ? { value: cycle.value, conf: cycle.conf } : null,
    renews: renews ? { value: renews.value, conf: renews.conf, estimated: !!renews.estimated } : null,
  };
  const confidence = r2(Object.entries(W).reduce((a, [k, w]) => a + (fields[k] ? w * fields[k].conf : 0), 0));
  const out = {
    ok: true, serviceId: svc?.id || null, service, vendor, provider, url,
    plan: plan?.value || null, price: price?.value ?? null, currency: price?.currency || null, cycle: cycle?.value || null,
    monthly: price ? monthlyOf(price.value, cycle?.value || "monthly") : null,
    renews: renews?.value || null, renewsEstimated: !!renews?.estimated,
    confidence, low: confidence < LOW_CONFIDENCE, fields,
  };
  out.high = isHighConfidence(out);
  return out;
}
