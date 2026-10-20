// Saved pipelines: a mission with its steps already decided. One click runs it for a project.
// Starter templates ship for common creative and client work; users can save their own from any mission.
import { nextDiscountWindow } from "../router.js";
import { scheduleMission } from "../mission.js";
import { normalizeMode } from "../modes.js";
export const id = "pipelines";

const TEMPLATES = [
  {
    id: "instagram-week", name: "Instagram week", icon: "📅", category: "Social Posts",
    description: "Seven posts for one brand: hooks, captions, hashtags, visual direction, posting schedule, checklist.",
    inputs: [{ key: "brand", label: "Brand or product", placeholder: "Your brand · new launch" }, { key: "goal", label: "What should the week achieve?", placeholder: "Sign-ups for the launch" }, { key: "tone", label: "Tone", placeholder: "warm, direct, no hashtags in first line" }],
    steps: [
      { title: "Audience and angles", capability: "research", instructions: "Describe who this is for and the three angles most likely to land this week.", deliverable: "Audience notes and 3 ranked angles" },
      { title: "Seven post concepts", capability: "creative", deps: [1], instructions: "Seven posts (mix of reels, carousels, stills) with a one-line hook each, built on the best angle.", deliverable: "Numbered list: format, hook, visual" },
      { title: "Captions and hashtags", capability: "writing", deps: [2], instructions: "Write the caption for each post in the brand tone, with a hashtag set per post.", deliverable: "Seven captions, each with hashtags" },
      { title: "Visual briefs", capability: "creative", deps: [2], instructions: "For each post, a shot or image brief precise enough to generate with an AI video or image tool.", deliverable: "Seven visual briefs" },
      { title: "Schedule and checklist", capability: "analysis", deps: [3, 4], instructions: "Dated posting schedule for the next 7 days with best times, plus a go-live checklist.", deliverable: "Schedule table and checklist" },
    ],
    assembly: "One document in this order: the week at a glance (table), then each post with hook, caption, hashtags and visual brief, then the checklist.",
  },
  {
    id: "music-video", name: "Music video from a song", icon: "🎬", category: "Music Videos",
    description: "From lyrics to a shot list ready for Kling or Flow: concept, scenes, prompts per shot, lip-sync plan, edit map.",
    inputs: [{ key: "song", label: "Song title and artist", placeholder: "Song title – Artist" }, { key: "lyrics", label: "Lyrics (paste)", multiline: true }, { key: "look", label: "Look and references", placeholder: "night, rain on glass, one practical light, real photo first frames" }],
    steps: [
      { title: "Concept and story beats", capability: "creative", instructions: "A one-paragraph concept and 6–10 story beats mapped to the song structure (verse, chorus, bridge).", deliverable: "Concept + beats with timestamps" },
      { title: "Shot list", capability: "creative", deps: [1], instructions: "A numbered shot list (25–40 shots, 3–5 s each) with camera, action, lighting; mouths mostly closed; small human beats (sigh, look down); no exaggerated motion.", deliverable: "Shot list table" },
      { title: "Generation prompts", capability: "writing", deps: [2], instructions: "For each shot, an image-to-video prompt for Kling 3.0 and a first-frame still prompt, under 60 words each, consistent character and wardrobe.", deliverable: "Prompt per shot" },
      { title: "Lip-sync and audio plan", capability: "analysis", deps: [2], instructions: "Which shots carry lip-sync, which are B-roll, where the hook lands, and the Sync.so settings to use.", deliverable: "Lip-sync map" },
      { title: "Edit map and credits budget", capability: "analysis", deps: [3, 4], instructions: "Beat-cut edit map with shot numbers per bar, plus a credits estimate (Kling credits per 5 s clip, retries capped at 3).", deliverable: "Edit map + credit budget" },
    ],
    assembly: "Director's packet: concept, beats, shot list with prompts inline, lip-sync map, edit map, credit budget.",
  },
  {
    id: "client-proposal", name: "Client proposal", icon: "📝", category: "Client Work",
    description: "A proposal ready to send after review: the client's problem, the plan, scope and timeline, pricing options, next step.",
    inputs: [{ key: "client", label: "Client and industry", placeholder: "Client name · industry" }, { key: "need", label: "What they asked for", placeholder: "New website and a lead follow-up system" }, { key: "budget", label: "Your price or range (facts only)", placeholder: "leave blank to mark it [ASK]" }],
    steps: [
      { title: "Client problem and goals", capability: "analysis", instructions: "In the client's own terms: what is broken or missing today, what it costs them, and the two or three outcomes they want.", deliverable: "Problem statement and goals" },
      { title: "Proposed plan", capability: "reasoning", deps: [1], instructions: "The solution in plain steps, what is included and what is not, and why this order. No invented numbers; mark unknowns as [ASK].", deliverable: "Plan with in-scope and out-of-scope lists" },
      { title: "Timeline and deliverables", capability: "analysis", deps: [2], instructions: "Phases with deliverables and what the client must provide for each. Durations only where they follow from the inputs; otherwise [ASK].", deliverable: "Timeline table" },
      { title: "Pricing options", capability: "writing", deps: [2], instructions: "Two or three options built only from the price given in the inputs. If no price was given, keep the structure and write [ASK] for every amount.", deliverable: "Options table" },
      { title: "Proposal letter", capability: "writing", deps: [1, 3, 4], instructions: "A short cover letter, the proposal in order, and one clear next step (call, signature, deposit). A draft for review; it is never sent from here.", deliverable: "Proposal draft" },
    ],
    assembly: "Proposal: cover letter, problem and goals, plan, timeline, pricing options, next step. Keep every [ASK] marker visible.",
  },
  {
    id: "client-site-launch", name: "Client site launch", icon: "🚀", category: "Client Work",
    description: "Everything to launch a small-business site: pages and copy, SEO basics, launch checklist, first-week posts.",
    inputs: [{ key: "client", label: "Client and industry", placeholder: "Client name · industry" }, { key: "offer", label: "Main offer / call to action", placeholder: "Free 15-minute call" }, { key: "proof", label: "Proof points (facts only)", placeholder: "years in business, licences, number of customers" }],
    steps: [
      { title: "Site map and page goals", capability: "analysis", instructions: "Pages the site needs, each page's single job, and the primary call to action.", deliverable: "Site map table" },
      { title: "Home and service copy", capability: "writing", deps: [1], instructions: "Headline, subhead, sections and CTA copy for the home page and each service page. No invented numbers; mark unknowns as [ASK CLIENT].", deliverable: "Copy per page" },
      { title: "SEO basics", capability: "research", deps: [1], instructions: "Title tags, meta descriptions, H1s, 10 target keywords with intent, local SEO checklist (Google Business Profile, citations).", deliverable: "SEO sheet" },
      { title: "Launch checklist", capability: "analysis", deps: [2, 3], instructions: "DNS, SSL, forms to CRM, analytics, sitemap, redirects, legal pages, test matrix.", deliverable: "Checklist with owners" },
      { title: "First-week posts", capability: "creative", deps: [2], instructions: "Five social posts announcing the launch, each with hook, caption and visual idea.", deliverable: "Five posts" },
    ],
    assembly: "Launch packet: site map, copy by page, SEO sheet, checklist, first-week posts.",
  },
];

const KIND = "pipelines.saved";

function allPipelines(h) {
  const saved = h.doc(KIND, () => ({ items: [] })).items || [];
  return [...TEMPLATES.map((t) => ({ ...t, builtIn: true })), ...saved];
}

// Read-only lookup so another plugin can export a template without copying the starters.
export function findPipeline(h, id) {
  if (!id) return null;
  return allPipelines(h).find((x) => x.id === id) || null;
}

function fillInputs(text, values) {
  return String(text || "").replace(/\{(\w+)\}/g, (m, k) => values[k] ?? m);
}

// Turn a pipeline into a mission goal + context the planner must follow.
function toMission(p, values, projectId) {
  const inputs = (p.inputs || []).map((i) => `${i.label}: ${values[i.key] || "(not given)"}`).join("\n");
  const steps = p.steps.map((s, i) => `${i + 1}. ${s.title} [${s.capability}]${s.deps?.length ? ` (after ${s.deps.join(", ")})` : ""}: ${fillInputs(s.instructions, values)} Deliverable: ${fillInputs(s.deliverable, values)}`).join("\n");
  const goal = `${p.name}${values.brand || values.song || values.client ? ` for ${values.brand || values.song || values.client}` : ""}`;
  const context = `INPUTS\n${inputs}\n\nPIPELINE (use exactly these tasks, in this order, with these dependencies; do not add or merge tasks):\n${steps}\n\nASSEMBLY: ${p.assembly || "Combine into one clean document."}`;
  return { goal, context, projectId, mode: normalizeMode(p.mode) || "balanced", qa: p.qa !== false, budgetUsd: p.budgetUsd || 3 };
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/pipelines/, "");
  if (req.method === "GET" && (p === "" || p === "/")) return h.json(res, 200, allPipelines(h));
  if (req.method === "POST" && p === "/run") {
    const pl = allPipelines(h).find((x) => x.id === body.id);
    if (!pl) return h.json(res, 404, { error: "pipeline not found" });
    try { h.requireFeature("missions"); if (body.runAt === "offpeak") h.guard("scheduler"); } catch (e) { return h.json(res, e.status || 402, { error: e.message, code: e.code }); }
    const m = toMission(pl, body.values || {}, body.projectId || null);
    const st = h.doc("pipelines.runs", () => ({ runs: [] }));
    const remember = (extra = {}) => { st.runs.unshift({ pipelineId: pl.id, name: pl.name, projectId: m.projectId, startedAt: Date.now(), values: body.values || {}, ...extra }); st.runs = st.runs.slice(0, 100); h.putDoc("pipelines.runs", st); };
    // Off-peak: queue it for the next discount window, the same way a mission from Command is queued
    const win = body.runAt === "offpeak" ? nextDiscountWindow() : null;
    if (win) {
      const q = scheduleMission(m, win.at, `${win.rule.name}, ${win.rule.pct}% off`);
      remember({ scheduledFor: q.scheduledFor });
      return h.json(res, 202, { ok: true, goal: m.goal, scheduled: q });
    }
    h.emit("log", { text: `Pipeline "${pl.name}" started${m.projectId ? ` for project ${m.projectId}` : ""}.` });
    const promise = h.runMission(m);
    promise.catch((e) => h.emit("log", { text: `Pipeline failed: ${e.message}`, level: "error" }));
    remember();
    return h.json(res, 202, { ok: true, goal: m.goal });
  }
  if (req.method === "POST" && p === "/save") {
    // save a custom pipeline (from a finished mission's plan, or hand-written)
    const d = h.doc(KIND, () => ({ items: [] }));
    const item = { id: body.id || "p-" + Date.now().toString(36), name: String(body.name || "Untitled pipeline").slice(0, 80), icon: body.icon || "✦", category: body.category || "Custom", description: String(body.description || "").slice(0, 300), inputs: Array.isArray(body.inputs) ? body.inputs.slice(0, 8) : [], steps: (Array.isArray(body.steps) ? body.steps : []).slice(0, 10).map((s, i) => ({ title: String(s.title || `Step ${i + 1}`).slice(0, 80), capability: s.capability || "writing", deps: (s.deps || []).map(Number).filter(Boolean), instructions: String(s.instructions || "").slice(0, 1000), deliverable: String(s.deliverable || "").slice(0, 300) })), assembly: String(body.assembly || "").slice(0, 400), mode: normalizeMode(body.mode) || "balanced", qa: body.qa !== false, budgetUsd: Number(body.budgetUsd) || 3, createdAt: Date.now() };
    if (!item.steps.length) return h.json(res, 400, { error: "a pipeline needs at least one step" });
    const i = d.items.findIndex((x) => x.id === item.id);
    if (i >= 0) d.items[i] = item; else d.items.push(item);
    h.putDoc(KIND, d);
    return h.json(res, 200, item);
  }
  if (req.method === "DELETE" && p.startsWith("/")) {
    const d = h.doc(KIND, () => ({ items: [] }));
    d.items = d.items.filter((x) => x.id !== p.slice(1));
    h.putDoc(KIND, d);
    return h.json(res, 200, { ok: true });
  }
  if (req.method === "GET" && p === "/runs") return h.json(res, 200, h.doc("pipelines.runs", () => ({ runs: [] })).runs);
  if (req.method === "GET" && p === "/from-mission") {
    // turn a finished mission's tasks into a pipeline draft the user can save
    return h.json(res, 200, { hint: "POST the mission's tasks as steps to /api/pipelines/save" });
  }
  return false;
}
