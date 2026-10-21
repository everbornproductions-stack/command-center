// ChatGPT and Claude history import, optional encrypted sync (Phase 23). The History tab:
//   Import: pick the export zip (or type where it is on this PC), see what is inside, then file the chats under
//           a project. Desktop only; the file is read on this PC and goes nowhere else.
//   Sync:   off by default. On the desktop the app seals chats with a key from your passphrase and keeps them in
//           your Supabase project; on the phone (hosted hub) this page unseals them in the browser, so neither the
//           hub nor Supabase ever sees the text.
const { api, toast, esc, md, ago } = window.CC;
const S = () => window.CC.S;

const st = { data: null, preview: null, busy: false, phone: { keys: null, code: "", chats: [], open: null, cursor: 0 } };
const dateText = (t) => (t ? new Date(t).toLocaleDateString() : "?");

async function load() {
  try { st.data = await api("/history"); } catch (e) { toast(e.message, true); st.data = st.data || { batches: [], imported: 0, sync: {}, limits: {} }; }
}

// ---------- import ----------
function importPanel() {
  if (st.data.hosted) return `<div class="panel"><h3>Import from ChatGPT or Claude</h3><div class="small dim">Import runs on the desktop app, so your export never leaves your PC. Import there, then turn on sync to read the chats here.</div></div>`;
  const pv = st.preview;
  const projects = S().projects || [];
  return `<div class="panel"><h3>Import from ChatGPT or Claude <span class="right small dim">${st.data.imported} imported so far</span></h3>
    <div class="small dim">Get your export: in ChatGPT, Settings > Data controls > Export data; in Claude, Settings > Privacy > Export data. Each sends you a link to a .zip. The zip is read here on this PC; nothing is uploaded anywhere.</div>
    <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center">
      <input type="file" id="hi-file" accept=".zip,.json,application/zip">
      <span class="small dim">or where it is on this PC</span>
      <input type="text" id="hi-path" placeholder="C:\\Users\\you\\Downloads\\export.zip" style="width:280px">
      <button class="btn" id="hi-read" ${st.busy ? "disabled" : ""}>${st.busy ? "Reading..." : "Read the file"}</button>
    </div>
    ${pv ? `<div class="panel" style="margin-top:10px">
      <b>${esc(pv.sourceName)} export</b>: ${pv.conversations} chats, ${pv.messages} messages, ${dateText(pv.from)} to ${dateText(pv.to)}${pv.skipped ? `, ${pv.skipped} entries could not be read and are left out` : ""}${pv.alreadyImported ? `. ${pv.alreadyImported} are already here and are only updated if they changed` : ""}.
      ${pv.projects.length ? `<div class="small dim">Claude projects inside: ${pv.projects.map(esc).join(", ")}</div>` : ""}
      <div class="small" style="margin-top:6px">${pv.sample.map((c) => `<div>${esc(c.title)} <span class="dim">(${c.messages} messages, ${dateText(c.at)})</span></div>`).join("")}</div>
      <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap">
        <label class="small">File under <select id="hi-proj"><option value="new">A new project "Imported from ${esc(pv.sourceName)}"${pv.projects.length ? " (and one per Claude project)" : ""}</option>${projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}<option value="">No project</option></select></label>
        <button class="btn primary" id="hi-go">Import ${pv.conversations} chats</button><button class="btn" id="hi-cancel">Cancel</button>
      </div></div>` : ""}
    ${st.data.batches.length ? `<div class="small" style="margin-top:10px">${st.data.batches.slice(0, 6).map((b) => `<div>${ago(b.at)}: ${esc(st.data.sources[b.source] || b.source)}, ${b.added} added${b.updated ? `, ${b.updated} updated` : ""}${b.unchanged ? `, ${b.unchanged} unchanged` : ""}${b.notes?.length ? ` <span class="dim">(${esc(b.notes.join(" "))})</span>` : ""}</div>`).join("")}</div>` : ""}
  </div>`;
}

async function readFile(view) {
  const f = view.querySelector("#hi-file").files[0];
  const p = view.querySelector("#hi-path").value.trim();
  if (!f && !p) return toast("Pick the export .zip first.", true);
  st.busy = true; render(view);
  try {
    st.preview = f ? await api("/history/preview", { method: "POST", raw: f, contentType: f.name.toLowerCase().endsWith(".json") ? "application/octet-stream" : "application/zip" })
      : await api("/history/preview", { method: "POST", body: { path: p } });
  } catch (e) { toast(e.message, true); st.preview = null; }
  st.busy = false; render(view);
}

async function doImport(view) {
  const projectId = view.querySelector("#hi-proj").value;
  try {
    const r = await api("/history/import", { method: "POST", body: { token: st.preview.token, projectId } });
    toast(`Imported ${r.added} chats${r.updated ? `, updated ${r.updated}` : ""}${r.unchanged ? `, ${r.unchanged} were already here` : ""}.`);
    if (r.notes?.length) toast(r.notes.join(" "), true);
    st.preview = null;
    await window.CC.refresh?.();
  } catch (e) { toast(e.message, true); }
  await load(); render(view);
}

// ---------- sync on the desktop ----------
function syncPanel() {
  const s = st.data.sync || {};
  if (s.hosted) return phonePanel(s);
  const head = `<h3>Sync chats with your phone <span class="right small ${s.enabled ? "green" : "dim"}">${s.enabled ? "On" : "Off"}</span></h3>`;
  const what = `<div class="small dim">Off unless you turn it on. Chats are locked with a key made from your passphrase before they leave this PC; your Supabase project stores only the locked copies, never the text, the titles or the passphrase. Lose the passphrase and the copies cannot be opened by anyone, us included. Chats (single answers and imported chats) are synced; councils and missions stay on this PC.</div>`;
  if (!s.cloud?.configured) return `<div class="panel">${head}${what}<div class="small" style="margin-top:8px">Sync needs your Supabase project: fill in Settings > Cloud first, and run supabase/sync.sql on it once.</div></div>`;
  if (s.enabled) return `<div class="panel">${head}${what}
    <div style="margin-top:8px">Sync code: <span class="mono">${esc(s.code)}</span> <span class="small dim">(type it with the same passphrase on your phone; the code alone opens nothing)</span></div>
    <div class="small" style="margin-top:4px">${s.lastSyncAt ? `Last sync ${ago(s.lastSyncAt)}${s.last ? `: ${s.last.pushed} sent, ${s.last.pulled} received` : ""}` : "Not synced yet."}${s.lastError ? ` <span class="red">${esc(s.lastError)}</span>` : ""}${s.keyOnDevice ? "" : ` <span class="amber">The key is not on this device any more; set sync up again.</span>`}</div>
    <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap"><button class="btn primary" id="hs-now">Sync now</button><button class="btn" id="hs-off">Turn off</button><label class="small"><input type="checkbox" id="hs-del"> and delete the locked copies in the cloud</label></div></div>`;
  return `<div class="panel">${head}${what}
    <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap">
      <input type="password" id="hs-pass" placeholder="Passphrase (10+ characters)" autocomplete="new-password" style="width:220px">
      <input type="password" id="hs-pass2" placeholder="Same passphrase again" autocomplete="new-password" style="width:200px">
      <input type="text" id="hs-code" placeholder="Sync code (only to join another device)" style="width:250px">
      <label class="small"><input type="checkbox" id="hs-remember" checked> Remember on this PC (kept in the Windows vault)</label>
      <button class="btn primary" id="hs-on">Turn on sync</button></div></div>`;
}

async function syncAction(view, what) {
  const $ = (q) => view.querySelector(q);
  try {
    if (what === "on") {
      const pass = $("#hs-pass").value;
      if (pass !== $("#hs-pass2").value) return toast("The two passphrases are different.", true);
      const r = await api("/history/sync/setup", { method: "POST", body: { passphrase: pass, code: $("#hs-code").value.trim() || undefined, remember: $("#hs-remember").checked } });
      toast(`Sync is on. Sync code ${r.code}.${r.keptIn === "memory" ? " The key is kept only until the app closes." : ""}`);
    } else if (what === "now") {
      const r = await api("/history/sync/now", { method: "POST" });
      toast(`Synced: ${r.result.pushed} sent, ${r.result.pulled} received.`);
      if (r.result.pulled) await window.CC.refresh?.();
    } else if (what === "off") {
      const del = $("#hs-del").checked;
      if (del && !confirm("Delete the locked copies in the cloud? Other devices will stop receiving chats.")) return;
      await api("/history/sync/off", { method: "POST", body: { deleteRemote: del } });
      toast("Sync is off on this PC.");
    }
  } catch (e) { toast(e.message, true); }
  await load(); render(view);
}

// ---------- sync on the phone: everything happens in this browser ----------
function phonePanel(s) {
  const ph = st.phone;
  if (!s.supabase) return `<div class="panel"><h3>Synced chats</h3><div class="small dim">This hub has no Supabase project configured for sync.</div></div>`;
  if (!ph.keys) return `<div class="panel"><h3>Synced chats</h3><div class="small dim">Enter the sync code from your desktop and your passphrase. The chats are unlocked here in this browser; the hub never sees them. Nothing is kept after you close the page.</div>
    <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap"><input type="text" id="hp-code" placeholder="Sync code" style="width:230px"><input type="password" id="hp-pass" placeholder="Passphrase" autocomplete="current-password" style="width:200px"><button class="btn primary" id="hp-open">Unlock</button></div></div>`;
  const open = ph.open ? ph.chats.find((c) => c.chatId === ph.open) : null;
  return `<div class="panel"><h3>Synced chats <span class="right small dim">${ph.chats.length}</span></h3>
    <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn" id="hp-refresh">Refresh</button><button class="btn" id="hp-push">Send this hub's chats</button><button class="btn" id="hp-lock">Lock</button></div>
    ${open ? `<div class="panel" style="margin-top:8px"><b>${esc(open.title)}</b> <button class="btn small" id="hp-close">Back</button>${open.messages.map((m) => `<div style="margin-top:8px"><div class="small dim">${m.role === "user" ? "You" : esc(m.model || "AI")}</div>${md(m.text)}</div>`).join("")}</div>`
      : `<div style="margin-top:8px">${ph.chats.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map((c) => `<div class="row small" style="padding:6px 0;border-bottom:1px solid var(--line);cursor:pointer" data-chat="${esc(c.chatId)}"><span style="flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(c.title)}</span><span class="dim">${dateText(c.updatedAt)}</span></div>`).join("") || `<div class="small dim">No synced chats yet.</div>`}</div>`}</div>`;
}

let K = null;
const crypto$ = async () => (K ||= await import("/sync-crypto.js"));
async function rpc(fn, args) {
  const sb = st.data.sync.supabase;
  const r = await fetch(`${sb.url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: sb.anonKey, authorization: `Bearer ${sb.anonKey}`, "content-type": "application/json" }, body: JSON.stringify(args) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(/bad sync token/i.test(j?.message || "") ? "The sync service did not accept this key." : j?.message || `Sync failed (${r.status}).`);
  return j;
}
async function phoneUnlock(view) {
  const k = await crypto$();
  const code = k.normCode(view.querySelector("#hp-code").value), pass = view.querySelector("#hp-pass").value;
  try {
    if (!k.validCode(code)) throw new Error("That sync code does not look right.");
    const meta = await rpc("cc_sync_meta", { p_space: code });
    if (!meta?.salt) throw new Error("No sync space with that code.");
    toast("Unlocking (a few seconds)...");
    const keys = await k.keysFromRaw(await k.deriveRaw(pass, meta.salt, meta.kdf || k.KDF_DEFAULT));
    if (!(await k.verifyCheck(keys, meta.check))) throw new Error("Wrong passphrase for this sync code.");
    Object.assign(st.phone, { keys, code, chats: [], cursor: 0, open: null });
    await phonePull();
  } catch (e) { toast(e.message, true); }
  render(view);
}
async function phonePull() {
  const k = await crypto$(); const ph = st.phone;
  for (let round = 0; round < 1000; round++) {
    const rows = (await rpc("cc_sync_pull", { p_space: ph.code, p_token: ph.keys.token, p_since: ph.cursor, p_limit: 200 })) || [];
    for (const r of rows) {
      ph.cursor = Math.max(ph.cursor, Number(r.seq) || 0);
      try { const p = await k.open(ph.keys, r.blob, r.item); const i = ph.chats.findIndex((c) => c.chatId === p.chatId); if (i >= 0) ph.chats[i] = p; else ph.chats.push(p); } catch {}
    }
    if (rows.length < 200) break;
  }
}
async function phonePush() {
  const k = await crypto$(); const ph = st.phone;
  const list = (await api("/missions")).filter((m) => m.kind === "single" && m.status === "done");
  const items = [];
  for (const sm of list.slice(0, 200)) {
    const m = await api(`/missions/${sm.id}`);
    const p = { v: 1, chatId: m.id, kind: m.kind, source: "command-ai", provider: m.provider || null, model: m.model || null, title: m.title || String(m.prompt || "").slice(0, 90), startedAt: m.startedAt, finishedAt: m.finishedAt, updatedAt: m.finishedAt || m.startedAt, messages: [{ role: "user", text: m.prompt || "" }, { role: "assistant", text: m.deliverable || "", model: m.model }].filter((x) => x.text), origin: "phone" };
    const item = await k.itemId(ph.keys, m.id);
    items.push({ item, blob: await k.seal(ph.keys, p, item), updated_at: new Date(p.updatedAt || Date.now()).toISOString() });
  }
  for (let i = 0; i < items.length; i += 50) await rpc("cc_sync_push", { p_space: ph.code, p_token: ph.keys.token, p_items: items.slice(i, i + 50) });
  return items.length;
}

// ---------- render ----------
function render(view) {
  if (!st.data) { view.innerHTML = `<div class="panel">Loading...</div>`; return; }
  view.innerHTML = `${importPanel()}${syncPanel()}`;
  const on = (q, fn) => view.querySelector(q)?.addEventListener("click", fn);
  on("#hi-read", () => readFile(view));
  on("#hi-go", () => doImport(view));
  on("#hi-cancel", () => { st.preview = null; render(view); });
  on("#hs-on", () => syncAction(view, "on"));
  on("#hs-now", () => syncAction(view, "now"));
  on("#hs-off", () => syncAction(view, "off"));
  on("#hp-open", () => phoneUnlock(view));
  on("#hp-refresh", async () => { try { await phonePull(); } catch (e) { toast(e.message, true); } render(view); });
  on("#hp-push", async () => { try { toast(`Sent ${await phonePush()} chats.`); } catch (e) { toast(e.message, true); } });
  on("#hp-lock", () => { st.phone = { keys: null, code: "", chats: [], open: null, cursor: 0 }; render(view); });
  on("#hp-close", () => { st.phone.open = null; render(view); });
  view.querySelectorAll("[data-chat]").forEach((r) => r.addEventListener("click", () => { st.phone.open = r.dataset.chat; render(view); }));
}

window.CC.register({
  id: "history",
  tab: { label: "History", short: "History", icon: "⇩", order: 17, async render(view) { render(view); await load(); render(view); } },
  command: { order: 42, render(el) {
    el.innerHTML = `<div class="dim small" id="hi-name">Name an imported ChatGPT or Claude conversation in quotes and this chat uses it. For example: use "Tagline ideas for a bakery".</div>`;
  } },
  onEvent(ev) { if (ev.type === "history.synced" && S().view === "history") window.CC.refresh?.(); },
});
