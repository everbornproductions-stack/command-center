// Business Profile, "How to talk to me", and "My Voice".
// Pure shaping only. The plugin stores the result. Nothing here touches the vault.

import { SCF_TEXT, SAFETY_TEXT, scrub } from "./safety.js";

export const LIMIT = 4000;

const rawFields = [
  { key: "businessName", label: "Business name", group: "business" },
  { key: "offer", label: "What you sell", group: "business", multiline: true },
  { key: "customer", label: "Who you serve", group: "business" },
  { key: "profession", label: "Your role", group: "business" },
  { key: "market", label: "Market or city", group: "business" },
  { key: "priceRange", label: "Price range", group: "business" },
  { key: "teamSize", label: "Team size", group: "business" },
  { key: "tools", label: "Tools you already use", group: "business", multiline: true },
  { key: "constraints", label: "Constraints", group: "business", multiline: true },
  { key: "neverSay", label: "Never say", group: "business", multiline: true },
  { key: "scf", label: "Credit repair or SCF mode", group: "business", kind: "bool" },
  { key: "directness", label: "How direct should answers be?", group: "tone" },
  { key: "length", label: "How long should answers be?", group: "tone" },
  { key: "pushback", label: "Should I push back when you are off?", group: "tone" },
  { key: "jargon", label: "Plain words or expert words?", group: "tone" },
  { key: "toneNotes", label: "Anything else about how to talk to you", group: "tone", multiline: true },
  { key: "voiceSample", label: "A paragraph in your own voice", group: "voice", multiline: true },
  { key: "wordsIUse", label: "Words you use", group: "voice" },
  { key: "wordsIAvoid", label: "Words you avoid", group: "voice" },
  { key: "sentenceStyle", label: "Sentence style", group: "voice" },
];
// Every profile field is optional. A Pro prompt can still require its own inputs.
export const FIELDS = rawFields.map((f) => ({ ...f, required: false }));

export const INTERVIEW = [
  { id: "business", title: "Your business", voice: false, fields: ["businessName", "offer", "customer", "profession"] },
  { id: "tone", title: "How to talk to me", voice: false, fields: ["directness", "length", "pushback", "jargon", "toneNotes"] },
  { id: "voice", title: "My voice", voice: true, fields: ["voiceSample", "wordsIUse", "wordsIAvoid", "sentenceStyle"] },
  { id: "safety", title: "Safety", voice: false, fields: ["scf", "neverSay"] },
];

const cleanLine = (v) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").replace(/\s+\n/g, "\n").trim().slice(0, LIMIT);

export function emptyProfile() {
  const out = { links: {} };
  for (const f of FIELDS) out[f.key] = f.kind === "bool" ? false : "";
  return out;
}

export function normalizeProfile(input = {}, prev = emptyProfile()) {
  const base = { ...emptyProfile(), ...(prev || {}) };
  const src = input && typeof input === "object" ? input : {};
  const { value: clean } = scrub(src);
  const out = { ...base, links: { ...(base.links || {}) } };
  for (const f of FIELDS) {
    if (clean[f.key] === undefined) continue;
    if (f.kind === "bool") out[f.key] = clean[f.key] === true || clean[f.key] === "yes" || clean[f.key] === "true";
    else out[f.key] = cleanLine(clean[f.key]);
  }
  if (clean.links && typeof clean.links === "object") {
    for (const [k, v] of Object.entries(clean.links)) {
      const key = String(k).replace(/[^a-z0-9_-]/gi, "").slice(0, 40);
      if (key) out.links[key] = cleanLine(v);
    }
  }
  out.updatedAt = Date.now();
  return out;
}

export function profileCompleteness(profile) {
  const p = profile || emptyProfile();
  const need = ["businessName", "offer", "customer"];
  const missing = need.filter((k) => !String(p[k] || "").trim());
  return { ready: missing.length === 0, missing };
}

export function globalBlock(profile) {
  const p = { ...emptyProfile(), ...(profile || {}) };
  const lines = ["GLOBAL INSTRUCTIONS (from the person's profile; follow these on every answer):"];
  if (p.businessName || p.offer || p.customer) {
    lines.push(`BUSINESS: ${p.businessName || "(name not set)"}`);
    lines.push(`OFFER: ${p.offer || "(not set)"}`);
    lines.push(`CUSTOMER: ${p.customer || "(not set)"}`);
    if (p.profession) lines.push(`ROLE: ${p.profession}`);
    if (p.market) lines.push(`MARKET: ${p.market}`);
    if (p.priceRange) lines.push(`PRICE RANGE: ${p.priceRange}`);
    if (p.teamSize) lines.push(`TEAM: ${p.teamSize}`);
    if (p.tools) lines.push(`TOOLS: ${p.tools}`);
    if (p.constraints) lines.push(`CONSTRAINTS: ${p.constraints}`);
  } else {
    lines.push("No Business Profile yet. Do not invent the business, the customer, prices, or results. Ask for them.");
  }
  lines.push(["HOW TO TALK TO ME:",
    p.directness ? `Directness: ${p.directness}.` : "Directness: not set.",
    p.length ? `Length: ${p.length}.` : "Length: not set.",
    p.pushback ? `Pushback: ${p.pushback}.` : "Pushback: not set.",
    p.jargon ? `Words: ${p.jargon}.` : "",
    p.toneNotes || "",
  ].filter(Boolean).join(" "));
  lines.push(["MY VOICE:",
    p.sentenceStyle ? `Sentences: ${p.sentenceStyle}.` : "",
    p.wordsIUse ? `Use words like: ${p.wordsIUse}.` : "",
    p.wordsIAvoid ? `Avoid: ${p.wordsIAvoid}.` : "",
    p.voiceSample ? `Match this sample: ${p.voiceSample}` : "No voice sample yet. Stay plain and concrete.",
  ].filter(Boolean).join(" "));
  if (p.neverSay) lines.push(`NEVER SAY: ${p.neverSay}`);
  lines.push(SAFETY_TEXT);
  if (p.scf) lines.push(SCF_TEXT);
  return lines.join("\n");
}
