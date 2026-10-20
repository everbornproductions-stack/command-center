// Marketplace (Phase 10): a local and demo catalog only.
//
// Listings are data (pipeline steps, agent instructions, prompts). Install copies that data
// onto this computer. It does not run it, does not spend credits, and does not publish it
// anywhere. Paid prices are placeholders. Checkout stays off unless CC_MARKET_PAID=1, and
// even then nothing is charged and no payment service is called.
//
// A signed template file is HMAC-SHA256 over a canonical JSON body. The demo catalog is
// signed with a public marker (not a secret, not a privilege). This install's own exports
// are signed with a random key kept in the user data folder and never sent to the browser.
import crypto from "node:crypto";
import { ctx, doc, putDoc } from "./store.js";
import { emit } from "./events.js";
import { exportBundle, getAgent, getPrompt, importBundle, listListings, scanForListing } from "./custom-agents.js";
import { normalizeMode } from "./modes.js";

export const FORMAT = "command-ai/template";
export const FORMAT_VERSION = 1;
export const CATEGORIES = ["Social Posts", "Music Videos", "Client Work", "Sales", "Ops", "Writing", "Research", "Other"];
export const PLACEHOLDER_PRICES_USD = [5, 12, 24, 49];
export const REVENUE_SHARE = Object.freeze({
  everbornPct: 20,
  sellerPct: 80,
  placeholder: true,
  note: "Everborn keeps 20% and the seller keeps 80%. This split is a placeholder. No payout is sent.",
});
export const COPY = Object.freeze({
  banner: "Local and demo catalog. Nothing here is published to the internet.",
  install: "Install copies the steps onto this computer. It does not run them and it does not spend credits.",
  paidOff: "Placeholder price. Checkout is off, so nothing is charged.",
  paidOn: "Placeholder checkout is on for this computer. Nothing is charged.",
  revenue: REVENUE_SHARE.note,
  share: "The share link works on this computer only. It does not send the file anywhere.",
  payout: "Payouts are not connected. Nothing is paid out.",
});

// Public marker for the bundled demo catalog. It proves a demo file was not edited after
// signing. It is not a credential and it grants nothing on its own.
const DEMO_KEY = "command-ai-demo-catalog-v1";

const LISTINGS = "marketplace.listings";
const INSTALLS = "marketplace.installs";
const RATINGS = "marketplace.ratings";
const ORDERS = "marketplace.orders";
const SHARES = "marketplace.shares";
const REPORTS = "marketplace.reports";
const KEY = "marketplace.key";
const DEMO_STATE = "marketplace.demoState";
const PIPELINES = "pipelines.saved";

const err = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const str = (v, max) => String(v ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
const newId = (p) => `${p}-${crypto.randomBytes(5).toString("hex")}`;
const paidEnabled = () => process.env.CC_MARKET_PAID === "1";
export { paidEnabled };

const listDoc = (kind) => { const d = doc(kind, () => ({ list: [] })); d.list ||= []; return d; };
const save = (kind, d) => putDoc(kind, d);

function canonical(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}
function fingerprint(secret) { return crypto.createHash("sha256").update(String(secret)).digest("hex").slice(0, 16); }
function hmac(secret, body) { return crypto.createHmac("sha256", String(secret)).update(canonical(body)).digest("hex"); }
function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
function localSecret() {
  const cur = ctx().docs[KEY];
  return cur?.secret || null;
}
function ensureLocalSecret() {
  const have = localSecret();
  if (have) return have;
  const secret = crypto.randomBytes(32).toString("hex");
  save(KEY, { secret });
  return secret;
}

function signWith(secret, signer, fields) {
  const body = { format: FORMAT, version: FORMAT_VERSION, signer, keyFingerprint: fingerprint(secret), issuedAt: Date.now(), ...fields };
  return { ...body, sig: hmac(secret, body) };
}

export function verifyFile(file) {
  if (!file || typeof file !== "object" || file.format !== FORMAT) throw err(400, "That is not a Command AI template file.");
  if (Number(file.version) > FORMAT_VERSION) throw err(400, "That file comes from a newer Command AI. Update the app, then import it.");
  const sig = file.sig;
  if (typeof sig !== "string" || !/^[0-9a-f]{64}$/.test(sig)) throw err(400, "This file's signature does not match.");
  const body = { ...file };
  delete body.sig;
  let secret = null;
  if (file.signer === "demo") secret = DEMO_KEY;
  else if (file.signer === "local") secret = localSecret();
  if (!secret || file.keyFingerprint !== fingerprint(secret)) throw err(400, "This file was signed by a different Command AI install, so this computer cannot check it.");
  if (!safeEqual(hmac(secret, body), sig)) throw err(400, "This file's signature does not match.");
  return body;
}

function cleanPipeline(p) {
  const raw = (Array.isArray(p?.steps) ? p.steps : []).slice(0, 10);
  const steps = raw.map((s, i) => ({
    title: str(s?.title, 80) || `Step ${i + 1}`,
    capability: str(s?.capability, 40) || "writing",
    deps: [],
    instructions: str(s?.instructions, 1000),
    deliverable: str(s?.deliverable, 300),
  }));
  raw.forEach((s, i) => {
    steps[i].deps = [...new Set((Array.isArray(s?.deps) ? s.deps : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= steps.length && n !== i + 1))];
  });
  if (!steps.length) throw err(400, "A pipeline needs at least one step.");
  const inputs = (Array.isArray(p?.inputs) ? p.inputs : []).slice(0, 8).map((i, n) => ({
    key: (str(i?.key, 40).replace(/[^\w]/g, "") || `input${n + 1}`),
    label: str(i?.label, 80) || "Input",
    placeholder: str(i?.placeholder, 120),
    ...(i?.multiline ? { multiline: true } : {}),
  }));
  return {
    name: str(p?.name, 80) || "Untitled pipeline",
    icon: str(p?.icon, 8) || "✦",
    category: str(p?.category, 40) || "Custom",
    description: str(p?.description, 300),
    inputs,
    steps,
    assembly: str(p?.assembly, 400),
    mode: normalizeMode(p?.mode) || "balanced",
    qa: p?.qa !== false,
    budgetUsd: Math.min(20, Math.max(0.5, Number(p?.budgetUsd) || 3)),
  };
}
const stepBrief = (steps) => (steps || []).map((s) => ({ title: s.title, capability: s.capability }));
function textsOfPipeline(p, extra = []) {
  return [p?.name, p?.description, p?.assembly, ...(p?.steps || []).flatMap((s) => [s.title, s.instructions, s.deliverable]), ...extra];
}
function assertClean(texts) {
  const flagged = scanForListing(texts.filter(Boolean));
  if (flagged.length) throw err(400, `This cannot be listed: it ${flagged.join(" and ")}.`, { code: "flagged", flagged });
}

function cleanPrice(input) {
  const type = input?.priceType || input?.type || "free";
  if (type === "free") return { type: "free", usd: 0, placeholder: false };
  if (type === "bundle") return { type: "bundle", usd: null, placeholder: true, note: "Seller bundles are not sold yet." };
  if (type === "once") {
    const usd = Number(input?.priceUsd ?? input?.usd);
    if (!PLACEHOLDER_PRICES_USD.includes(usd)) throw err(400, `Placeholder prices are $${PLACEHOLDER_PRICES_USD.join(", $")}.`);
    return { type: "once", usd, placeholder: true };
  }
  throw err(400, "Price must be free, once, or bundle.");
}
const isPaid = (price) => price?.type === "once" || price?.type === "bundle";

function gatePaid(listing) {
  if (!isPaid(listing.price)) return { charged: false, placeholder: false, order: null };
  if (!paidEnabled()) throw err(409, "Paid listings are turned off. No charge was made.", { code: "paid_off", charged: false, placeholder: true });
  const order = {
    id: newId("ord"), listingId: listing.id, usd: listing.price.usd, priceType: listing.price.type,
    charged: false, placeholder: true, note: "Placeholder checkout. Nothing was charged.", createdAt: Date.now(),
  };
  const d = listDoc(ORDERS);
  d.list.unshift(order);
  d.list = d.list.slice(0, 100);
  save(ORDERS, d);
  return { charged: false, placeholder: true, order };
}

// ---------- demo catalog (bundled, no network) ----------
const DEMO_RAW = [
  {
    id: "demo-week-of-posts",
    title: "Demo: week of posts",
    category: "Social Posts",
    promise: "Four post ideas with captions, from your brand notes.",
    example: "Monday: the door opens. Caption: Come in warm.",
    price: { type: "free", usd: 0, placeholder: false },
    pipeline: {
      name: "Demo: week of posts", icon: "📅", category: "Social Posts",
      description: "A short demo pipeline from the local catalog.",
      inputs: [{ key: "brand", label: "Brand", placeholder: "Your brand" }, { key: "offer", label: "Offer", placeholder: "What you are announcing" }],
      steps: [
        { title: "Angles", capability: "creative", instructions: "Give three angles for {brand} announcing {offer}. No invented numbers.", deliverable: "Three angles" },
        { title: "Captions", capability: "writing", deps: [1], instructions: "Write four captions from the best angle. Mark unknowns as [ASK].", deliverable: "Four captions" },
      ],
      assembly: "Angles, then captions.",
    },
  },
  {
    id: "demo-client-proposal",
    title: "Demo: client proposal",
    category: "Client Work",
    promise: "A short proposal draft from the facts you type. It is never sent.",
    example: "Problem, plan, and one next step, with [ASK] where a number is missing.",
    price: { type: "free", usd: 0, placeholder: false },
    pipeline: {
      name: "Demo: client proposal", icon: "📝", category: "Client Work",
      description: "A short demo proposal pipeline from the local catalog.",
      inputs: [{ key: "client", label: "Client", placeholder: "Client name" }, { key: "need", label: "What they asked for", placeholder: "A one-page site" }],
      steps: [
        { title: "Problem and goals", capability: "analysis", instructions: "State the problem for {client} and two goals, using only this need: {need}. Mark gaps as [ASK].", deliverable: "Problem and goals" },
        { title: "Proposal draft", capability: "writing", deps: [1], instructions: "A short proposal: plan, what is included, and one next step. Every unknown amount is [ASK]. A draft for review. It is never sent from here.", deliverable: "Proposal draft" },
      ],
      assembly: "Problem and goals, then the proposal draft.",
    },
  },
  {
    id: "demo-follow-up",
    title: "Demo: follow-up notes",
    category: "Sales",
    promise: "Three short follow-up notes after a first call. Placeholder price.",
    example: "Thanks for the time today. The next step is the one you choose.",
    price: { type: "once", usd: 12, placeholder: true },
    pipeline: {
      name: "Demo: follow-up notes", icon: "✉", category: "Sales",
      description: "A demo sales pipeline from the local catalog. It drafts notes. It does not send them.",
      inputs: [{ key: "client", label: "Client", placeholder: "Client name" }, { key: "topic", label: "What you discussed", placeholder: "The work they asked about" }],
      steps: [
        { title: "Call summary", capability: "analysis", instructions: "Summarize the first call with {client} about {topic}. Use only the inputs. Mark gaps as [ASK].", deliverable: "Short summary" },
        { title: "Three notes", capability: "writing", deps: [1], instructions: "Write three follow-up notes the person can review. Do not say they were sent.", deliverable: "Three notes" },
      ],
      assembly: "Summary, then the three notes, labeled as drafts.",
    },
  },
];

function demoListing(raw) {
  const pipeline = cleanPipeline(raw.pipeline);
  return {
    id: raw.id, kind: "pipeline", title: raw.title, category: raw.category, promise: raw.promise, example: raw.example || "",
    version: 1, status: "listed", price: raw.price, pipeline, steps: stepBrief(pipeline.steps),
    seller: { name: "Demo catalog", demo: true }, demo: true, local: false, sourceId: null,
    createdAt: 0, updatedAt: 0,
  };
}
const DEMO = DEMO_RAW.map(demoListing);
for (const item of DEMO) assertClean(textsOfPipeline(item.pipeline, [item.title, item.promise, item.example]));

const demoState = () => doc(DEMO_STATE, () => ({ hidden: {}, installs: {} }));
const demoHidden = (id) => !!demoState().hidden?.[id];
function catalogDemo() {
  const st = demoState();
  return DEMO.filter((d) => !st.hidden?.[d.id]).map((d) => ({ ...d, statsInstalls: st.installs?.[d.id] || 0 }));
}
function demoById(id) { return DEMO.find((d) => d.id === id) || null; }

// ---------- local listings ----------
function mustLocal(id) {
  const row = listDoc(LISTINGS).list.find((x) => x.id === id);
  if (!row) throw err(404, "No such listing.");
  return row;
}
function scanListing(row) {
  const extra = [row.title, row.promise, row.example];
  if (row.kind === "pipeline") return scanForListing(textsOfPipeline(row.pipeline, extra));
  const blob = JSON.stringify(row.bundle || {});
  return scanForListing([...extra, blob]);
}
function bundleFromAgent(id) {
  const item = getAgent(id);
  if (!item) throw err(404, "No such agent.");
  const bundle = exportBundle({ agents: [id], prompts: [] });
  for (const a of bundle.agents) a.libraries = [];
  assertClean([item.name, item.description, item.instructions, ...(item.starters || [])]);
  return { title: item.name, bundle, kind: "agent" };
}
function bundleFromPrompt(id) {
  const item = getPrompt(id);
  if (!item) throw err(404, "No such prompt.");
  const bundle = exportBundle({ agents: item.agentId ? [item.agentId] : [], prompts: [id] });
  for (const a of bundle.agents) a.libraries = [];
  assertClean([item.name, item.description, item.text]);
  return { title: item.name, bundle, kind: "prompt" };
}
function fromDraft(id) {
  const draft = listListings().find((x) => x.id === id);
  if (!draft) throw err(404, "No such listing draft.");
  const bundle = draft.bundle;
  if (bundle?.agents) for (const a of bundle.agents) a.libraries = [];
  assertClean([draft.title, draft.promise, JSON.stringify(bundle || {})]);
  return { title: draft.title, bundle, kind: draft.kind, category: draft.category, promise: draft.promise };
}

function listingFromInput(input, prev) {
  const draft = input.draftId ? fromDraft(input.draftId) : null;
  const category = CATEGORIES.includes(input.category) ? input.category : (CATEGORIES.includes(draft?.category) ? draft.category : (prev?.category || null));
  if (!category) throw err(400, `Pick a category: ${CATEGORIES.join(", ")}.`);
  const promise = input.promise !== undefined ? str(input.promise, 140) : (draft?.promise || prev?.promise || "");
  if (promise.length < 8) throw err(400, "Write the one-line promise buyers will see.");
  const example = input.example !== undefined ? str(input.example, 500) : (prev?.example || "");
  const price = (input.priceType || input.priceUsd !== undefined) ? cleanPrice(input) : (prev?.price || cleanPrice({ type: "free" }));
  let kind = input.kind || prev?.kind;
  let title = prev?.title || "";
  let pipeline = prev?.pipeline || null;
  let bundle = prev?.bundle || null;
  let sourceId = prev?.sourceId || null;
  if (draft) {
    kind = draft.kind; title = draft.title; bundle = draft.bundle; pipeline = null; sourceId = input.draftId;
  } else if (input.pipeline) {
    pipeline = cleanPipeline(input.pipeline);
    kind = "pipeline";
    title = pipeline.name;
    sourceId = input.pipeline.id || sourceId;
    bundle = null;
  } else if (kind === "agent" && input.itemId) {
    const d = bundleFromAgent(input.itemId);
    kind = "agent"; title = d.title; bundle = d.bundle; pipeline = null; sourceId = input.itemId;
  } else if (kind === "prompt" && input.itemId) {
    const d = bundleFromPrompt(input.itemId);
    kind = "prompt"; title = d.title; bundle = d.bundle; pipeline = null; sourceId = input.itemId;
  }
  if (kind !== "pipeline" && kind !== "agent" && kind !== "prompt") throw err(400, "Kind must be pipeline, agent, or prompt.");
  if (kind === "pipeline" && !pipeline) throw err(400, "Pick a pipeline to list.");
  if (kind !== "pipeline" && !bundle) throw err(400, "Pick an agent or a prompt to list.");
  assertClean(kind === "pipeline" ? textsOfPipeline(pipeline, [title, promise, example]) : [title, promise, example, JSON.stringify(bundle)]);
  const steps = kind === "pipeline" ? stepBrief(pipeline.steps) : kind === "agent"
    ? [{ title: "Agent instructions", capability: "writing" }]
    : [{ title: "Saved prompt", capability: "writing" }];
  return { kind, title, category, promise, example, price, pipeline, bundle, sourceId, steps };
}

export function createListing(input = {}) {
  const built = listingFromInput(input, null);
  const d = listDoc(LISTINGS);
  if (d.list.length >= 100) throw err(400, "100 listings at most.");
  const row = {
    id: newId("mkt"), ...built, version: 1, status: "draft", rejection: "",
    seller: { name: "You", demo: false }, demo: false, local: true, createdAt: Date.now(), updatedAt: Date.now(),
  };
  if (input.submit) {
    row.status = "pending";
    emit("log", { text: `Marketplace: "${row.title}" was submitted for review. It is not in the catalog yet.` });
  }
  d.list.unshift(row);
  save(LISTINGS, d);
  return ownerView(row);
}

export function updateListing(id, input = {}) {
  const row = mustLocal(id);
  if (row.status === "pending") throw err(400, "This listing is waiting for review. Reject it before editing.");
  const next = listingFromInput({ ...input, kind: row.kind }, row);
  const changed = JSON.stringify({ ...next, steps: next.steps }) !== JSON.stringify({ kind: row.kind, title: row.title, category: row.category, promise: row.promise, example: row.example, price: row.price, pipeline: row.pipeline, bundle: row.bundle, sourceId: row.sourceId, steps: row.steps });
  Object.assign(row, next, { updatedAt: Date.now() });
  if (changed && (row.status === "listed" || row.status === "pulled")) row.version += 1;
  if (row.status === "rejected") row.rejection = "";
  save(LISTINGS, listDoc(LISTINGS));
  return ownerView(row);
}

export function submitListing(id) {
  const row = mustLocal(id);
  if (row.status !== "draft" && row.status !== "rejected") throw err(400, "Only a draft or a rejected listing can be submitted.");
  const flagged = scanListing(row);
  if (flagged.length) throw err(400, `This cannot be listed: it ${flagged.join(" and ")}.`, { code: "flagged", flagged });
  row.status = "pending";
  row.rejection = "";
  row.updatedAt = Date.now();
  save(LISTINGS, listDoc(LISTINGS));
  emit("log", { text: `Marketplace: "${row.title}" was submitted for review. It is not in the catalog yet.` });
  return ownerView(row);
}

export function deleteListing(id) {
  const d = listDoc(LISTINGS);
  const n = d.list.length;
  d.list = d.list.filter((x) => x.id !== id);
  if (d.list.length === n) throw err(404, "No such listing.");
  save(LISTINGS, d);
  return { ok: true };
}

function closeReports(listingId) {
  const d = listDoc(REPORTS);
  let touched = false;
  for (const r of d.list) if (r.listingId === listingId && r.open) { r.open = false; touched = true; }
  if (touched) save(REPORTS, d);
}

export function moderateListing(id, action, reason) {
  if (action !== "approve" && action !== "reject") throw err(400, "Action must be approve or reject.");
  const demo = demoById(id);
  if (demo) {
    const st = demoState();
    if (action === "approve") {
      delete st.hidden[id];
      save(DEMO_STATE, st);
      closeReports(id);
      return { ok: true, id, status: "listed", demo: true };
    }
    const why = str(reason, 300);
    if (why.length < 4) throw err(400, "Write a short reason for keeping it hidden.");
    st.hidden[id] = { reason: why, at: Date.now() };
    save(DEMO_STATE, st);
    return { ok: true, id, status: "pulled", demo: true };
  }
  const row = mustLocal(id);
  if (row.status !== "pending" && row.status !== "pulled") throw err(400, "Only a listing waiting for review can be moderated.");
  if (action === "approve") {
    const flagged = scanListing(row);
    if (flagged.length) throw err(400, `This cannot be listed: it ${flagged.join(" and ")}.`, { code: "flagged", flagged });
    row.status = "listed";
    row.rejection = "";
    row.updatedAt = Date.now();
    save(LISTINGS, listDoc(LISTINGS));
    closeReports(id);
    emit("log", { text: `Marketplace: "${row.title}" is in the local catalog.` });
    return ownerView(row);
  }
  const why = str(reason, 300);
  if (why.length < 4) throw err(400, "Write a short reason for the rejection.");
  row.status = "rejected";
  row.rejection = why;
  row.updatedAt = Date.now();
  save(LISTINGS, listDoc(LISTINGS));
  closeReports(id);
  return ownerView(row);
}

export function reportListing(id, reason) {
  const why = str(reason, 300);
  if (why.length < 4) throw err(400, "Write a short reason for the report.");
  const listed = listedById(id);
  if (!listed) throw err(404, "That listing is not in the catalog.");
  const d = listDoc(REPORTS);
  d.list.unshift({ id: newId("rp"), listingId: id, reason: why, at: Date.now(), demo: !!listed.demo, open: true });
  d.list = d.list.slice(0, 200);
  save(REPORTS, d);
  if (listed.demo) {
    const st = demoState();
    st.hidden[id] = { reason: why, at: Date.now() };
    save(DEMO_STATE, st);
  } else {
    const row = mustLocal(id);
    row.status = "pulled";
    row.updatedAt = Date.now();
    save(LISTINGS, listDoc(LISTINGS));
  }
  emit("log", { text: `Marketplace: "${listed.title}" was pulled pending review.` });
  return { ok: true, status: "pulled" };
}

// ---------- catalog, ratings, installs ----------
function ratingFor(id) {
  const rows = listDoc(RATINGS).list.filter((r) => r.listingId === id);
  if (!rows.length) return { average: null, count: 0 };
  const average = Math.round((rows.reduce((s, r) => s + r.stars, 0) / rows.length) * 10) / 10;
  return { average, count: rows.length };
}
function bumpInstall(row) {
  if (row.demo) {
    const st = demoState();
    st.installs[row.id] = (st.installs[row.id] || 0) + 1;
    save(DEMO_STATE, st);
    return;
  }
  row.installs = (row.installs || 0) + 1;
  save(LISTINGS, listDoc(LISTINGS));
}
function listedRows() {
  const local = listDoc(LISTINGS).list.filter((x) => x.status === "listed");
  return [...catalogDemo(), ...local];
}
function listedById(id) { return listedRows().find((x) => x.id === id) || null; }
function anyById(id) { return listedById(id) || listDoc(LISTINGS).list.find((x) => x.id === id) || (demoHidden(id) ? { ...demoById(id), status: "pulled" } : null); }

function snapshotOf(row) {
  if (row.kind === "pipeline") return row.pipeline.steps;
  if (row.kind === "agent") return [{ title: row.title, capability: "agent", instructions: row.bundle?.agents?.[0]?.instructions || "" }];
  return [{ title: row.title, capability: "prompt", instructions: row.bundle?.prompts?.[0]?.text || "" }];
}
export function stepDiff(before, after) {
  const b = before || [], a = after || [];
  const added = [], removed = [], changed = [];
  const n = Math.max(b.length, a.length);
  for (let i = 0; i < n; i++) {
    if (!b[i] && a[i]) added.push({ n: i + 1, title: a[i].title, capability: a[i].capability });
    else if (b[i] && !a[i]) removed.push({ n: i + 1, title: b[i].title, capability: b[i].capability });
    else if (b[i].title !== a[i].title || b[i].capability !== a[i].capability || (b[i].instructions || "") !== (a[i].instructions || "")) {
      changed.push({ n: i + 1, from: b[i].title, to: a[i].title, capability: a[i].capability, instructionsChanged: (b[i].instructions || "") !== (a[i].instructions || "") });
    }
  }
  return { added, removed, changed };
}

const payout = () => ({ connected: false, note: COPY.payout });
function card(row) {
  const installs = row.demo ? (row.statsInstalls ?? (demoState().installs?.[row.id] || 0)) : (row.installs || 0);
  return {
    id: row.id, kind: row.kind, title: row.title, category: row.category, promise: row.promise, example: row.example || "",
    version: row.version, status: row.status, price: row.price, revenueShare: REVENUE_SHARE, payout: payout(),
    seller: row.seller, demo: !!row.demo, steps: row.steps, stats: { installs, rating: ratingFor(row.id), avgCostUsd: null, avgCostNote: "No receipt average yet" },
  };
}
function ownerView(row) {
  return { ...card(row), local: true, sourceId: row.sourceId, rejection: row.rejection || "", pipeline: row.pipeline || null, hasBundle: !!row.bundle };
}

function savePipelineCopy(pipeline, meta) {
  const item = { ...cleanPipeline(pipeline), id: newId("p"), createdAt: Date.now(), sourceListing: meta.listingId || null, sourceVersion: meta.version || null, installedAt: Date.now() };
  const d = doc(PIPELINES, () => ({ items: [] }));
  d.items ||= [];
  d.items.push(item);
  save(PIPELINES, d);
  return item;
}
function replacePipeline(pipelineId, pipeline, meta) {
  const d = doc(PIPELINES, () => ({ items: [] }));
  d.items ||= [];
  const i = d.items.findIndex((x) => x.id === pipelineId);
  const base = { ...cleanPipeline(pipeline), sourceListing: meta.listingId || null, sourceVersion: meta.version || null, installedAt: Date.now() };
  if (i < 0) {
    const item = { ...base, id: newId("p"), createdAt: Date.now() };
    d.items.push(item);
    save(PIPELINES, d);
    return item;
  }
  d.items[i] = { ...d.items[i], ...base, id: pipelineId };
  save(PIPELINES, d);
  return d.items[i];
}

function recordInstall(row, extra) {
  const d = listDoc(INSTALLS);
  const prev = d.list.find((x) => x.listingId === row.id);
  const rec = {
    id: prev?.id || newId("in"), listingId: row.id, version: row.version, kind: row.kind, title: row.title,
    snapshot: snapshotOf(row), installedAt: Date.now(), ...extra,
  };
  if (prev) Object.assign(prev, rec); else d.list.unshift(rec);
  save(INSTALLS, d);
  return rec;
}

function installBody(row, gate) {
  let saved = null;
  let imported = null;
  if (row.kind === "pipeline") saved = savePipelineCopy(row.pipeline, { listingId: row.id, version: row.version });
  else imported = importBundle(row.bundle);
  const rec = recordInstall(row, {
    pipelineId: saved?.id || null,
    agentIds: imported?.agents?.map((a) => a.id) || [],
    promptIds: imported?.prompts?.map((p) => p.id) || [],
  });
  bumpInstall(row);
  emit("log", { text: `Marketplace: installed "${row.title}". Nothing ran and nothing was charged.` });
  return {
    ok: true, charged: gate.charged, placeholder: gate.placeholder, ran: false, already: false,
    order: gate.order ? { id: gate.order.id, usd: gate.order.usd, charged: false, placeholder: true, note: gate.order.note } : null,
    installed: { listingId: row.id, version: rec.version, kind: row.kind, pipelineId: rec.pipelineId, agentIds: rec.agentIds, promptIds: rec.promptIds },
  };
}

export function installListing(id) {
  const row = listedById(id);
  if (!row) throw err(404, "That listing is not in the catalog.");
  const prev = listDoc(INSTALLS).list.find((x) => x.listingId === id);
  if (prev && prev.version >= row.version) {
    return { ok: true, charged: false, placeholder: isPaid(row.price), ran: false, already: true, order: null, installed: { listingId: id, version: prev.version, kind: prev.kind, pipelineId: prev.pipelineId || null, agentIds: prev.agentIds || [], promptIds: prev.promptIds || [] } };
  }
  if (prev && prev.version < row.version) throw err(409, "An update is available. Use update, which still does not run the pipeline.", { code: "update" });
  const gate = gatePaid(row);
  return installBody(row, gate);
}

export function applyUpdate(id) {
  const row = listedById(id);
  if (!row) throw err(404, "That listing is not in the catalog.");
  const prev = listDoc(INSTALLS).list.find((x) => x.listingId === id);
  if (!prev) throw err(404, "Install the listing before updating it.");
  if (prev.version >= row.version) return { ok: true, already: true, ran: false, charged: false, diff: { added: [], removed: [], changed: [] } };
  const diff = stepDiff(prev.snapshot, snapshotOf(row));
  if (row.kind === "pipeline") {
    const saved = replacePipeline(prev.pipelineId, row.pipeline, { listingId: row.id, version: row.version });
    prev.pipelineId = saved.id;
  } else {
    const imported = importBundle(row.bundle);
    prev.agentIds = imported.agents?.map((a) => a.id) || prev.agentIds;
    prev.promptIds = imported.prompts?.map((p) => p.id) || prev.promptIds;
  }
  prev.version = row.version;
  prev.snapshot = snapshotOf(row);
  prev.title = row.title;
  prev.installedAt = Date.now();
  save(INSTALLS, listDoc(INSTALLS));
  emit("log", { text: `Marketplace: updated "${row.title}" to version ${row.version}. Nothing ran.` });
  return { ok: true, already: false, ran: false, charged: false, version: row.version, diff };
}

export function rateListing(id, stars, note) {
  const n = Number(stars);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw err(400, "Stars are from 1 to 5.");
  if (!listedById(id) && !demoById(id)) throw err(404, "No such listing.");
  const inst = listDoc(INSTALLS).list.find((x) => x.listingId === id);
  if (!inst) throw err(400, "Install the listing before rating it.");
  const d = listDoc(RATINGS);
  const prev = d.list.find((r) => r.listingId === id);
  const row = { listingId: id, stars: n, note: str(note, 300), at: Date.now() };
  if (prev) Object.assign(prev, row); else d.list.push(row);
  save(RATINGS, d);
  return { ok: true, rating: ratingFor(id) };
}

// ---------- signed file and share link ----------
function fileFields(row, pipeline) {
  if (row) {
    return {
      shareId: newId("sh"), kind: row.kind, listingId: row.id, title: row.title, category: row.category,
      promise: row.promise, price: row.price, itemVersion: row.version,
      pipeline: row.kind === "pipeline" ? row.pipeline : undefined,
      bundle: row.kind === "pipeline" ? undefined : row.bundle,
    };
  }
  const clean = cleanPipeline(pipeline);
  return { shareId: newId("sh"), kind: "pipeline", listingId: null, title: clean.name, category: clean.category, promise: clean.description || clean.name, price: { type: "free", usd: 0, placeholder: false }, itemVersion: 1, pipeline: clean };
}

function storeShare(file) {
  const token = crypto.randomBytes(24).toString("hex");
  const d = listDoc(SHARES);
  d.list.unshift({ id: file.shareId, tokenHash: crypto.createHash("sha256").update(token).digest("hex"), file, createdAt: Date.now() });
  d.list = d.list.slice(0, 50);
  save(SHARES, d);
  return { id: file.shareId, path: `/api/marketplace/share/${file.shareId}`, token };
}

export function exportTemplate({ pipeline, listingId } = {}) {
  if (listingId) {
    const row = listedById(listingId) || listDoc(LISTINGS).list.find((x) => x.id === listingId);
    if (!row) throw err(404, "No such listing.");
    if (isPaid(row.price) && !paidEnabled()) throw err(409, "Paid listings are turned off. No charge was made.", { code: "paid_off", charged: false, placeholder: true });
    const secret = row.demo ? DEMO_KEY : ensureLocalSecret();
    const file = signWith(secret, row.demo ? "demo" : "local", fileFields(row));
    const share = storeShare(file);
    return { file, share, note: COPY.share };
  }
  if (!pipeline) throw err(400, "Pick a pipeline to export.");
  assertClean(textsOfPipeline(cleanPipeline(pipeline)));
  const file = signWith(ensureLocalSecret(), "local", fileFields(null, pipeline));
  const share = storeShare(file);
  return { file, share, note: COPY.share };
}

export function readShare(id, token) {
  const row = listDoc(SHARES).list.find((s) => s.id === id);
  if (!row || !token) throw err(401, "Share link token is missing or wrong.", { code: "share" });
  const hash = crypto.createHash("sha256").update(String(token)).digest("hex");
  if (!safeEqual(hash, row.tokenHash)) throw err(401, "Share link token is missing or wrong.", { code: "share" });
  return { file: row.file, note: COPY.share };
}

export function importTemplate({ file, shareId, token } = {}) {
  let signed = file;
  if (shareId) signed = readShare(shareId, token).file;
  if (typeof signed === "string") { try { signed = JSON.parse(signed); } catch { throw err(400, "That file is not JSON."); } }
  const body = verifyFile(signed);
  if (body.kind === "pipeline") {
    const existing = body.listingId ? listDoc(INSTALLS).list.find((x) => x.listingId === body.listingId) : null;
    if (existing && existing.version >= (body.itemVersion || 1)) {
      return { ok: true, already: true, ran: false, charged: false, pipelineId: existing.pipelineId };
    }
    const gate = isPaid(body.price) ? gatePaid({ id: body.listingId, price: body.price }) : { charged: false, placeholder: false };
    const saved = savePipelineCopy(body.pipeline, { listingId: body.listingId, version: body.itemVersion });
    if (body.listingId && listedById(body.listingId)) {
      const row = listedById(body.listingId);
      recordInstall(row, { pipelineId: saved.id, agentIds: [], promptIds: [] });
      bumpInstall(row);
    }
    emit("log", { text: `Marketplace: imported "${saved.name}". Nothing ran.` });
    return { ok: true, already: false, ran: false, charged: gate.charged, placeholder: !!gate.placeholder, kind: "pipeline", pipelineId: saved.id, title: saved.name };
  }
  if (isPaid(body.price)) gatePaid({ id: body.listingId, price: body.price });
  const imported = importBundle(body.bundle);
  emit("log", { text: "Marketplace: imported an agent or prompt file. Nothing ran." });
  return { ok: true, ran: false, charged: false, kind: body.kind, agents: imported.agents?.map((a) => a.id) || [], prompts: imported.prompts?.map((p) => p.id) || [] };
}

function queueRows() {
  const local = listDoc(LISTINGS).list.filter((x) => x.status === "pending" || x.status === "pulled").map((x) => ({ id: x.id, title: x.title, status: x.status, demo: false, reason: x.rejection || "" }));
  const st = demoState();
  const hidden = Object.entries(st.hidden || {}).map(([id, info]) => ({ id, title: demoById(id)?.title || id, status: "pulled", demo: true, reason: info?.reason || "" }));
  const reports = listDoc(REPORTS).list.filter((r) => r.open).map((r) => ({ reportId: r.id, id: r.listingId, title: anyById(r.listingId)?.title || r.listingId, status: "report", demo: !!r.demo, reason: r.reason }));
  return { listings: [...local, ...hidden], reports };
}

export function overview() {
  const installs = listDoc(INSTALLS).list.map((rec) => {
    const row = listedById(rec.listingId);
    const updateAvailable = !!(row && row.version > rec.version);
    return {
      listingId: rec.listingId, title: rec.title, kind: rec.kind, version: row?.version ?? null, installedVersion: rec.version,
      updateAvailable, pipelineId: rec.pipelineId || null, pulled: !row,
      diff: updateAvailable ? stepDiff(rec.snapshot, snapshotOf(row)) : null,
    };
  });
  return {
    catalog: listedRows().map(card),
    mine: listDoc(LISTINGS).list.map(ownerView),
    installed: installs,
    queue: queueRows(),
    revenueShare: REVENUE_SHARE,
    payout: payout(),
    paidEnabled: paidEnabled(),
    categories: CATEGORIES,
    prices: PLACEHOLDER_PRICES_USD,
    copy: COPY,
    remoteCatalog: false,
  };
}
