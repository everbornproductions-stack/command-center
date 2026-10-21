// Learning router (Phase 28): the "Who's best at what" tab.
// Per task type, the top models from this person's own jobs: win rate, average score, thumbs, cost per job,
// speed, and how many jobs the ranking rests on. Learning on/off, export, reset, and the opt-in share preview.
const { S, api, toast, esc, money } = window.CC;

const CAP_LABEL = { reasoning: "Reasoning", code: "Code", writing: "Writing", research: "Research", creative: "Creative", analysis: "Analysis", math: "Math", fast: "Quick jobs" };
const MODE_LABEL = { max: "Max quality", quality: "Quality first", balanced: "Balanced", savings: "Max savings", speed: "Speed" };
const pct = (v) => (v == null ? "n/a" : `${Math.round(v * 100)}%`);
const secs = (v) => (v == null ? "n/a" : v < 10 ? `${v.toFixed(1)} s` : `${Math.round(v)} s`);
let mode = null;

function table(c) {
  return `<div class="panel"><h3>${esc(CAP_LABEL[c.capability] || c.capability)} <span class="right">${c.jobs} job${c.jobs === 1 ? "" : "s"}</span></h3>
    <table style="width:100%;border-collapse:collapse" class="small">
      <tr class="dim"><td>#</td><td>Model</td><td title="Council rounds won">Win rate</td><td title="Average peer score out of 10">Avg score</td><td title="Your thumbs up / down">Thumbs</td><td title="Jobs that finished">Success</td><td title="Average cost of one job">Cost / job</td><td title="Average time of one job">Speed</td><td title="How many jobs this rests on">Based on</td></tr>
      ${c.models.map((m, i) => `<tr style="border-top:1px solid var(--line)">
        <td>${i + 1}</td>
        <td><span class="dot" style="background:${m.color || "var(--muted)"}"></span> <b>${esc(m.name)}</b> <span class="dim">${esc(m.providerName || "")}</span></td>
        <td>${m.rounds ? `${pct(m.winRate)} <span class="dim">(${m.wins}/${m.rounds})</span>` : `<span class="dim">no council yet</span>`}</td>
        <td>${m.avgScore != null ? `${m.avgScore}/10` : m.avgQa != null ? `${m.avgQa}/10 <span class="dim">QA</span>` : `<span class="dim">n/a</span>`}</td>
        <td>${m.up || m.down ? `👍 ${m.up} · 👎 ${m.down}` : `<span class="dim">none</span>`}</td>
        <td>${pct(m.successRate)}</td>
        <td class="mono">${m.costPerJob == null ? "n/a" : money(m.costPerJob, 4)}</td>
        <td>${secs(m.avgSec)}</td>
        <td>${m.jobs} job${m.jobs === 1 ? "" : "s"}${m.confidence < 0.5 ? ` <span class="chip" title="Few jobs so far: the built-in score still counts for most of it">early</span>` : ""}</td>
      </tr>`).join("")}
    </table></div>`;
}

async function renderTab(view) {
  view.innerHTML = `<div class="empty">Loading…</div>`;
  mode ||= S.costMode || S.settings?.defaultMode || "balanced";
  if (mode === "economy") mode = "savings";
  let d; try { d = await api(`/brain?mode=${encodeURIComponent(mode)}`); } catch (e) { view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const on = d.settings.on !== false;
  view.innerHTML = `<div class="grid" style="grid-template-columns: minmax(0,1fr) 320px">
    <div class="grid" style="align-content:start">
      <div class="panel"><h3>Who's best at what <span class="right">${d.jobs} job${d.jobs === 1 ? "" : "s"} learned since ${new Date(d.since).toLocaleDateString()}</span></h3>
        <div class="small muted">Every job teaches the router which AI is best at which kind of work, for the price: council scores and wins, your thumbs, QA scores, cost per job, speed and failures. It uses that to pick the AI for your next job, starting from the built-in scores, and it gets sharper with each job. Only the task type and the numbers are kept, never your prompts, answers or keys.</div>
        <div class="row" style="gap:8px;margin-top:10px"><span class="small muted">Rank for</span>${Object.entries(MODE_LABEL).map(([k, v]) => `<button class="btn sm ${k === mode ? "primary" : ""}" data-mode="${k}">${v}</button>`).join("")}</div>
        <div class="dim small" style="margin-top:8px">Community track records, when you add them, count for Max quality, Quality, Balanced, Max savings, and Speed.</div>
      </div>
      ${!on ? `<div class="panel"><div class="dim small">Learning is off: picks use the built-in scores only and nothing new is recorded. Turn it on at the right.</div></div>` : ""}
      ${d.capabilities.length ? d.capabilities.map(table).join("") : `<div class="panel"><div class="empty">Nothing learned yet. Run a chat, a council or a mission and the rankings appear here.</div></div>`}
    </div>
    <div class="grid" style="align-content:start">
      <div class="panel"><h3>Learning</h3>
        <label class="row small" style="gap:6px"><input type="checkbox" id="br-on" ${on ? "checked" : ""}> Learn from every job</label>
        <div class="dim small" style="margin-top:6px">Meldmind learns from every job you run. Stored with your own data on this computer (on the hosted hub, in your own account rows). It is exported and deleted with the rest of your data. Prompts, files, and keys are never used. You can turn it off any time in Settings.</div>
        <div class="row" style="gap:8px;margin-top:10px"><button class="btn sm" id="br-export">Export</button><button class="btn sm" id="br-reset" style="margin-left:auto">Reset what it learned</button></div>
      </div>
      <div class="panel"><h3>Help build a better router</h3>
        <label class="row small" style="gap:6px"><input type="checkbox" id="br-share" ${d.settings.shareOptIn ? "checked" : ""}> I am willing to share anonymous track records</label>
        <div class="dim small" id="br-share-note" ${d.settings.shareOptIn ? "hidden" : ""} style="margin-top:6px">Meldmind learns from the community. With this off, your jobs won't help make it smarter for everyone, but you'll still benefit from what others share.</div>
        <div class="dim small" style="margin-top:6px">Meldmind learns from every job you run. Anonymous track records (the task type, which AI, and the score) help it pick the best AI for everyone. We never share prompts, content, or keys. You can change this any time in Settings. On Who's best, clear I am willing to share anonymous track records. <a href="#what-we-share" id="br-share-what">What we share</a> This version sends nothing. Show what would be shared lists the anonymous totals on this computer.</div>
        <button class="btn sm" id="br-preview" style="margin-top:8px">Show what would be shared</button>
        <div class="dim small" style="margin-top:10px">Add a file of anonymous totals from people who opted in. Max quality, Quality, Balanced, Max savings, and Speed all learn from it. Nothing is uploaded. This stays on this computer.</div>
        <label class="btn sm" style="margin-top:8px;display:inline-block">Add community track records<input id="br-community" type="file" accept="application/json,.json" hidden></label>
        <div class="dim small" id="br-community-note" style="margin-top:6px"></div>
        <pre id="br-preview-out" class="small mono" style="display:none;max-height:240px;overflow:auto;margin-top:8px"></pre>
      </div>
    </div></div>`;
  view.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => { mode = b.dataset.mode; renderTab(view); }));
  const saveSettings = async (patch) => { try { await api("/brain/settings", { method: "POST", body: { ...patch, mode } }); toast("Saved"); renderTab(view); } catch (e) { toast(e.message, true); } };
  view.querySelector("#br-on").addEventListener("change", (e) => saveSettings({ on: e.target.checked }));
  view.querySelector("#br-share").addEventListener("change", (e) => saveSettings({ shareOptIn: e.target.checked }));
  view.querySelector("#br-share-what")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    window.CC.openHelp?.("getting-started");
  });
  view.querySelector("#br-reset").addEventListener("click", async () => {
    if (!confirm("Reset what the router has learned? Picks start again from the built-in scores. Your runs and ledger are kept.")) return;
    try { await api("/brain/reset", { method: "POST", body: { confirm: true, mode } }); toast("Learning router reset"); renderTab(view); } catch (e) { toast(e.message, true); }
  });
  view.querySelector("#br-export").addEventListener("click", async () => {
    try {
      const data = await api("/brain/export");
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: `command-ai-learning-router-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { toast(e.message, true); }
  });
  view.querySelector("#br-preview").addEventListener("click", async () => {
    try { const p = await api("/brain/share-preview"); const out = view.querySelector("#br-preview-out"); out.style.display = "block"; out.textContent = JSON.stringify(p, null, 2); } catch (e) { toast(e.message, true); }
  });
  const note = view.querySelector("#br-community-note");
  api("/brain/community").then((c) => { if (note) note.textContent = c.rows ? `${c.rows} community row${c.rows === 1 ? "" : "s"} on this computer. Nothing has been sent.` : "No community track records yet. Nothing has been sent."; }).catch(() => {});
  view.querySelector("#br-community")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const rows = Array.isArray(data) ? data : data?.rows;
      const saved = await api("/brain/community", { method: "POST", body: { rows } });
      toast(`Community track records added (${saved.rows}). Nothing was uploaded.`);
      renderTab(view);
    } catch (err) { toast(err.message, true); }
  });
}

CC.register({ id: "brain", tab: { label: "Who's best", short: "Best at", icon: "★", order: 30, render: renderTab } });
