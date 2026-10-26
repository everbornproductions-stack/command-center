// Build it all for me: routes under /api/buildall.
//   GET  /api/buildall/prefs           the remembered switches (off by default)
//   POST /api/buildall/prefs           { on, allowPost }
//   POST /api/buildall/start           { surface: start | builder | webbuilder | remix, ... }
//   GET  /api/buildall                 this person's recent runs
//   GET  /api/buildall/:id             one run with its steps
//   POST /api/buildall/:id/stop        Stop
//   POST /api/buildall/:id/pause       Pause (when flag_flowstages is on or requested)
//   POST /api/buildall/:id/resume      Resume a paused run
//   POST /api/buildall/:id/save        Save job state
// Each surface drives its own existing routes in this process, in order, so every
// rule those routes already have (gates, compliance, previews) still applies.
// Nothing here posts unless Also allow posting is on, and nothing spends money or
// deletes for good.
import {
  loadPrefs, savePrefs, createJob, getJob, listJobs, stopJob, pauseJob, resumeJob, saveJob,
  publicJob, runSteps, waitFor, fillAnswers, answerFromDescription, STEP_LABELS, SURFACES, STOP_REASON,
} from "../build-all.js";
import { isFlowStagesEnabled } from "../walkthroughs.js";
import { needsRemote, requiredChecks } from "../builders/drafts.js";

export const id = "buildall";

function owner(h) {
  try { return h.ctx?.()?.userId || null; } catch { return null; }
}

function fakeRes() {
  const res = {
    statusCode: 200,
    headersSent: false,
    body: "",
    setHeader() {},
    getHeader() { return undefined; },
    writeHead(status) { res.statusCode = status; res.headersSent = true; return res; },
    write(chunk) { res.body += String(chunk || ""); return true; },
    end(chunk) { if (chunk) res.body += String(chunk); res.finished = true; },
    on() { return res; },
    once() { return res; },
  };
  return res;
}

// Call another plugin's route in this process. Returns { status, json }.
export async function callRoute(method, path, body) {
  const { handlePlugin } = await import("./index.js");
  const res = fakeRes();
  const url = new URL(`http://127.0.0.1${path}`);
  const handled = await handlePlugin({ method, headers: {}, url: path, on() {}, socket: {} }, res, url, body || {});
  if (!handled) return { status: 404, json: { error: "That step is not in this app." } };
  let json = null;
  try { json = res.body ? JSON.parse(res.body) : null; } catch { json = null; }
  return { status: res.statusCode, json };
}

function check(r, what) {
  if (r.status >= 200 && r.status < 300) return r.json;
  const e = new Error(r.json?.error || `${what} did not finish.`);
  e.status = r.status;
  e.code = r.json?.code;
  throw e;
}

const needs = (reason) => ({ stop: { kind: "needs", reason } });
const steps = (ids) => ids.map((sid) => ({ id: sid, label: STEP_LABELS[sid] }));

// ---- Start a project ----
function startPlan(body) {
  const exp = body?.experience === "expert" ? "expert" : "simple";
  const q = `?experience=${exp}`;
  const idea = String(body?.idea || body?.description || "").trim();
  let walkId = String(body?.walkId || "");
  let walk = null;
  const read = async () => check(await callRoute("GET", `/api/walkthrough/${encodeURIComponent(walkId)}${q}`), "Reading the project");
  return {
    title: "Start a project",
    steps: [
      { id: "idea", label: STEP_LABELS.idea, run: async () => {
        if (idea.length < 8) throw new Error("Describe the idea in a sentence or two.");
        if (!walkId) {
          walk = check(await callRoute("POST", `/api/walkthrough${q}`, { type: body?.type, experience: exp }), "Starting the project");
          walkId = walk.id;
        }
        walk = check(await callRoute("POST", `/api/walkthrough/${encodeURIComponent(walkId)}/idea${q}`, { idea, experience: exp }), "Saving the idea");
        return { walkId, note: "Idea saved." };
      } },
      { id: "questions", label: STEP_LABELS.questions, run: async ({ job }) => {
        const types = check(await callRoute("GET", "/api/walkthrough/types"), "Reading the questions");
        const type = (types || []).find((t) => t.id === walk?.type) || null;
        const filled = fillAnswers(type?.questions || [], idea, body?.answers || {});
        job.assumed = filled.assumed;
        walk = check(await callRoute("POST", `/api/walkthrough/${encodeURIComponent(walkId)}/answers${q}`, { answers: filled.answers, experience: exp }), "Saving the answers");
        const n = filled.assumed.length;
        return { note: n ? `Answered from your description. ${n} answer${n === 1 ? " was" : "s were"} assumed.` : "Answered from your description." };
      } },
      { id: "plan", label: STEP_LABELS.plan, run: async ({ stopped }) => {
        check(await callRoute("POST", `/api/walkthrough/${encodeURIComponent(walkId)}/plan${q}`, { experience: exp }), "Planning");
        walk = await waitFor(read, (w) => w && w.status !== "planning", { stopped });
        if (walk?.status === "failed") throw new Error(walk.error || "The plan did not finish.");
        return { note: `${walk?.plan?.steps?.length || 0} steps planned.` };
      } },
      { id: "build", label: STEP_LABELS.build, run: async ({ stopped }) => {
        check(await callRoute("POST", `/api/walkthrough/${encodeURIComponent(walkId)}/build${q}`, { experience: exp }), "Building");
        walk = await waitFor(read, (w) => w && w.status !== "building", { stopped });
        if (walk?.status === "failed") throw new Error(walk.error || "The build did not finish.");
        return { note: "Built." };
      } },
      { id: "test", label: STEP_LABELS.test, run: async () => {
        walk = await read();
        const text = String(walk?.deliverable || "");
        if (!text.trim()) throw new Error("The build came back empty.");
        const gaps = (text.match(/\[ASK\]/g) || []).length;
        return {
          walkId, projectId: walk?.projectId || null, deliverable: text.slice(0, 4000),
          note: gaps ? `Checked. ${gaps} gap${gaps === 1 ? "" : "s"} marked [ASK] for you to fill.` : "Checked. Ready to review.",
        };
      } },
    ],
  };
}

// ---- Guided builders (HighLevel, accounting, business tools) ----
function builderPlan(body) {
  const builderId = String(body?.builderId || "");
  const description = String(body?.description || body?.input?.text || "").trim();
  let input = { ...(body?.input || {}) };
  let jobId = "";
  let draft = null;
  const base = `/api/builders/${encodeURIComponent(builderId)}`;
  return {
    title: "Guided builder",
    steps: [
      { id: "idea", label: STEP_LABELS.idea, run: async () => {
        if (!/^[a-z0-9-]+$/.test(builderId)) throw new Error("Pick a builder.");
        if (description.length < 4 && !input.text) throw new Error("Describe what you want in a sentence.");
        return { note: "Idea saved." };
      } },
      { id: "questions", label: STEP_LABELS.questions, run: async ({ job }) => {
        const info = check(await callRoute("GET", `/api/builders?text=${encodeURIComponent(description)}`), "Reading the questions");
        const fields = info?.forms?.[builderId]?.fields || [{ id: "text", label: "Describe it" }];
        const assumed = [];
        for (const f of fields) {
          if (String(input[f.id] ?? "").trim()) continue;
          if (f.id === "text") { input.text = description; continue; }
          if (/email/i.test(f.id)) { const m = description.match(/[^\s@]+@[^\s@]+\.[a-z]{2,}/i); if (m) { input[f.id] = m[0]; continue; } }
          const found = answerFromDescription({ key: f.id, label: f.label }, description);
          if (found && f.type !== "number") { input[f.id] = found; continue; }
          assumed.push({ key: f.id, label: f.label || f.id, value: "Left blank (optional)", required: false });
        }
        job.assumed = assumed;
        return { note: assumed.length ? `Filled from your description. ${assumed.length} left blank.` : "Filled from your description." };
      } },
      { id: "plan", label: STEP_LABELS.plan, run: async () => {
        const r = await callRoute("POST", `${base}/preview`, input);
        if (r.status === 400 && r.json?.code === "legal") return needs(r.json.error);
        const out = check(r, "The preview");
        jobId = out.job.id;
        draft = out.draft;
        return { note: "Previewed. Nothing was sent." };
      } },
      { id: "build", label: STEP_LABELS.build, run: async () => {
        const r = await callRoute("POST", `${base}/build`, { ...input, jobId });
        if (r.status === 402 || r.status === 403) return needs(r.json?.error || "This builder needs a different plan.");
        const out = check(r, "The build");
        draft = out.draft;
        return { note: "Built on this computer." };
      } },
      { id: "test", label: STEP_LABELS.test, run: async () => {
        const out = check(await callRoute("POST", `${base}/test`, { ...input, jobId }), "The test");
        draft = out.draft;
        return { note: "Tested. Nothing was sent." };
      } },
      { id: "publish", label: STEP_LABELS.publish, risk: "none", run: async ({ job }) => {
        const remote = needsRemote(builderId, draft);
        if (remote && !job.allowPost) return { stop: { kind: "post", reason: STOP_REASON.post } };
        if (requiredChecks(builderId, input).length) return needs("This send has boxes only you can tick. Open the builder and tick them, then click Publish.");
        const r = await callRoute("POST", `${base}/publish`, { ...input, jobId, confirm: true, checks: {} });
        if (r.status >= 400) return needs(r.json?.error || "Publish needs you.");
        return { jobId, posted: !!r.json?.posted, note: r.json?.reason || (r.json?.posted ? "Posted." : "Saved on this computer. Nothing was sent.") };
      } },
    ],
  };
}

// ---- Web and marketing builders ----
function webPlan(body) {
  const builderId = String(body?.builderId || "");
  const description = String(body?.description || body?.input?.about || "").trim();
  let input = { ...(body?.input || {}) };
  let draft = null;
  const base = `/api/webbuilders/${encodeURIComponent(builderId)}`;
  return {
    title: "Web and marketing builder",
    steps: [
      { id: "idea", label: STEP_LABELS.idea, run: async () => {
        if (!/^[a-z0-9-]+$/.test(builderId)) throw new Error("Pick a builder.");
        if (description.length < 4) throw new Error("Describe what you want in a sentence.");
        return { note: "Idea saved." };
      } },
      { id: "questions", label: STEP_LABELS.questions, run: async ({ job }) => {
        const info = check(await callRoute("GET", base), "Reading the questions");
        const fields = [...(info?.fields?.main || []), ...(info?.fields?.more || [])].filter((f) => !f.connect && f.type !== "password");
        const defaults = info?.defaults || {};
        const assumed = [];
        for (const f of fields) {
          if (input[f.id] !== undefined && String(input[f.id]).trim() !== "") continue;
          if (f.id === "about") { input.about = description; continue; }
          if (f.id === "topic") { input.topic = description.slice(0, 200); continue; }
          if (f.id === "html" || f.id === "copy" || f.id === "serviceUrl" || f.type === "checkbox") continue;
          const found = f.type === "text" ? answerFromDescription({ key: f.id, label: f.label }, description) : "";
          if (found) { input[f.id] = found; continue; }
          if (defaults[f.id] !== undefined) {
            input[f.id] = defaults[f.id];
            assumed.push({ key: f.id, label: f.label || f.id, value: String(defaults[f.id]), required: !f.advanced });
          }
        }
        job.assumed = assumed;
        return { note: assumed.length ? `Filled from your description. ${assumed.length} used a default.` : "Filled from your description." };
      } },
      { id: "plan", label: STEP_LABELS.plan, run: async () => {
        const r = await callRoute("POST", `${base}/preview`, input);
        if (r.status >= 400) return needs(r.json?.error || "The preview needs you.");
        return { note: "Previewed. Nothing was sent." };
      } },
      { id: "build", label: STEP_LABELS.build, run: async () => {
        const r = await callRoute("POST", `${base}/build`, { ...input, confirm: true });
        if (r.status >= 400) return needs(r.json?.error || "The build needs you.");
        draft = r.json.draft;
        return { draftId: draft?.id, note: "Built on this computer." };
      } },
      { id: "test", label: STEP_LABELS.test, run: async () => {
        const out = check(await callRoute("POST", `${base}/test`, { draftId: draft?.id }), "The test");
        draft = out.draft || draft;
        const n = Array.isArray(out.issues) ? out.issues.length : 0;
        return { note: n ? `Tested. ${n} thing${n === 1 ? "" : "s"} to look at.` : "Tested." };
      } },
      { id: "publish", label: STEP_LABELS.publish, risk: "none", run: async ({ job }) => {
        const target = String(draft?.publishDefault || input.target || "local");
        if (target !== "local" && !job.allowPost) return { stop: { kind: "post", reason: STOP_REASON.post } };
        const r = await callRoute("POST", `${base}/publish`, { draftId: draft?.id, target, confirmed: true });
        if (r.status >= 400) return needs(r.json?.error || "Publish needs you.");
        return { draftId: draft?.id, projectId: draft?.projectId || null, sent: !!r.json?.sent, note: r.json?.note || "Saved on this computer. Nothing was sent." };
      } },
    ],
  };
}

// ---- Remix ----
function remixPlan(body) {
  const description = String(body?.description || "").trim();
  const payload = { ...(body?.remix || {}) };
  payload.own = { ...(payload.own || {}) };
  return {
    title: "Remix",
    steps: [
      { id: "idea", label: STEP_LABELS.idea, run: async () => {
        if (!description && !payload.own.ideas && !payload.appType) throw new Error("Describe what you want to make.");
        return { note: "Idea saved." };
      } },
      { id: "questions", label: STEP_LABELS.questions, run: async ({ job }) => {
        const assumed = [];
        if (!String(payload.own.ideas || "").trim() && description) payload.own.ideas = description.slice(0, 600);
        if (!String(payload.own.name || "").trim()) assumed.push({ key: "name", label: "Name", value: "My remix", required: false });
        if (!payload.appType) { payload.appType = "app"; assumed.push({ key: "appType", label: "What to make", value: "app", required: true }); }
        if (!payload.start) { payload.start = "description"; assumed.push({ key: "start", label: "Starting point", value: "Your description", required: true }); }
        if (!payload.looks && !payload.plays && !payload.works && description) payload.looks = description.slice(0, 600);
        job.assumed = assumed;
        return { note: assumed.length ? `Filled from your description. ${assumed.length} assumed.` : "Filled from your description." };
      } },
      { id: "plan", label: STEP_LABELS.plan, run: async () => {
        check(await callRoute("POST", "/api/remix/preview", payload), "The preview");
        return { note: "Previewed. Nothing was sent." };
      } },
      { id: "build", label: STEP_LABELS.build, run: async () => {
        const r = await callRoute("POST", "/api/remix/run", { ...payload, confirm: true });
        if (r.status === 409 && r.json?.code === "too_close") return needs(r.json.error);
        if (r.status >= 400) return needs(r.json?.error || "The build needs you.");
        payload.projectId = r.json.projectId;
        return { projectId: r.json.projectId, note: r.json?.ai?.reason || "Saved." };
      } },
      { id: "test", label: STEP_LABELS.test, run: async () => {
        const r = await callRoute("POST", "/api/remix/test", { projectId: payload.projectId, confirm: true });
        if (r.status === 402) return { skipped: true, projectId: payload.projectId, note: "The page test is on Pro. Skipped." };
        check(r, "The test");
        return { projectId: payload.projectId, note: "Tested on this computer. Nothing was launched." };
      } },
    ],
  };
}

const PLANS = { start: startPlan, builder: builderPlan, webbuilder: webPlan, remix: remixPlan };

export function planFor(surface, body) {
  const make = PLANS[surface];
  return make ? make(body || {}) : null;
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/buildall\/?/, "");
  const seg = p.split("/").filter(Boolean);
  const m = req.method;
  const who = owner(h);
  let settings = {};
  try { settings = h.settings?.() || {}; } catch { settings = {}; }
  const flowOn = isFlowStagesEnabled({ settings, requested: url.searchParams.get("flag_flowstages") ?? body?.flag_flowstages });

  if (m === "GET" && seg[0] === "prefs" && seg.length === 1) return h.json(res, 200, loadPrefs(h.doc));
  if (m === "POST" && seg[0] === "prefs" && seg.length === 1) return h.json(res, 200, savePrefs(h.doc, h.putDoc, { on: body?.on, allowPost: body?.allowPost }));

  if (m === "GET" && !seg.length) return h.json(res, 200, { runs: listJobs(who).slice(0, 20), prefs: loadPrefs(h.doc) });

  if (m === "POST" && seg[0] === "start" && seg.length === 1) {
    const surface = String(body?.surface || "");
    if (!SURFACES.includes(surface)) return h.json(res, 400, { error: "Pick where to build.", code: "surface" });
    const prefs = loadPrefs(h.doc);
    const allowPost = body?.allowPost === undefined ? prefs.allowPost : body.allowPost === true;
    const plan = planFor(surface, body);
    const job = createJob({
      surface,
      title: plan.title,
      steps: steps(plan.steps.map((s) => s.id)),
      allowPost,
      owner: who,
      flowStages: flowOn,
      experience: body?.experience === "expert" ? "expert" : "simple",
    });
    const tell = (view) => { try { h.emit("buildall.update", { job: view }); } catch { /* bus optional */ } };
    try { h.emit("log", { text: `Build it all for me started: ${plan.title}. It stops only to spend money, delete for good, or post in public.` }); } catch { /* bus optional */ }
    runSteps(job, plan.steps, { onProgress: tell }).then((view) => {
      const line = view.status === "done" ? "finished" : view.status === "waiting" ? "is waiting for you" : view.status;
      try { h.emit("log", { text: `Build it all for me ${line}: ${plan.title}.` }); } catch { /* bus optional */ }
    }).catch(() => {});
    return h.json(res, 202, publicJob(job));
  }

  const job = seg[0] ? getJob(decodeURIComponent(seg[0])) : null;
  if (seg[0] && (!job || (who !== null && job.owner !== who))) return h.json(res, 404, { error: "That run was not found.", code: "missing" });
  if (m === "GET" && seg.length === 1) return h.json(res, 200, publicJob(job));
  if (m === "POST" && seg.length === 2 && seg[1] === "stop") {
    stopJob(job.id);
    try { h.emit("buildall.update", { job: publicJob(job) }); } catch { /* bus optional */ }
    return h.json(res, 200, publicJob(job));
  }
  if (m === "POST" && seg.length === 2 && seg[1] === "pause") {
    pauseJob(job.id);
    try { h.emit("buildall.update", { job: publicJob(job) }); } catch { /* bus optional */ }
    return h.json(res, 200, publicJob(job));
  }
  if (m === "POST" && seg.length === 2 && seg[1] === "resume") {
    const tell = (view) => { try { h.emit("buildall.update", { job: view }); } catch { /* bus optional */ } };
    resumeJob(job.id, { onProgress: tell }).catch(() => {});
    return h.json(res, 200, publicJob(job));
  }
  if (m === "POST" && seg.length === 2 && seg[1] === "save") {
    const saved = saveJob(h.doc, h.putDoc, job);
    try { h.emit("buildall.update", { job: saved }); } catch { /* bus optional */ }
    return h.json(res, 200, saved);
  }
  return false;
}
