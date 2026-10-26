// Installable phone web companion (Slice D2, gated behind flag_phoneweb).
// Reuses voice-mode.js, capture-input.js, pairing, phone-approvals, and handoff.
// Provides voice and text chat, live job progress, one-tap quick actions,
// queued direction (latest explicit direction wins), and real-time project + stage sync.

export const PHONEWEB_STAGES = [
  { id: "creative", label: "Creative" },
  { id: "planning", label: "Planning" },
  { id: "ai-movement", label: "AI Movement" },
  { id: "build", label: "Build" },
  { id: "testing", label: "Testing and Tweaks" },
  { id: "finish", label: "Finish" },
];

export const PHONEWEB_QUICK_BUTTONS = [
  { id: "schedule", label: "Schedule this" },
  { id: "book", label: "Book this" },
  { id: "email", label: "Email this" },
  { id: "post", label: "Post this" },
  { id: "image", label: "Make this image" },
  { id: "home", label: "Find my home" },
];

export function isPhoneCompanionEnabled(stateObj) {
  return Boolean(stateObj?.settings?.flag_phoneweb || (typeof window !== "undefined" && window.CC_FLAG_PHONEWEB));
}

export function resolveClientQueue(items = []) {
  const queued = items.filter((d) => d && d.status === "queued");
  const explicit = queued.filter((d) => d.explicit !== false && d.kind !== "note");
  const notes = queued.filter((d) => d.explicit === false || d.kind === "note");
  const winner = explicit.at(-1) || notes.at(-1) || null;
  const superseded = items.filter((d) => d && d.status === "superseded");
  return { winner, queued, notes, superseded };
}

const CSS = `
#cc-phoneweb { position: fixed; inset: 0; z-index: 75; background: var(--bg, #0b101b); color: var(--text, #e5e7eb); display: flex; flex-direction: column; overflow-y: auto; padding: 14px 16px 84px; }
#cc-phoneweb, #cc-phoneweb * { overflow-wrap: anywhere; min-width: 0; }
#cc-phoneweb select, #cc-phoneweb input[type=text], #cc-phoneweb textarea { max-width: 100%; box-sizing: border-box; }
#cc-phoneweb .row { flex-wrap: wrap; }
#cc-phoneweb[hidden] { display: none !important; }
#cc-phoneweb .pw-shell { width: min(680px, 100%); margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }
#cc-phoneweb .pw-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--line, #1f2937); }
#cc-phoneweb .pw-card { background: var(--panel-solid, #111827); border: 1px solid var(--line, #1f2937); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
#cc-phoneweb .pw-stages { display: flex; flex-wrap: wrap; gap: 6px; }
#cc-phoneweb .pw-stages button { border-radius: 999px; padding: 4px 10px; font-size: 0.78rem; }
#cc-phoneweb .pw-stages button.on { background: var(--accent, #22d3ee); color: #041019; font-weight: 600; border-color: transparent; }
#cc-phoneweb .pw-bar { height: 6px; background: var(--bg-2, #1a2333); border-radius: 4px; overflow: hidden; }
#cc-phoneweb .pw-bar > i { display: block; height: 100%; background: var(--green, #22c55e); transition: width .2s ease; }
#cc-phoneweb .pw-quick-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; }
#cc-phoneweb .pw-queue-win { border-left: 3px solid var(--accent, #22d3ee); padding: 6px 10px; background: var(--bg-2, #162032); border-radius: 6px; }
#cc-phoneweb .pw-superseded { opacity: 0.65; text-decoration: line-through; }
@media (max-width: 760px) {
  #cc-phoneweb { padding: 10px 12px 88px; }
  #cc-phoneweb .pw-quick-grid { grid-template-columns: repeat(2, 1fr); }
}
`;

if (typeof window !== "undefined" && window.CC && typeof document !== "undefined") {
  const { S, api, toast, esc } = window.CC;

  if (!document.getElementById("cc-phoneweb-style")) {
    const style = document.createElement("style");
    style.id = "cc-phoneweb-style";
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  let companionOpen = false;
  let state = null;
  let draftText = "";
  let explicitMode = true;
  let selectedPlatform = "instagram";
  let selectedLighting = "golden-hour";
  let selectedAmbience = "warm";
  let refreshTimer = null;
  let capture = null;
  import("./capture-input.js").then((m) => { capture = m; if (companionOpen) paintOverlay(); }).catch(() => {});

  try {
    const u = new URL(location.href);
    if (u.searchParams.get("phoneweb") === "1") companionOpen = true;
  } catch {}

  async function fetchState() {
    if (!isPhoneCompanionEnabled(S)) return null;
    try {
      state = await api("/phoneweb/state");
      if (state?.enabled && state.projectId && S.project !== state.projectId) {
        S.project = state.projectId;
      }
      return state;
    } catch {
      return null;
    }
  }

  function ensureOverlay() {
    let el = document.getElementById("cc-phoneweb");
    if (!el) {
      el = document.createElement("div");
      el.id = "cc-phoneweb";
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-label", "Phone companion");
      el.hidden = true;
      document.body.appendChild(el);
    }
    return el;
  }

  function openCompanion() {
    if (!isPhoneCompanionEnabled(S)) return;
    companionOpen = true;
    const el = ensureOverlay();
    el.hidden = false;
    fetchState().then(() => paintOverlay());
  }

  function closeCompanion() {
    companionOpen = false;
    const el = document.getElementById("cc-phoneweb");
    if (el) el.hidden = true;
  }

  function paintOverlay() {
    const el = ensureOverlay();
    if (!companionOpen || !isPhoneCompanionEnabled(S)) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    if (!state || !state.enabled) {
      el.innerHTML = `<div class="pw-shell"><div class="pw-card"><div class="row"><b>Phone companion</b><button type="button" class="btn sm" id="pw-close" style="margin-left:auto">Close</button></div><div class="dim small">Loading companion state...</div></div></div>`;
      el.querySelector("#pw-close")?.addEventListener("click", closeCompanion);
      return;
    }

    const stages = state.stages || PHONEWEB_STAGES;
    const curStage = state.stage || "creative";
    const projects = state.projects || S.projects || [];
    const curProject = state.projectId || S.project || "";
    const job = state.liveJob || { status: "idle", progress: { pct: 0, done: 0, total: 0 }, tasks: [], errors: [], decisions: [] };
    const q = state.queue || { activeDirection: null, queued: [], superseded: [] };
    const pendingApprovals = state.approvals?.pending || job.decisions || [];
    const jobRunning = ["running", "planning", "working", "waiting", "qa", "assembling", "paused"].includes(job.status);

    el.innerHTML = `<div class="pw-shell">
      <div class="pw-top">
        <div>
          <b>Phone companion</b>
          <div class="dim small">Same project and stage as your computer</div>
        </div>
        <div class="row" style="gap:6px">
          <button type="button" class="btn sm" id="pw-refresh">Refresh</button>
          <button type="button" class="btn sm" id="pw-close">Back to desktop view</button>
        </div>
      </div>

      <div class="pw-card" id="pw-context-card">
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <label class="small" style="font-weight:600" for="pw-project">Project</label>
          <select id="pw-project" aria-label="Project" style="flex:1;min-width:160px">
            <option value="">All projects</option>
            ${projects.map((p) => `<option value="${esc(p.id)}" ${p.id === curProject ? "selected" : ""}>${esc(p.name)}</option>`).join("")}
          </select>
        </div>
        <div class="small muted">Stage</div>
        <div class="pw-stages" role="group" aria-label="Stage">
          ${stages.map((st) => `<button type="button" class="btn sm ${st.id === curStage ? "on" : ""}" data-pw-stage="${esc(st.id)}">${esc(st.label)}</button>`).join("")}
        </div>
      </div>

      <div class="pw-card" id="pw-progress-card">
        <div class="row" style="justify-content:space-between;gap:8px">
          <b>Job progress</b>
          <span class="chip ${job.status === "failed" ? "red" : jobRunning ? "amber" : "green"}">${esc(job.status || "idle")}</span>
        </div>
        <div class="small">${esc(job.title || "Ready for your next direction")}</div>
        <div class="pw-bar" aria-label="Task progress"><i style="width:${Number(job.progress?.pct || 0)}%"></i></div>
        <div class="dim small">${Number(job.progress?.done || 0)} of ${Number(job.progress?.total || 0)} steps complete · Stage: ${esc(job.stageLabel || state.stageLabel || "Creative")}</div>
        ${(job.errors || []).length ? `<div class="small" style="color:var(--red)">${job.errors.map(esc).join(" · ")}</div>` : ""}
        ${job.deliverablePreview ? `<div class="small muted" style="max-height:110px;overflow:auto;padding:6px 8px;background:var(--bg-2);border-radius:6px">${esc(job.deliverablePreview)}</div>` : ""}
        ${pendingApprovals.length ? `<div id="pw-approvals" style="margin-top:4px;display:flex;flex-direction:column;gap:6px">
          <div class="small" style="color:var(--amber);font-weight:600">Needs your approval (${pendingApprovals.length})</div>
          ${pendingApprovals.map((ap) => `<div class="row small" style="gap:6px;background:var(--bg-2);padding:6px 8px;border-radius:6px;flex-wrap:wrap">
            <span style="flex:1"><b>${esc(ap.kind === "buy" ? "Purchase" : ap.kind === "delete" ? "Delete" : "Send")}</b>: ${esc(ap.action || "")}${ap.amount != null ? ` ($${Number(ap.amount).toFixed(2)})` : ""}</span>
            <button type="button" class="btn sm primary" data-pw-approve="${esc(ap.id)}">Approve</button>
            <button type="button" class="btn sm" data-pw-decline="${esc(ap.id)}">Decline</button>
          </div>`).join("")}
        </div>` : ""}
      </div>

      <div class="pw-card" id="pw-chat-card">
        <div class="row" style="justify-content:space-between;gap:8px">
          <b>Voice and text direction</b>
          <span class="dim small">Latest explicit direction wins</span>
        </div>
        <textarea id="pw-input" rows="3" placeholder="Speak or type your direction. You can send directions while the computer is working." aria-label="Phone direction">${esc(draftText)}</textarea>
        <div class="row small" style="gap:10px;flex-wrap:wrap">
          <label class="row small" style="gap:6px"><input type="radio" name="pw-dir-kind" value="explicit" ${explicitMode ? "checked" : ""}> New direction (replaces earlier queued direction)</label>
          <label class="row small" style="gap:6px"><input type="radio" name="pw-dir-kind" value="note" ${!explicitMode ? "checked" : ""}> Add note (keeps earlier direction)</label>
        </div>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <button type="button" class="btn sm" id="pw-mic" aria-pressed="false">Voice</button>
          <span class="dim small" id="pw-mic-note"></span>
          <button type="button" class="btn sm" id="pw-queue-btn" style="margin-left:auto">Queue direction</button>
          <button type="button" class="btn sm primary" id="pw-send-btn">${jobRunning ? "Queue for active job" : "Send now"}</button>
        </div>
        ${q.activeDirection ? `<div class="pw-queue-win small" id="pw-winning-direction">
          <div><b>Winning queued direction (${esc(q.activeDirection.from || "phone")})</b>: ${esc(q.activeDirection.text)}</div>
          <div class="row" style="gap:6px;margin-top:4px">
            <button type="button" class="btn sm primary" id="pw-consume-btn">Apply direction now</button>
            <button type="button" class="ghost small" data-pw-cancel="${esc(q.activeDirection.id)}">Cancel</button>
          </div>
        </div>` : `<div class="dim small">No direction queued right now.</div>`}
        ${(q.notes || []).length ? `<div class="small muted">Queued notes: ${q.notes.map((n) => esc(n.text)).join(" · ")}</div>` : ""}
        ${(q.superseded || []).length ? `<div class="small dim pw-superseded">Replaced earlier direction: ${esc(q.superseded[0].text)}</div>` : ""}
      </div>

      <div class="pw-card" id="pw-quick-card">
        <b>Quick actions</b>
        <div class="pw-quick-grid">
          ${PHONEWEB_QUICK_BUTTONS.map((b) => `<button type="button" class="btn sm" data-pw-quick="${esc(b.id)}">${esc(b.label)}</button>`).join("")}
        </div>
        <div class="row small" style="gap:8px;flex-wrap:wrap;margin-top:4px">
          <label class="small">Post platform
            <select id="pw-platform" aria-label="Post platform">
              ${(state.platforms || []).map((p) => `<option value="${esc(p.id)}" ${p.id === selectedPlatform ? "selected" : ""}>${esc(p.label)}</option>`).join("")}
            </select>
          </label>
          <label class="small">Image light
            <select id="pw-lighting" aria-label="Image light">
              ${(state.lighting || []).map((l) => `<option value="${esc(l.id)}" ${l.id === selectedLighting ? "selected" : ""}>${esc(l.label)}</option>`).join("")}
            </select>
          </label>
          <label class="small">Ambience
            <select id="pw-ambience" aria-label="Ambience">
              ${(state.ambience || []).map((a) => `<option value="${esc(a.id)}" ${a.id === selectedAmbience ? "selected" : ""}>${esc(a.label)}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="row small" style="gap:8px;flex-wrap:wrap">
          <input type="text" id="pw-home-addr" placeholder="Home address or landmark for Find my home" value="${esc(state.homeLocation || "")}" style="flex:1;min-width:180px">
        </div>
        ${(state.recentActions || []).length ? `<div class="small muted" id="pw-recent-actions">Latest action: ${esc(state.recentActions[0].summary || state.recentActions[0].label)}</div>` : ""}
      </div>

      <div class="pw-card">
        <div class="row" style="justify-content:space-between;gap:8px;flex-wrap:wrap">
          <div class="small"><b>Install on your phone</b>: use Share then Add to Home Screen (iPhone) or Install app (Android).</div>
          <button type="button" class="btn sm" id="pw-open-alerts">Push alerts</button>
        </div>
      </div>
    </div>`;

    el.querySelector("#pw-close")?.addEventListener("click", closeCompanion);
    el.querySelector("#pw-refresh")?.addEventListener("click", () => fetchState().then(() => paintOverlay()));

    el.querySelector("#pw-project")?.addEventListener("change", async (e) => {
      const nextProj = e.target.value;
      try {
        const r = await api("/phoneweb/context", { method: "POST", body: { projectId: nextProj, from: "phone" } });
        state = r.state;
        S.project = nextProj;
        paintOverlay();
        toast("Project synced");
      } catch (err) { toast(err.message, true); }
    });

    el.querySelectorAll("[data-pw-stage]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const nextStage = btn.dataset.pwStage;
        try {
          const r = await api("/phoneweb/context", { method: "POST", body: { stage: nextStage, from: "phone" } });
          state = r.state;
          paintOverlay();
          toast(`Stage: ${r.context.stageLabel}`);
        } catch (err) { toast(err.message, true); }
      });
    });

    const inputEl = el.querySelector("#pw-input");
    inputEl?.addEventListener("input", (e) => { draftText = e.target.value; });

    el.querySelectorAll('input[name="pw-dir-kind"]').forEach((radio) => {
      radio.addEventListener("change", (e) => {
        explicitMode = e.target.value === "explicit";
      });
    });

    const micBtn = el.querySelector("#pw-mic");
    const micNote = el.querySelector("#pw-mic-note");
    if (micBtn && inputEl && capture) {
      capture.wireVoice(micBtn, { getBox: () => inputEl, status: micNote });
    }

    const submitDirection = async (startIfIdle) => {
      const text = (inputEl?.value || draftText || "").trim();
      if (!text) return toast("Type or speak a direction first.", true);
      try {
        await api("/phoneweb/direction", {
          method: "POST",
          body: {
            text,
            projectId: state.projectId || S.project || "",
            stage: state.stage || "creative",
            from: "phone",
            explicit: explicitMode,
            kind: explicitMode ? "direction" : "note",
            startIfIdle: !!startIfIdle,
          },
        });
        draftText = "";
        if (inputEl) inputEl.value = "";
        await fetchState();
        paintOverlay();
        toast(explicitMode ? "Direction queued (latest wins)" : "Note added to queue");
      } catch (err) { toast(err.message, true); }
    };

    el.querySelector("#pw-queue-btn")?.addEventListener("click", () => submitDirection(false));
    el.querySelector("#pw-send-btn")?.addEventListener("click", () => submitDirection(true));

    el.querySelector("#pw-consume-btn")?.addEventListener("click", async () => {
      try {
        await api("/phoneweb/direction/consume", {
          method: "POST",
          body: {
            runId: state.liveJob?.id || null,
            projectId: state.projectId || S.project || "",
            triggerFollowup: true,
          },
        });
        await fetchState();
        paintOverlay();
        toast("Queued direction applied");
      } catch (err) { toast(err.message, true); }
    });

    el.querySelectorAll("[data-pw-cancel]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api("/phoneweb/direction/cancel", { method: "POST", body: { id: btn.dataset.pwCancel } });
          await fetchState();
          paintOverlay();
          toast("Direction cancelled");
        } catch (err) { toast(err.message, true); }
      });
    });

    el.querySelectorAll("[data-pw-approve]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api("/phoneweb/approval", { method: "POST", body: { id: btn.dataset.pwApprove, decision: "approve" } });
          await fetchState();
          paintOverlay();
          toast("Approved");
        } catch (err) { toast(err.message, true); }
      });
    });

    el.querySelectorAll("[data-pw-decline]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api("/phoneweb/approval", { method: "POST", body: { id: btn.dataset.pwDecline, decision: "decline" } });
          await fetchState();
          paintOverlay();
          toast("Declined");
        } catch (err) { toast(err.message, true); }
      });
    });

    el.querySelector("#pw-platform")?.addEventListener("change", (e) => { selectedPlatform = e.target.value; });
    el.querySelector("#pw-lighting")?.addEventListener("change", (e) => { selectedLighting = e.target.value; });
    el.querySelector("#pw-ambience")?.addEventListener("change", (e) => { selectedAmbience = e.target.value; });

    el.querySelectorAll("[data-pw-quick]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.dataset.pwQuick;
        const text = (inputEl?.value || draftText || state.liveJob?.deliverablePreview || state.liveJob?.title || "").trim();
        const homeLocation = el.querySelector("#pw-home-addr")?.value.trim() || state.homeLocation || "";
        try {
          const r = await api("/phoneweb/quick", {
            method: "POST",
            body: {
              action,
              text,
              projectId: state.projectId || S.project || "",
              stage: state.stage || "creative",
              platform: selectedPlatform,
              lighting: selectedLighting,
              ambience: selectedAmbience,
              homeLocation,
            },
          });
          await fetchState();
          paintOverlay();
          toast(r.entry?.summary || "Action ready");
        } catch (err) { toast(err.message, true); }
      });
    });

    el.querySelector("#pw-open-alerts")?.addEventListener("click", () => {
      closeCompanion();
      window.CC.openSettings?.("#settings-extras");
    });
  }

  if (companionOpen) setTimeout(openCompanion, 0);

  window.CC.phoneweb = {
    open: openCompanion,
    close: closeCompanion,
    refresh: () => fetchState().then(() => paintOverlay()),
  };

  window.CC.register({
    id: "phoneweb",
    command: {
      order: 18,
      async render(el) {
        if (!isPhoneCompanionEnabled(S)) { el.innerHTML = ""; return; }
        const st = await fetchState();
        if (!st?.enabled) { el.innerHTML = ""; return; }
        const qCount = st.queue?.totalQueued || 0;
        const apCount = (st.approvals?.pending || []).length;
        el.innerHTML = `<div class="route row small" style="margin-top:8px;gap:8px;flex-wrap:wrap">
          <span><b>Phone companion</b> · Stage: ${esc(st.stageLabel || "Creative")}${qCount ? ` · ${qCount} queued` : ""}${apCount ? ` · ${apCount} waiting approval` : ""}</span>
          <button type="button" class="btn sm" id="pw-cmd-open" style="margin-left:auto">Open phone view</button>
        </div>`;
        el.querySelector("#pw-cmd-open")?.addEventListener("click", openCompanion);
      },
    },
    settings: {
      order: 9,
      async render(el) {
        if (!isPhoneCompanionEnabled(S)) { el.innerHTML = ""; return; }
        const st = await fetchState();
        if (!st?.enabled) { el.innerHTML = ""; return; }
        el.innerHTML = `<div class="panel" id="settings-phoneweb">
          <h3>Phone web companion <span class="right">voice, progress &amp; quick actions</span></h3>
          <div class="small muted">Work from your phone and computer at the same time on the same project and stage. Queued directions use latest-direction-wins conflict resolution.</div>
          <div class="row" style="margin-top:8px;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn sm primary" id="pw-settings-open">Open phone companion</button>
            <span class="dim small">Current stage: ${esc(st.stageLabel || "Creative")} · Project: ${esc(st.projectName || "All projects")}</span>
          </div>
        </div>`;
        el.querySelector("#pw-settings-open")?.addEventListener("click", openCompanion);
      },
    },
    onEvent(ev) {
      if (!isPhoneCompanionEnabled(S)) return;
      if (ev.type === "phoneweb.sync" || ev.type === "phoneweb.queue" || ev.type === "phoneweb.progress" || ev.type === "phoneweb.quick" || ev.type === "mission.update") {
        if (ev.type === "phoneweb.sync" && ev.projectId !== undefined && S.project !== ev.projectId) {
          S.project = ev.projectId;
        }
        if (companionOpen) {
          clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => fetchState().then(() => paintOverlay()), 400);
        }
      }
    },
  });
}
