// Backup step 2 (0.4.21 item 10): ask the AI's own website, in Meldmind's browser window, signed in by the person.
// The order in server/sub-routes.js CHAIN is: official apps, then this, then copy it over. It runs only when the person
// turned website mode on (with the terms warning and a confirm). It reuses the Browser helper, so the same rules hold:
// its own window and session, a visible action log and Stop, it never types a password (the person signs in there),
// and sending the question waits for the person's OK. Nothing is read from the person's normal browser.
// The browser helper is injected, so tests never open a page.
// The chat websites website mode may use, by provider. Public https pages only.
export const SITES = {
  anthropic: { name: "Claude", url: "https://claude.ai/new" },
  openai: { name: "ChatGPT", url: "https://chatgpt.com/" },
  xai: { name: "Grok", url: "https://grok.com/" },
};

export const WEB_TIMEOUT_MS = 6 * 60 * 1000;
const fail = (code, message) => ({ ok: false, code, message });

export function siteFor(provider) { return SITES[provider] || null; }

// The job the browser helper gets: where to go, what to type, and what to hand back.
export function taskFor(site, question) {
  return [
    `Open ${site.url} in this window. The person signs in there themselves; never type a password. If a sign-in page shows, finish and say "sign in needed".`,
    `Then type the QUESTION below into the ${site.name} chat box and send it. Do not change the question.`,
    `Wait until ${site.name} has finished its whole reply (the stop button is gone), then finish with exactly the text of that one reply and nothing else.`,
    "Do not click anything else, do not open other chats, and do not change settings.",
    "",
    "QUESTION",
    question,
  ].join("\n");
}

// deps: { readiness(), driverInfo(), dispatch(task), awaitJob(id, {timeoutMs}), stopJob(id, why), timeoutMs }
export async function askWebsite(job, question, deps = {}) {
  const site = siteFor(job.provider);
  if (!site) return fail("no-site", `${job.aiName || "That AI"} has no website Meldmind can use.`);
  const r = deps.readiness?.();
  if (!r?.ready) return fail("not-ready", `The browser helper is not ready: ${r?.detail || "not available"}.`);
  if (deps.driverInfo?.().kind !== "window") return fail("no-window", "Website mode needs the desktop app, so it can use its own browser window.");
  let started;
  try { started = await deps.dispatch(taskFor(site, question), { runId: job.runId }); }
  catch (e) { return fail("start", `Could not start the browser window: ${e.message}`); }
  const done = await deps.awaitJob(started.id, { timeoutMs: deps.timeoutMs ?? WEB_TIMEOUT_MS });
  if (!done) {
    try { await deps.stopJob?.(started.id, "Meldmind stopped waiting for the website"); } catch { /* already finished */ }
    return fail("timeout", `${site.name} did not answer in time, or it was waiting for your OK.`);
  }
  const text = String(done.text || done.result || "").trim();
  if (done.status !== "done") return fail("failed", `${site.name} did not finish${done.error ? `: ${done.error}` : "."}`);
  if (/\bsign in needed\b/i.test(text) && text.length < 120) return fail("signin", `Sign in to ${site.name} in the Meldmind window, then try again.`);
  if (!text) return fail("empty", `${site.name} came back with nothing.`);
  return { ok: true, text, site: site.name };
}

// The real browser helper, wired lazily so a plain import of this file costs nothing.
export async function liveDeps() {
  const B = await import("./browser.js");
  return {
    readiness: B.readiness, driverInfo: B.driverInfo,
    dispatch: (task, source) => B.dispatch({ task, source: { kind: "click", ...source }, needs: ["signed-in-browsing"] }),
    awaitJob: B.awaitJob, stopJob: B.stopJob,
  };
}
