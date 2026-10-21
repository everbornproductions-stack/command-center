// Ad limits, CAN-SPAM, and the credit or insurance reminder.
// This file does not give legal, credit, or insurance advice.

export const COMPLIANCE_BANNER = "Meldmind does not give legal, credit, or insurance advice. These boxes are a reminder, not a review.";

export const COMPLIANCE_BOXES = [
  { id: "noPromises", label: "I will not promise a result I cannot stand behind." },
  { id: "followLaws", label: "I will follow the rules for this kind of ad." },
  { id: "notAdvice", label: "This is my ad. It is not advice from Meldmind." },
];

export const REGULATED_WORDS = [
  "credit repair",
  "credit score",
  "fix your credit",
  "debt relief",
  "debt settlement",
  "insurance",
  "medicare",
  "medicaid",
];

const REGULATED = new RegExp(`\\b(${REGULATED_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");
const ADVICE = /\b(your score will|we guarantee|this is legal advice|you should dispute|act now to fix your credit)\b/i;

export const AD_LIMITS = {
  instagram: { label: "Instagram", parts: [{ part: "caption", max: 2200 }] },
  facebook: { label: "Facebook", parts: [{ part: "primary text", max: 125 }] },
  x: { label: "X", parts: [{ part: "post", max: 280 }] },
  linkedin: { label: "LinkedIn", parts: [{ part: "post", max: 3000 }] },
  tiktok: { label: "TikTok", parts: [{ part: "caption", max: 2200 }] },
  google: { label: "Google ads", parts: [{ part: "headline", max: 30 }, { part: "description", max: 90 }] },
  youtube: { label: "YouTube", parts: [{ part: "title", max: 100 }] },
};

export function isRegulated(text) {
  return REGULATED.test(String(text || ""));
}

export function boxesOk(compliance) {
  return !!(compliance && compliance.noPromises === true && compliance.followLaws === true && compliance.notAdvice === true);
}

export function claimIssue(text) {
  if (!ADVICE.test(String(text || ""))) return null;
  return {
    id: "claim",
    kind: "claim",
    title: "This reads like a promise",
    detail: "Meldmind will not tell you this claim is allowed, and it will not rewrite it into advice.",
    blocking: false,
    fixable: false,
  };
}

export function adSource(input, part) {
  if (part === "headline") return input.name || input.copy || "";
  if (part === "description") return input.about || input.copy || "";
  return input.copy || `${input.name || "My business"}: ${input.about || ""}`.trim();
}

export function adLines(input) {
  const spec = AD_LIMITS[input.platform] || AD_LIMITS.instagram;
  return spec.parts.map((part) => {
    const text = String(adSource(input, part.part) || "").trim();
    return { part: part.part, label: spec.label, text, max: part.max, over: text.length > part.max };
  });
}

export function limitIssues(lines) {
  return (lines || []).filter((line) => line.over).map((line) => ({
    id: `limit:${line.part}`,
    kind: "limit",
    part: line.part,
    title: `${line.label} ${line.part} is too long`,
    detail: `${line.text.length} characters. The limit is ${line.max}.`,
    blocking: true,
    fixable: true,
    max: line.max,
  }));
}

export function trimLine(line) {
  return { ...line, text: String(line.text || "").slice(0, line.max), over: false };
}

export function emailFooter({ name, address, unsubscribe }) {
  const who = String(name || "My business").trim() || "My business";
  const where = String(address || "").trim() || "[Add your postal address]";
  const unsub = String(unsubscribe || "").trim() || "Reply with the word unsubscribe";
  return `${who}\n${where}\nYou got this email because you asked to hear from us.\nUnsubscribe: ${unsub}`;
}

export function addressIssue(address) {
  if (String(address || "").trim()) return null;
  return {
    id: "address",
    kind: "address",
    title: "Add your postal address",
    detail: "CAN-SPAM needs the business name, the postal address, and a way to unsubscribe. The footer is already on the email.",
    blocking: true,
    fixable: false,
  };
}
