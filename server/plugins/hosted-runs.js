// Extreme: hand a desktop schedule or mission to the hosted worker so it keeps
// going while this PC is off. The handoff runs only after the person opts in
// and only after server/feature-gate.js allows Extreme (or owner).
// Keys are sealed on this computer. The worker is the only place that opens them.
import * as S from "../schedules.js";
import { gateHostedRuns, hostedRunsAllowed } from "../feature-gate.js";
import { sealSecrets } from "../hosted-vault.js";
import { DESKTOP_ONLY } from "../../web/desktop-only.js";

export const id = "hosted-runs";
const DOC = "hosted-runs";
export const CLOUD_LABEL = "Running in the cloud";

const docOf = (h) => h.doc(DOC, () => ({ optIn: false, optInAt: null, jobs: [] }));
const save = (h, patch) => h.putDoc(DOC, { ...docOf(h), ...patch });

function workerBase() {
  return String(process.env.CC_WORKER_URL || "").replace(/\/$/, "");
}

function view(h) {
  const tier = h.licenseState().tier;
  const saved = docOf(h);
  const jobs = Array.isArray(saved.jobs) ? saved.jobs : [];
  const runningInCloud = jobs.some((j) => j.status === "queued" || j.status === "running");
  return {
    allowed: hostedRunsAllowed(tier),
    tier,
    optIn: !!saved.optIn,
    runningInCloud,
    hub: { ready: !!workerBase(), note: workerBase() ? "" : "Needs the Meldmind hub (coming soon)" },
    label: runningInCloud ? CLOUD_LABEL : null,
    jobs,
    desktopOnly: h.HOSTED ? DESKTOP_ONLY : [],
    surface: h.HOSTED ? "web" : "desktop",
    configured: !!workerBase(),
  };
}

function collectSecrets(h) {
  const out = {};
  for (const provider of Object.keys(h.PROVIDERS || {})) {
    const secret = h.getSecret(provider);
    if (!secret?.key || secret.managed) continue;
    out[provider] = { key: secret.key };
  }
  return out;
}

async function workerFetch(path, { method = "GET", body } = {}) {
  const base = workerBase();
  if (!base) throw Object.assign(new Error("A hosted worker is not configured on this computer yet."), { status: 400, code: "no_worker" });
  const headers = { "content-type": "application/json" };
  if (process.env.CC_WORKER_TOKEN) headers["x-cc-worker-token"] = process.env.CC_WORKER_TOKEN;
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw Object.assign(new Error("The hosted worker could not be reached."), { status: 502, code: "worker_down" });
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(json.error || "The hosted worker refused the request."), { status: response.status, code: json.code });
  return json;
}

async function payloadFor(h, body) {
  const kind = body?.kind === "mission" ? "mission" : body?.kind === "schedule" ? "schedule" : "";
  if (!kind) throw Object.assign(new Error("Choose a schedule or a mission."), { status: 400 });
  const refId = String(body.id || "").trim();
  if (!refId) throw Object.assign(new Error("Choose a schedule or a mission."), { status: 400 });
  if (kind === "schedule") {
    const schedule = S.getSchedule(refId);
    if (!schedule) throw Object.assign(new Error("No such schedule."), { status: 404 });
    if (schedule.trigger?.type === "folder") throw Object.assign(new Error("A watched folder stays on this computer."), { status: 400, code: "desktop" });
    return { kind, refId, title: schedule.name, prompt: schedule.target?.text || schedule.name, budgetUsd: Number(body.budgetUsd) || schedule.capUsd };
  }
  const mission = await h.ctx().store.getMission(refId);
  if (!mission) throw Object.assign(new Error("No such mission."), { status: 404 });
  return { kind, refId, title: mission.title || String(mission.prompt || "").slice(0, 90), prompt: mission.prompt || mission.goal || "", budgetUsd: Number(body.budgetUsd) || mission.budgetUsd };
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/hosted-runs/, "").replace(/\/$/, "") || "/";
  const m = req.method;
  try {
    if (m === "GET" && p === "/") return h.json(res, 200, view(h));
    if (m === "POST" && p === "/opt-in") {
      const gate = gateHostedRuns();
      if (body?.optIn !== true) return h.json(res, 400, { error: "Turn on cloud runs with a click. Nothing is turned on for you.", code: "opt_in" });
      save(h, { optIn: true, optInAt: Date.now() });
      return h.json(res, 200, { ...view(h), tier: gate.tier });
    }
    if (m === "POST" && p === "/handoff") {
      gateHostedRuns();
      const saved = docOf(h);
      if (!saved.optIn || body?.optIn !== true) {
        return h.json(res, 403, { error: "Hand off only happens after you opt in. Turn on cloud runs first, then confirm this one.", code: "opt_in" });
      }
      const item = await payloadFor(h, body);
      const pub = await workerFetch("/api/worker/public-key");
      const secrets = collectSecrets(h);
      const envelopes = sealSecrets({ publicKey: pub.publicKey, userId: h.ctx().userId, secrets });
      const posted = await workerFetch("/api/worker/jobs", {
        method: "POST",
        body: {
          userId: h.ctx().userId,
          kind: item.kind,
          refId: item.refId,
          title: item.title,
          prompt: item.prompt,
          budgetUsd: item.budgetUsd,
          estimateUsd: Number(body.estimateUsd) || 0,
          optIn: true,
          envelopes,
        },
      });
      const job = {
        id: posted.job.id,
        kind: item.kind,
        refId: item.refId,
        title: item.title,
        status: posted.job.status,
        budgetUsd: posted.job.budgetUsd,
        text: posted.job.text || "",
        cost: posted.job.cost || 0,
      };
      const jobs = [job, ...(saved.jobs || []).filter((j) => j.id !== job.id)].slice(0, 50);
      save(h, { jobs });
      const state = view(h);
      const runningInCloud = !!state.runningInCloud;
      return h.json(res, 202, { ...state, job, runningInCloud, label: runningInCloud ? CLOUD_LABEL : null });
    }
    if (m === "POST" && p === "/sync") {
      gateHostedRuns();
      const saved = docOf(h);
      const pulled = await workerFetch("/api/worker/sync", { method: "POST", body: { userId: h.ctx().userId } });
      const byId = new Map((saved.jobs || []).map((j) => [j.id, j]));
      for (const job of pulled.jobs || []) {
        byId.set(job.id, { id: job.id, kind: job.kind, refId: job.refId, title: job.title, status: job.status, budgetUsd: job.budgetUsd, text: job.text || "", cost: job.cost || 0 });
      }
      const jobs = [...byId.values()].slice(0, 50);
      save(h, { jobs });
      const runningInCloud = !!pulled.running || jobs.some((j) => j.status === "queued" || j.status === "running");
      return h.json(res, 200, { ...view(h), jobs, broughtBack: pulled.jobs || [], runningInCloud, label: runningInCloud ? CLOUD_LABEL : null });
    }
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code });
  }
  return false;
}
