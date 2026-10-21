// Phase 62. Starter packs grouped by industry, shown with Pro prompts.
// Picking one fills Marching orders. Nothing runs until the person sends it.
// Outbound text stays a draft. The same safety marks as the Pro prompts pack apply.
import { scrubText, VERIFY, CROA, RESPA, REDACTED } from "./prompts/safety.js";

const DRAFT = "DRAFT ONLY. Nothing is sent until you send it yourself.";

function pack(row) {
  return row;
}

export const PACKS = [
  pack({
    id: "real-estate",
    name: "Real estate",
    prompts: [
      {
        id: "re-listing",
        name: "Listing description",
        outbound: false,
        text: [
          "Write a listing description for {{address}}.",
          "Facts I can stand behind: {{facts}}.",
          "Buyer: {{buyer}}.",
          `If a number, price, or claim was not in those facts, mark it ${VERIFY}. Do not invent a sale price, a school rating, or a days-on-market figure.`,
          "This is a draft the person will edit. Do not post it.",
        ].join("\n"),
      },
      {
        id: "re-followup",
        name: "Buyer follow-up",
        outbound: true,
        text: [
          DRAFT,
          "Write a short follow-up email to {{buyer}} about {{address}}.",
          "What they asked: {{facts}}.",
          `Mark any number that was not given as ${VERIFY}. Do not promise a closing date or an offer result.`,
        ].join("\n"),
      },
    ],
  }),
  pack({
    id: "insurance",
    name: "Insurance",
    prompts: [
      {
        id: "ins-summary",
        name: "Policy summary",
        outbound: false,
        text: [
          "Summarize this policy in plain words for {{client}}.",
          "What the person pasted: {{facts}}.",
          `If a limit, deductible, or date was not in that paste, mark it ${VERIFY}. Do not say a claim will be paid.`,
        ].join("\n"),
      },
      {
        id: "ins-renewal",
        name: "Renewal note",
        outbound: true,
        text: [
          DRAFT,
          "Draft a renewal note to {{client}}.",
          "Known facts: {{facts}}.",
          `Referral fees must be marked ${RESPA}. Do not promise savings. Mark unknown numbers ${VERIFY}.`,
        ].join("\n"),
      },
    ],
  }),
  pack({
    id: "credit-repair",
    name: "Credit repair",
    scf: true,
    prompts: [
      {
        id: "cr-dispute",
        name: "Dispute draft",
        outbound: true,
        text: [
          DRAFT,
          "SCF / credit-repair mode.",
          `Do not promise a result. Do not say a score will change. Mark any promised result ${CROA}.`,
          `Referral rewards must be marked ${RESPA}.`,
          "Client: {{client}}.",
          "What they asked, in their words: {{facts}}.",
          "Write a dispute letter that describes the process only. The person decides what is sent.",
        ].join("\n"),
      },
      {
        id: "cr-checkin",
        name: "Client check-in",
        outbound: true,
        text: [
          DRAFT,
          "SCF / credit-repair mode.",
          `Do not promise a result. Mark any promised result ${CROA}.`,
          "Draft a check-in for {{client}} about the next process step.",
          "Known facts only: {{facts}}.",
        ].join("\n"),
      },
    ],
  }),
];

export function listPacks({ open }) {
  return PACKS.map((p) => ({
    id: p.id,
    name: p.name,
    scf: !!p.scf,
    prompts: p.prompts.map((t) => ({
      id: t.id,
      name: t.name,
      outbound: !!t.outbound,
      ...(open ? { text: t.text } : {}),
    })),
  }));
}

export function findPrompt(id) {
  for (const p of PACKS) {
    const t = p.prompts.find((x) => x.id === id);
    if (t) return { pack: p, prompt: t };
  }
  return null;
}

export function fillPrompt(id, inputs = {}) {
  const found = findPrompt(id);
  if (!found) {
    const err = new Error("Unknown industry prompt.");
    err.status = 404;
    throw err;
  }
  const src = found.prompt.text;
  const redacted = [];
  const text = src.replace(/\{\{(\w+)\}\}/g, (m, key) => {
    const raw = inputs[key];
    if (raw == null || String(raw).trim() === "") return "[add this]";
    const cleaned = scrubText(String(raw));
    redacted.push(...cleaned.redacted);
    return cleaned.text;
  });
  const extra = scrubText(text);
  return {
    id,
    packId: found.pack.id,
    name: found.prompt.name,
    orders: extra.text,
    redacted: [...new Set([...redacted, ...extra.redacted])],
    draft: !!found.prompt.outbound,
    scf: !!found.pack.scf,
    marker: REDACTED,
  };
}
