// Onboarding tour (Phase 1): remembers whether the first-run walkthrough was finished or skipped
// (document "tour.state", per user) and starts the sample run the tour shows. The sample only ever
// runs on the three demo AIs: it refuses when demo mode is off or when any real text-AI key is
// saved, so a brand-new user can never spend a cent by clicking through the tour.
// What's new is a separate document ("whatsnew.state"). The first install does not show it.
// After an update the screen lists every bundled note newer than the version last marked seen,
// through this version, newest first. Nothing seen yet shows only this version. Dismiss remembers the
// previous version so Settings and Help can open the same list again. A tour reset does not show it again.
import fs from "node:fs";
import path from "node:path";
import { demoActive } from "../mock.js";
import { realAiConnected } from "../demo-visibility.js";
import { ROOT } from "../paths.js";
import { VERSION } from "../update.js";
import { applyDesktopPrompt, desktopPromptCopy, shouldShowDesktopPrompt } from "../desktop-prompt.js";
export const id = "tour";

const KIND = "tour.state";
const NEWS_KIND = "whatsnew.state";
const DESKTOP_KIND = "desktop.prompt";
export const NEWS_PATH = path.join(ROOT, "docs", "WHATS-NEW.json");
export const DEFAULTS = { completed: false, completedAt: null, skippedAt: null, offeredAt: null, sampleRuns: 0, lastSampleAt: null };
export const SAMPLE_GOAL = "Plan a one-week Instagram launch for a small coffee roaster: five post ideas with hooks, short captions and a posting schedule.";
export const SAMPLE_CONTEXT = "This is the onboarding sample run on the demo AIs. Keep every deliverable short and concrete.";

// Pure: may the sample run, and as which kind of run?
export function sampleDecision({ demo, realKeys, canMission }) {
  if (!demo) return { ok: false, code: "demo_off", error: "Turn demo mode on first: the sample only ever runs on the three pretend AIs." };
  if (realKeys) return { ok: false, code: "real_keys", error: "Real API keys are saved, so the sample is skipped: it could route to a paid AI. Send your own orders from Command instead." };
  return { ok: true, kind: canMission ? "mission" : "single" };
}

// Pure: the changelog entry for one version, or null when that version has no bullets.
export function whatsNewFor(version, changelog) {
  const entry = changelog && typeof changelog === "object" ? changelog[version] : null;
  if (!entry || !Array.isArray(entry.bullets) || entry.bullets.length === 0) return null;
  return { version, title: String(entry.title || `What's new in ${version}`), bullets: entry.bullets.map((b) => String(b)) };
}

// Numeric, so 0.4.10 sorts after 0.4.9. Returns -1, 0, or 1.
export function compareVersions(a, b) {
  const parts = (v) => String(v || "").replace(/^v/i, "").split(".").map((x) => parseInt(x, 10) || 0);
  const pa = parts(a), pb = parts(b);
  const n = Math.max(pa.length, pb.length, 1);
  for (let i = 0; i < n; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

// Pure: notes strictly after `from` and up to `to`, newest first.
// `from` null means a first launch: only `to`, so a new install does not list every past version.
// Versions with no bullets are skipped. The top-level version and bullets stay the newest entry.
export function whatsNewSince(from, to, changelog) {
  if (!to || !changelog || typeof changelog !== "object" || Array.isArray(changelog)) return null;
  const first = from == null || from === "";
  const keys = Object.keys(changelog).filter((v) => {
    if (compareVersions(v, to) > 0) return false;
    if (first) return String(v) === String(to);
    return compareVersions(v, from) > 0;
  });
  keys.sort((a, b) => compareVersions(b, a));
  const versions = keys.map((v) => whatsNewFor(v, changelog)).filter(Boolean);
  if (!versions.length) return null;
  const newest = versions[0];
  return { version: newest.version, title: newest.title, bullets: newest.bullets, from: from || null, versions };
}

export function readChangelog(text = fs.readFileSync(NEWS_PATH, "utf8")) {
  const data = JSON.parse(text);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("WHATS-NEW.json must be an object keyed by version");
  return data;
}

const realKeys = () => realAiConnected();
const state = (h) => ({ ...DEFAULTS, ...h.doc(KIND, () => ({ ...DEFAULTS })) });
const save = (h, patch) => h.putDoc(KIND, { ...state(h), ...patch });
function newsDoc(h) {
  const d = h.doc(NEWS_KIND, () => ({})) || {};
  return { ...d, seen: d.seen || null, from: d.from || null, installed: d.installed || null };
}
function newsSpan(from) {
  try { return whatsNewSince(from, VERSION, readChangelog()); }
  catch { return null; }
}
// First install does not show What's new. A later version lists every note since the one you had.
function pendingNews(h) {
  const existing = h.doc(NEWS_KIND, () => undefined);
  if (existing == null) {
    h.putDoc(NEWS_KIND, { seen: null, from: null, installed: VERSION, firstInstall: true });
    return null;
  }
  if (existing.seen === VERSION) return null;
  if (existing.firstInstall === true && existing.installed === VERSION) return null;
  return newsSpan(existing.seen || null);
}
// The list to show again after it was dismissed. Does not clear `seen`.
function savedNews(h) {
  const d = newsDoc(h);
  return newsSpan(d.seen === VERSION ? d.from : d.seen);
}
const desktopState = (h) => {
  const saved = h.doc(DESKTOP_KIND, () => ({ status: "pending", laterCount: 0 }));
  return { status: saved?.status || "pending", laterCount: Number(saved?.laterCount) || 0 };
};
function pendingDesktop(h) {
  if (!shouldShowDesktopPrompt({ version: VERSION, ...desktopState(h) })) return null;
  return desktopPromptCopy();
}
const view = (h) => ({ ...state(h), demo: demoActive(), realKeys: realKeys(h), canMission: !!h.licenseState().limits?.missions, sample: { goal: SAMPLE_GOAL }, whatsNew: pendingNews(h), desktopPrompt: pendingDesktop(h) });

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/tour/, "");
  if (req.method === "GET" && (p === "" || p === "/")) return h.json(res, 200, view(h));
  if (req.method === "GET" && p === "/whats-new") return h.json(res, 200, { whatsNew: savedNews(h) });
  if (req.method !== "POST") return false;
  if (p === "/complete") { save(h, { completed: true, completedAt: Date.now() }); return h.json(res, 200, view(h)); }
  if (p === "/skip") { save(h, { skippedAt: Date.now() }); return h.json(res, 200, view(h)); }
  // The quiet tour link was shown. It is offered once, so a later launch does not show it again.
  if (p === "/offered") { if (!state(h).offeredAt) save(h, { offeredAt: Date.now() }); return h.json(res, 200, view(h)); }
  if (p === "/reset") { h.putDoc(KIND, { ...DEFAULTS }); return h.json(res, 200, view(h)); }
  if (p === "/whats-new/seen") {
    const d = newsDoc(h);
    const from = d.seen === VERSION ? d.from : d.seen;
    h.putDoc(NEWS_KIND, { ...d, seen: VERSION, from, firstInstall: false });
    return h.json(res, 200, view(h));
  }
  if (p === "/desktop") {
    const action = body?.action === "never" || body?.action === "done" || body?.action === "later" ? body.action : "";
    if (!action) return h.json(res, 400, { error: "Choose Not now, Never, or continue." });
    h.putDoc(DESKTOP_KIND, applyDesktopPrompt(desktopState(h), action));
    return h.json(res, 200, view(h));
  }
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
