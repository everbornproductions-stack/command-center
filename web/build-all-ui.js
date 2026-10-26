// Build it all for me: the switch, the progress list, and Stop.
// Shared by Start a project, the guided builders, the web builders, and Remix.
// The switch is off by default and is remembered per person on the server
// (/api/buildall/prefs). Existing buttons stay where they are.

export const BUILD_ALL_LINE = "Runs idea, questions, plan, build and test without stopping. It still stops to spend money, to delete something for good, and to post or send in public.";
export const ALLOW_POST_LINE = "Also allow posting: lets this run post or send in public. Off unless you turn it on.";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const STATUS_WORD = {
  queued: "Next",
  running: "Working",
  done: "Done",
  skipped: "Skipped",
  waiting: "Waiting for you",
  paused: "Paused",
  failed: "Did not finish",
  stopped: "Stopped",
};

const cc = () => (typeof window !== "undefined" ? window.CC : null);

function flowStagesOn(job, opts = {}) {
  if (opts.flowStages === true) return true;
  if (opts.flowStages === false) return false;
  if (job?.paused || job?.status === "paused" || job?.savedAt || job?.flowStages) return true;
  const s = cc()?.S?.settings || {};
  return !!(s.flag_flowstages || s.flags?.flag_flowstages);
}

export function switchHtml(prefs = {}, idp = "ba") {
  const on = prefs.on === true;
  const post = prefs.allowPost === true;
  return `<div class="ba-box" data-ba-box>
    <label class="row small" style="gap:8px;align-items:flex-start"><input type="checkbox" id="${idp}-on" data-ba-on ${on ? "checked" : ""} style="margin-top:3px"><span><b>Build it all for me</b><div class="dim small">${esc(BUILD_ALL_LINE)}</div></span></label>
    <label class="row small" style="gap:8px;align-items:flex-start;margin-top:6px" ${on ? "" : "hidden"} data-ba-post-row><input type="checkbox" id="${idp}-post" data-ba-post ${post ? "checked" : ""} style="margin-top:3px"><span>${esc(ALLOW_POST_LINE)}</span></label>
    <div class="row" style="margin-top:8px" ${on ? "" : "hidden"} data-ba-go-row><button class="btn sm primary" type="button" data-ba-go>Build it all</button></div>
    <div data-ba-progress></div>
  </div>`;
}

export function progressHtml(job, opts = {}) {
  if (!job) return "";
  const running = job.status === "running";
  const paused = job.status === "paused";
  const flowOn = flowStagesOn(job, opts);
  const head = running ? "Building it all" : job.status === "done" ? "Built" : job.status === "waiting" ? "Waiting for you" : paused ? "Paused" : job.status === "stopped" ? "Stopped" : "Did not finish";
  const rows = (job.steps || []).map((s) => `<li data-ba-step="${esc(s.id)}" data-status="${esc(s.status)}"><b>${esc(s.label)}</b> <span class="dim small">${esc(STATUS_WORD[s.status] || s.status)}${s.note ? `. ${esc(s.note)}` : ""}</span></li>`).join("");
  const assumed = (job.assumed || []).length
    ? `<div class="small" style="margin-top:6px"><b>Assumed</b> (change these any time):<ul>${job.assumed.map((a) => `<li>${esc(a.label)}: ${esc(a.value)}</li>`).join("")}</ul></div>`
    : "";
  const wait = job.waiting ? `<div class="small" role="status" style="margin-top:6px">${esc(job.waiting.reason)}</div>` : "";
  const err = job.error ? `<div class="small" role="alert" style="margin-top:6px">${esc(job.error)}</div>` : "";
  let controls = "";
  if (flowOn) {
    const btns = [];
    if (running) btns.push(`<button class="btn sm" type="button" data-ba-pause>Pause</button>`);
    if (paused) btns.push(`<button class="btn sm primary" type="button" data-ba-resume>Resume</button>`);
    if (running || paused || job.status === "waiting") btns.push(`<button class="btn sm" type="button" data-ba-save>Save</button>`);
    if (running || paused) btns.push(`<button class="btn sm" type="button" data-ba-stop>Stop</button>`);
    controls = btns.length ? `<div class="row" style="gap:6px;margin-left:auto">${btns.join("")}</div>` : "";
  } else {
    controls = running ? `<button class="btn sm" type="button" data-ba-stop style="margin-left:auto">Stop</button>` : "";
  }
  return `<div class="panel" data-ba-job="${esc(job.id)}" style="margin-top:8px">
    <div class="row" style="gap:8px"><b>${esc(head)}</b>${controls}</div>
    <ol class="small" style="margin:6px 0 0 18px;padding:0">${rows}</ol>${assumed}${wait}${err}
  </div>`;
}

let prefsCache = null;
export async function loadPrefs() {
  if (prefsCache) return prefsCache;
  try { prefsCache = await cc().api("/buildall/prefs"); }
  catch { prefsCache = { on: false, allowPost: false }; }
  return prefsCache;
}
async function savePrefs(patch) {
  try { prefsCache = await cc().api("/buildall/prefs", { method: "POST", body: patch }); }
  catch (e) { cc()?.toast?.(e.message, true); }
  return prefsCache;
}

// mount(el, { surface, payload(), onEnd(job) }). payload() returns the body for
// POST /api/buildall/start (without surface). It can throw to block the start.
export async function mountBuildAll(el, { surface, payload, onEnd } = {}) {
  if (!el) return;
  const prefs = await loadPrefs();
  if (!el.isConnected) return;
  el.innerHTML = switchHtml(prefs, `ba-${surface}`);
  const on = el.querySelector("[data-ba-on]");
  const post = el.querySelector("[data-ba-post]");
  const show = (v) => {
    el.querySelector("[data-ba-post-row]").hidden = !v;
    el.querySelector("[data-ba-go-row]").hidden = !v;
  };
  on.addEventListener("change", async () => { show(on.checked); await savePrefs({ on: on.checked }); });
  post.addEventListener("change", async () => { await savePrefs({ allowPost: post.checked }); });
  el.querySelector("[data-ba-go]").addEventListener("click", async () => {
    let body;
    try { body = payload ? payload() : {}; }
    catch (e) { cc()?.toast?.(e.message, true); return; }
    const box = el.querySelector("[data-ba-progress]");
    try {
      const job = await cc().api("/buildall/start", { method: "POST", body: { ...body, surface, allowPost: post.checked } });
      follow(box, job, onEnd);
    } catch (e) { cc()?.toast?.(e.message, true); }
  });
}

function follow(box, job, onEnd) {
  const tick = async () => {
    let j;
    try { j = await cc().api(`/buildall/${encodeURIComponent(job.id)}`); }
    catch { return; }
    if (!paint(j)) return;
    if (j.status === "running") { setTimeout(tick, 900); return; }
    if (j.status === "paused") return;
    try { onEnd?.(j); } catch { /* the list above already shows the result */ }
  };
  const paint = (j) => {
    if (!box.isConnected) return false;
    box.innerHTML = progressHtml(j);
    box.querySelector("[data-ba-stop]")?.addEventListener("click", async () => {
      try { paint(await cc().api(`/buildall/${encodeURIComponent(j.id)}/stop`, { method: "POST" })); }
      catch (e) { cc()?.toast?.(e.message, true); }
    });
    box.querySelector("[data-ba-pause]")?.addEventListener("click", async () => {
      try { paint(await cc().api(`/buildall/${encodeURIComponent(j.id)}/pause`, { method: "POST" })); }
      catch (e) { cc()?.toast?.(e.message, true); }
    });
    box.querySelector("[data-ba-resume]")?.addEventListener("click", async () => {
      try {
        paint(await cc().api(`/buildall/${encodeURIComponent(j.id)}/resume`, { method: "POST" }));
        setTimeout(tick, 400);
      } catch (e) { cc()?.toast?.(e.message, true); }
    });
    box.querySelector("[data-ba-save]")?.addEventListener("click", async () => {
      try {
        paint(await cc().api(`/buildall/${encodeURIComponent(j.id)}/save`, { method: "POST" }));
        cc()?.toast?.("Run saved on this computer.");
      } catch (e) { cc()?.toast?.(e.message, true); }
    });
    return true;
  };
  paint(job);
  setTimeout(tick, 900);
}
