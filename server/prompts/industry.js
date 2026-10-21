// Industry packs. Compliance is part of the prompt. Nothing here promises a result,
// and nothing is sent. Credit repair follows CROA: process only, no score claims.
const SALES = "Sales/clients";
const CONTENT = "Content";

const REAL_ESTATE = "REAL ESTATE RULES: Do not promise a sale price, a closing date, or that a buyer will qualify. Do not steer by race, color, religion, sex, disability, family status, or national origin. Describe the property and the process only. Any price or date that was not in the inputs is marked [VERIFY]. The email or text is a draft. Nothing is sent.";
const MORTGAGE = "MORTGAGE RULES: Do not guarantee a rate, an approval, a payment, or a closing date. A rate that is not locked is not a promise. Referral fees and kickbacks are marked [RESPA REVIEW]. Numbers that were not in the inputs are marked [VERIFY]. The message is a draft. Nothing is sent and nothing is charged.";
const CREDIT = "CREDIT REPAIR RULES (CROA): Do not promise results. Do not say a score will rise, jump, or reach a number. Do not guarantee deletion, approval, or a timeline. Describe the process only. Mark a promised result with [CROA]. Referral rewards are marked [RESPA REVIEW]. The letter is a draft. Nothing is sent.";
const CREATOR = "CREATOR RULES: Do not promise views, followers, income, or that a post will go viral. If the brief is sponsored, the script says it is an ad. Income figures that were not supplied are marked [VERIFY]. The caption or script is a draft. Nothing is posted until the person posts it.";

function inp(key, label, extra = {}) {
  return { key, label, required: extra.required !== false, multiline: !!extra.multiline };
}

export const INDUSTRY_IDS = ["re-listing-brief", "re-buyer-followup", "mtg-process-explainer", "mtg-rate-talk", "cr-dispute-draft", "cr-status-update", "cr8-sponsor-script", "cr8-caption-pack"];

export const INDUSTRY_TEMPLATES = [
  {
    id: "re-listing-brief", name: "Listing brief", category: SALES, industry: "real-estate", compliance: REAL_ESTATE,
    description: "A property listing from the facts you have. No promised sale price or closing date.",
    phrases: ["listing brief", "property listing description"], words: [],
    inputs: [inp("facts", "Property facts you can stand behind", { multiline: true }), inp("audience", "Who the listing is for", { required: false })],
    role: "You write a listing from supplied facts. You do not invent a price, a buyer, or a closing date.",
    context: "Facts: {{facts}}. Audience: {{audience}}.",
    command: "Write a short listing. Use only the facts given. Leave a blank where a fact is missing and ask for it. Do not say the home will sell, and do not name a price that was not supplied.",
    format: "Headline. Two short paragraphs. Facts still needed.",
    output: "A listing draft with no promised result.",
  },
  {
    id: "re-buyer-followup", name: "Buyer follow-up", category: SALES, industry: "real-estate", compliance: REAL_ESTATE,
    description: "A follow-up draft for a buyer. Fair housing. No steering and no promised close.",
    phrases: ["buyer follow-up", "buyer follow up email"], words: [],
    inputs: [inp("buyer", "What the buyer asked for", { multiline: true }), inp("next", "The next step you can actually offer")],
    role: "You draft a buyer follow-up that describes homes and process, and does not steer.",
    context: "Buyer notes: {{buyer}}. Next step: {{next}}.",
    command: "Write the email as a draft. Stick to property facts and the next step. Do not mention protected classes. Do not promise a close, a price, or that they will qualify.",
    format: "Subject. Draft email. One question if a fact is missing.",
    output: "A buyer follow-up draft.",
  },
  {
    id: "mtg-process-explainer", name: "Mortgage process explainer", category: SALES, industry: "mortgage", compliance: MORTGAGE,
    description: "Explains the mortgage process. No approval, rate, or payment promise.",
    phrases: ["prequalification explainer", "mortgage process explainer"], words: [],
    inputs: [inp("stage", "Where they are in the process"), inp("facts", "Facts you can share", { multiline: true })],
    role: "You explain a mortgage process in plain words. You do not approve anyone.",
    context: "Stage: {{stage}}. Facts: {{facts}}.",
    command: "Explain the next steps. Say clearly that this is not an approval and not a locked rate. Do not invent a payment or a closing date. If a number was not supplied, mark it [VERIFY] or leave it out.",
    format: "What this is not. Next steps. Questions still open.",
    output: "A process note with no approval promise.",
  },
  {
    id: "mtg-rate-talk", name: "Rate conversation", category: SALES, industry: "mortgage", compliance: MORTGAGE,
    description: "How to talk about a rate that is not locked. Referral fees stay marked for review.",
    phrases: ["rate conversation", "talk about a mortgage rate"], words: [],
    inputs: [inp("rate", "The rate figure they gave you, if any", { required: false }), inp("context", "What they asked", { multiline: true })],
    role: "You draft a rate conversation. An unlocked rate is not a promise.",
    context: "Rate note: {{rate}}. What they asked: {{context}}.",
    command: "Draft the reply. If no rate was supplied, do not invent one. If a referral fee appears, mark it [RESPA REVIEW]. Do not say they are approved.",
    format: "Draft reply. What is not promised.",
    output: "A rate conversation draft.",
  },
  {
    id: "cr-dispute-draft", name: "Credit dispute draft", category: SALES, industry: "credit-repair", scf: true, compliance: CREDIT,
    description: "A dispute letter draft. CROA: no deletion promise, no score jump, no timeline.",
    phrases: ["credit dispute letter", "croa dispute draft"], words: [],
    inputs: [inp("item", "The item they want reviewed", { multiline: true }), inp("bureau", "Which bureau, if they said")],
    role: "You draft a credit dispute letter that describes the request and promises nothing.",
    context: "Item: {{item}}. Bureau: {{bureau}}.",
    command: "Write the letter as a draft. Ask the bureau to investigate the item. Do not say the item will be deleted, that a score will rise, or how long it will take. Do not include a Social Security number, date of birth, or account number.",
    format: "Draft letter. What this letter does not promise.",
    output: "A CROA-safe dispute draft.",
  },
  {
    id: "cr-status-update", name: "Credit repair status", category: SALES, industry: "credit-repair", scf: true, compliance: CREDIT,
    description: "A client status update. Process only. No promised score change.",
    phrases: ["credit repair update", "credit repair status"], words: [],
    inputs: [inp("done", "What was actually done", { multiline: true }), inp("next", "The next process step")],
    role: "You write a status update about process. You do not predict a score.",
    context: "Done: {{done}}. Next: {{next}}.",
    command: "Tell them what happened and the next process step. Do not promise a result, a deletion, or a score change. The note is a draft and is not sent from here.",
    format: "What happened. Next step. What is not promised.",
    output: "A status draft with no score claim.",
  },
  {
    id: "cr8-sponsor-script", name: "Sponsor script", category: CONTENT, industry: "creator", compliance: CREATOR,
    description: "A sponsored script that says it is an ad. No income or view promise.",
    phrases: ["sponsor script", "sponsored creator script"], words: [],
    inputs: [inp("product", "What the sponsor makes"), inp("points", "Points the sponsor asked you to cover", { multiline: true })],
    role: "You write a short sponsored script. You label the ad and you do not invent results.",
    context: "Product: {{product}}. Points: {{points}}.",
    command: "Write a script the person can record. The first line says it is a paid ad or a sponsored post. Do not promise views, followers, or income. Do not invent a testimonial.",
    format: "Ad line. Script. What was not claimed.",
    output: "A sponsored script draft.",
  },
  {
    id: "cr8-caption-pack", name: "Creator captions", category: CONTENT, industry: "creator", compliance: CREATOR,
    description: "Three captions. No guaranteed reach, and nothing is posted.",
    phrases: ["creator captions", "caption pack for a creator"], words: [],
    inputs: [inp("topic", "What the post is about", { multiline: true }), inp("sponsored", "Is this sponsored? yes or no", { required: false })],
    role: "You write captions the person can post themselves. You do not post them.",
    context: "Topic: {{topic}}. Sponsored: {{sponsored}}.",
    command: "Write three captions. If it is sponsored, each caption says so. Do not promise views or income. Leave them as drafts.",
    format: "Three captions. A line that says nothing is posted.",
    output: "Three caption drafts.",
  },
];
