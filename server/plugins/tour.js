// Onboarding tour (Phase 1): remembers whether the first-run walkthrough was finished or skipped
// (document "tour.state", per user) and starts the sample run the tour shows. The sample only ever
// runs on the three demo AIs: it refuses when demo mode is off or when any real text-AI key is
// saved, so a brand-new user can never spend a cent by clicking through the tour.
import { demoActive } from "../mock.js";
export const id = "tour";

const KIND = "tour.state";
export const DEFAULTS = { completed: false, completedAt: null, skippedAt: null, sampleRuns: 0, lastSampleAt: null };
export const SAMPLE_GOAL = "Plan a one-week Instagram launch for a small coffee roaster: five post ideas with hooks, short captions and a posting schedule.";
export const SAMPLE_CONTEXT = "This is the onboarding sample run on the demo AIs. Keep every deliverable short and concrete.";

// Pure: may the sample run, and as which kind of run?
export function sampleDecision({ demo, realKeys, canMission }) {
  if (!demo) return { ok: false, code: "demo_off", error: "Turn demo mode on first: the sample only ever runs on the three pretend AIs." };
  if (realKeys) return { ok: false, code: "real_keys", error: "Real API keys are saved, so the sample is skipped: it could route to a paid AI. Send your own orders from Command instead." };
  return { ok: true, kind: canMission ? "mission" : "single" };
}

const realKeys = (h) => Object.values(h.PROVIDERS).some((p) => p.kind === "text" && !p.demo && h.hasSecret(p.id, p.keyEnv));
const state = (h) => ({ ...DEFAULTS, ...h.doc(KIND, () => ({ ...DEFAULTS })) });
const save = (h, patch) => h.putDoc(KIND, { ...state(h), ...patch });
const view = (h) => ({ ...state(h), demo: demoActive(), realKeys: realKeys(h), canMission: !!h.licenseState().limits?.missions, sample: { goal: SAMPLE_GOAL } });

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/tour/, "");
  if (req.method === "GET" && (p === "" || p === "/")) return h.json(res, 200, view(h));
  if (req.method !== "POST") return false;
  if (p === "/complete") { save(h, { completed: true, completedAt: Date.now() }); return h.json(res, 200, view(h)); }
  if (p === "/skip") { save(h, { skippedAt: Date.now() }); return h.json(res, 200, view(h)); }
  if (p === "/reset") { h.putDoc(KIND, { ...DEFAULTS }); return h.json(res, 200, view(h)); }
  if (p === "/sample") {
    const d = sampleDecision({ demo: demoActive(), realKeys: realKeys(h), canMission: !!h.licenseState().limits?.missions });
    if (!d.ok) return h.json(res, 400, { error: d.error, code: d.code });
    save(h, { sampleRuns: state(h).sampleRuns + 1, lastSampleAt: Date.now() });
    if (d.kind === "single") return h.json(res, 200, { ok: true, kind: "single", prompt: SAMPLE_GOAL, note: "Missions are a Pro feature; the sample runs as a Single answer on this copy." });
    let promise;
    try { promise = h.runMission({ goal: SAMPLE_GOAL, mode: "economy", qa: true, budgetUsd: 1, context: SAMPLE_CONTEXT }); }
    catch (e) { return h.json(res, e.status || 402, { error: e.message, code: e.code }); }
    promise.catch((e) => h.emit("log", { text: `Sample mission failed: ${e.message}`, level: "error" }));
    h.emit("log", { text: "Tour: the sample mission is running on the demo AIs. Nothing is spent." });
    return h.json(res, 202, { ok: true, kind: "mission", goal: SAMPLE_GOAL });
  }
  return false;
}
