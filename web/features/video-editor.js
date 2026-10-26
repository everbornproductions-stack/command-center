// Video sound and subtitle editor on the Media page (flag_videoeditor, 0.4.19).
// Edits sit on top of the original video. The original is never changed: Preview and Export make new files.
// Nothing is posted or sent from here.
const CC = window.CC;

const STYLE = `
.ve-card{margin-top:12px;overflow-wrap:anywhere;word-break:break-word}
.ve-card h4{margin:14px 0 6px}
.ve-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0;min-width:0}
.ve-row>*{min-width:0}
.ve-row input[type=text],.ve-row textarea,.ve-row select{max-width:100%;box-sizing:border-box}
.ve-grow{flex:1 1 160px}
.ve-num{width:84px}
.ve-video{width:100%;max-height:340px;background:#000;border-radius:6px}
.ve-item{border:1px solid var(--line);border-radius:6px;padding:8px;margin:6px 0}
.ve-item textarea{width:100%;min-height:48px;box-sizing:border-box}
.ve-lane{position:relative;height:18px;background:var(--panel2,rgba(128,128,128,.12));border-radius:4px;margin:3px 0;overflow:hidden}
.ve-bar{position:absolute;top:2px;bottom:2px;border-radius:3px;min-width:3px;opacity:.85}
.ve-lane-label{font-size:11px;opacity:.7;margin-top:6px}
.ve-help{opacity:.7;font-size:12px}
.ve-msg{min-height:1.2em;overflow-wrap:anywhere}
`;
function ensureStyle() {
  if (document.getElementById("ve-style")) return;
  const s = document.createElement("style");
  s.id = "ve-style";
  s.textContent = STYLE;
  document.head.appendChild(s);
}

const secs = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.round(n * 100) / 100) : 0; };
const clock = (t) => { const s = Math.max(0, Number(t) || 0); return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`; };

let lastOpen = ""; // the Media page redraws on job events, so the open edit is reopened
export async function mountVideoEditor(view) {
  if (!view || !CC.S?.flags?.videoeditor) return;
  ensureStyle();
  const { api, esc, toast } = CC;
  const expert = () => (CC.uiMode?.() || CC.S?.uiMode || CC.S?.settings?.uiMode) === "expert";
  view.querySelector(":scope > .ve-card")?.remove();
  const card = document.createElement("div");
  card.className = "panel ve-card";
  card.setAttribute("aria-label", "Video editor");
  view.appendChild(card);

  let status = { ffmpeg: true, transitions: [] };
  let projects = [];
  let p = null;
  let dirty = false;
  let busy = null; // running render job
  let blobUrl = "";
  let pollTimer = null;
  let msg = "";
  const q = (sel) => card.querySelector(sel);

  const stopPoll = () => { clearTimeout(pollTimer); pollTimer = null; };
  const freeBlob = () => { if (blobUrl) { try { URL.revokeObjectURL(blobUrl); } catch {} blobUrl = ""; } };
  // The page left: stop polling and release the video.
  const gone = () => !card.isConnected;

  async function loadList() {
    try { status = await api("/videoeditor/status"); } catch {}
    try { projects = (await api("/videoeditor/projects")).items || []; } catch { projects = []; }
  }

  async function open(id) {
    stopPoll(); freeBlob(); busy = null; msg = "";
    lastOpen = id;
    try { p = await api(`/videoeditor/projects/${encodeURIComponent(id)}`); dirty = false; } catch (e) { p = null; toast(e.message, true); }
    render();
    if (p) loadSource();
  }
  async function loadSource(w = "source") {
    which = w;
    const v = q("#ve-video");
    if (!v || !p) return;
    try {
      freeBlob();
      blobUrl = await CC.apiBlobUrl(`/videoeditor/projects/${encodeURIComponent(p.id)}/${w === "preview" ? "preview.mp4" : "source"}`);
      if (!gone()) { v.src = blobUrl; q("#ve-which").textContent = w === "preview" ? "Showing the preview" : "Showing the original"; }
    } catch (e) { setMsg(e.message, true); }
  }
  function setMsg(t, bad) { msg = t; const el = q("#ve-msg"); if (el) { el.textContent = t; el.style.color = bad ? "var(--red)" : ""; } }

  async function save() {
    if (!p || !dirty) return p;
    try { p = await api(`/videoeditor/projects/${encodeURIComponent(p.id)}`, { method: "PUT", body: p }); dirty = false; const s = q("#ve-saved"); if (s) s.textContent = "Saved"; }
    catch (e) { setMsg(e.message, true); }
    return p;
  }
  let saveTimer = null;
  function touch() { dirty = true; const s = q("#ve-saved"); if (s) s.textContent = "Not saved yet"; clearTimeout(saveTimer); saveTimer = setTimeout(() => { if (!gone()) save().then(() => !gone() && paintTimeline()); }, 900); }

  const total = () => (p.segments || []).reduce((a, s) => a + Math.max(0, s.end - s.start), 0);
  const playhead = () => secs(q("#ve-video")?.currentTime || 0);

  // ----- timeline strip -----
  function lane(label, items, color) {
    const t = Math.max(0.1, total());
    return `<div class="ve-lane-label">${esc(label)}</div><div class="ve-lane" role="img" aria-label="${esc(label)}: ${items.length}">${items.map((i) => `<div class="ve-bar" style="left:${Math.min(100, (i.start / t) * 100)}%;width:${Math.max(0.5, Math.min(100 - (i.start / t) * 100, ((i.end - i.start) / t) * 100))}%;background:${color}" title="${esc(i.title || "")}"></div>`).join("")}</div>`;
  }
  function paintTimeline() {
    const el = q("#ve-tl");
    if (!el || !p) return;
    const t = total();
    const segs = []; let at = 0;
    p.segments.forEach((s, i) => { segs.push({ start: at, end: at + (s.end - s.start), title: `Part ${i + 1}` }); at += s.end - s.start; });
    el.innerHTML = `<div class="ve-help">Final length ${clock(t)}</div>`
      + lane("Video parts", segs, "var(--accent,#4f8cff)")
      + lane("Sound line", p.sounds.map((s) => ({ start: s.start, end: s.start + (s.length || Math.max(0.5, t - s.start)), title: s.label })), "var(--green,#3fb27f)")
      + lane("Subtitle line", p.subtitles.map((s) => ({ ...s, title: s.text })), "var(--amber,#e0a030)")
      + lane("Text on screen", p.overlays.map((o) => ({ ...o, title: o.text })), "var(--red,#d9534f)");
  }

  // ----- render -----
  const num = (attr, v, step = "0.1", extra = "") => `<input type="number" class="ve-num" min="0" step="${step}" value="${esc(String(v))}" ${attr} ${extra}>`;
  let which = "source";
  function render() {
    stopPoll();
    const keepAt = q("#ve-video")?.currentTime || 0;
    const opts = projects.map((x) => `<option value="${esc(x.id)}" ${p && p.id === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("");
    card.innerHTML = `<h3>Video editor</h3>
      <div class="ve-help">Change the sound, add subtitles and text, trim the video. Your original video is never changed. Preview and Export make a new file.</div>
      ${status.ffmpeg ? "" : `<div class="ve-item" role="alert">This computer has no video tool yet. You can plan your edits, but Preview and Export need ffmpeg installed.</div>`}
      <div class="ve-row"><label for="ve-pick">Your edits</label><select id="ve-pick" class="ve-grow"><option value="">Pick a saved edit...</option>${opts}</select><button type="button" class="btn sm" id="ve-newbtn">New from a video</button>${p ? `<button type="button" class="btn sm" id="ve-del">Delete this edit</button>` : ""}</div>
      <div id="ve-new" hidden></div>
      ${p ? editor() : `<div class="dim small">Pick a saved edit or start a new one from a finished video.</div>`}
      <div class="ve-msg small" id="ve-msg" aria-live="polite">${esc(msg)}</div>`;
    wire();
    if (p) {
      paintTimeline();
      const v = q("#ve-video");
      if (v && blobUrl) { v.src = blobUrl; q("#ve-which").textContent = which === "preview" ? "Showing the preview" : "Showing the original"; if (keepAt) v.addEventListener("loadedmetadata", () => { v.currentTime = keepAt; }, { once: true }); }
    }
  }

  function editor() {
    const tr = status.transitions || [];
    return `<div class="ve-row"><input type="text" id="ve-name" class="ve-grow" value="${esc(p.name)}" aria-label="Name of this edit"><span class="dim small" id="ve-saved">${dirty ? "Not saved yet" : "Saved"}</span></div>
      <video id="ve-video" class="ve-video" controls preload="metadata" aria-label="Video player"></video>
      <div class="ve-row"><span class="dim small" id="ve-which"></span><button type="button" class="btn sm" id="ve-show-orig">Show original</button><button type="button" class="btn sm" id="ve-show-prev">Show preview</button></div>
      <div id="ve-tl"></div>

      <h4>Timing</h4>
      <div class="ve-help">${expert() ? "Parts are cut from the source and joined in order (trim and concat). Times are in seconds." : "Keep only the parts you want. They play one after the other."}</div>
      ${p.segments.map((s, i) => `<div class="ve-item"><div class="ve-row"><b>Part ${i + 1}</b>
        <label>From ${num(`data-seg="${i}" data-f="start"`, s.start)}</label><button type="button" class="btn sm" data-segnow="${i}:start">Use playhead</button>
        <label>To ${num(`data-seg="${i}" data-f="end"`, s.end)}</label><button type="button" class="btn sm" data-segnow="${i}:end">Use playhead</button>
        ${p.segments.length > 1 ? `<button type="button" class="btn sm" data-segdel="${i}">Remove</button>` : ""}</div></div>`).join("")}
      <div class="ve-row"><button type="button" class="btn sm" id="ve-segadd">Add another part</button></div>
      <div class="ve-row"><label for="ve-trans">Between parts</label><select id="ve-trans">${tr.map((t) => `<option value="${esc(t.id)}" ${p.transition.kind === t.id ? "selected" : ""}>${esc(t.label)}</option>`).join("")}</select>
        <label>Seconds ${num('id="ve-transs"', p.transition.seconds, "0.1")}</label></div>
      <div class="ve-row"><label>Fade in at the start (seconds) ${num('id="ve-fin"', p.fadeIn)}</label><label>Fade out at the end (seconds) ${num('id="ve-fout"', p.fadeOut)}</label></div>

      <h4>Sound line</h4>
      <div class="ve-row"><label>${expert() ? "Original sound level (%)" : "Original sound loudness"} <input type="range" id="ve-vol" min="0" max="200" value="${p.audio.volume}" aria-label="Original sound loudness"> <span id="ve-volv">${p.audio.volume}%</span></label>
        <label><input type="checkbox" id="ve-mute" ${p.audio.muted ? "checked" : ""}> Mute the original sound</label></div>
      ${p.info.hasAudio ? "" : `<div class="ve-help">This video has no sound of its own.</div>`}
      ${p.sounds.map((s, i) => `<div class="ve-item"><div class="ve-row"><b class="ve-grow">${esc(s.label)}</b><button type="button" class="btn sm" data-snddel="${i}">Remove</button></div>
        <div class="ve-row"><label>Starts at ${num(`data-snd="${i}" data-f="start"`, s.start)}</label><button type="button" class="btn sm" data-sndnow="${i}">Use playhead</button>
        <label>Loudness % ${num(`data-snd="${i}" data-f="volume"`, s.volume, "5")}</label>
        <label>Fade in ${num(`data-snd="${i}" data-f="fadeIn"`, s.fadeIn)}</label><label>Fade out ${num(`data-snd="${i}" data-f="fadeOut"`, s.fadeOut)}</label>
        <label>Plays for ${num(`data-snd="${i}" data-f="length"`, s.length)}</label></div>${s.length ? "" : `<div class="ve-help">Plays for 0 means until the end.</div>`}</div>`).join("")}
      <div class="ve-row"><select id="ve-sndsrc" class="ve-grow" aria-label="Pick a sound"><option value="">Add a sound from your media...</option></select><button type="button" class="btn sm" id="ve-sndadd">Add sound</button><label class="btn sm" for="ve-sndfile">Upload a sound</label><input type="file" id="ve-sndfile" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" hidden></div>

      <h4>Subtitle line</h4>
      ${p.subtitles.map((s, i) => `<div class="ve-item"><div class="ve-row"><label>From ${num(`data-sub="${i}" data-f="start"`, s.start)}</label><label>To ${num(`data-sub="${i}" data-f="end"`, s.end)}</label><button type="button" class="btn sm" data-subnow="${i}">Start at playhead</button><button type="button" class="btn sm" data-subdel="${i}">Remove</button></div>
        <textarea data-sub="${i}" data-f="text" maxlength="400" aria-label="Subtitle ${i + 1} words">${esc(s.text)}</textarea></div>`).join("") || `<div class="ve-help">No subtitles yet.</div>`}
      <div class="ve-row"><button type="button" class="btn sm" id="ve-subadd">Add a subtitle at the playhead</button><button type="button" class="btn sm" id="ve-srtget">Download SRT</button><button type="button" class="btn sm" id="ve-srtbtn">Paste SRT</button></div>
      <div id="ve-srtbox" hidden><textarea id="ve-srttext" class="ve-grow" style="width:100%;min-height:90px;box-sizing:border-box" placeholder="Paste an SRT file here" aria-label="SRT text"></textarea><div class="ve-row"><button type="button" class="btn sm primary" id="ve-srtgo">Replace subtitles</button><button type="button" class="btn sm" id="ve-srtapp">Add to the end</button></div></div>

      <h4>Text on screen</h4>
      ${p.overlays.map((o, i) => `<div class="ve-item"><div class="ve-row"><label>From ${num(`data-ov="${i}" data-f="start"`, o.start)}</label><label>To ${num(`data-ov="${i}" data-f="end"`, o.end)}</label>
        <label>Across ${num(`data-ov="${i}" data-f="x"`, o.x, "1")}%</label><label>Down ${num(`data-ov="${i}" data-f="y"`, o.y, "1")}%</label><label>Size ${num(`data-ov="${i}" data-f="size"`, o.size, "1")}</label>
        <label>Color <input type="color" data-ov="${i}" data-f="color" value="${esc(o.color)}"></label><button type="button" class="btn sm" data-ovdel="${i}">Remove</button></div>
        <textarea data-ov="${i}" data-f="text" maxlength="200" aria-label="Text on screen ${i + 1}">${esc(o.text)}</textarea></div>`).join("") || `<div class="ve-help">No text on screen yet.</div>`}
      <div class="ve-row"><button type="button" class="btn sm" id="ve-ovadd">Add text at the playhead</button></div>

      <h4>Preview and export</h4>
      <div class="ve-row"><button type="button" class="btn sm" id="ve-prev" ${busy ? "disabled" : ""}>Make a preview</button><button type="button" class="btn sm primary" id="ve-exp" ${busy ? "disabled" : ""}>Export new video</button><button type="button" class="btn sm" id="ve-cancel" ${busy ? "" : "hidden"}>Cancel</button><span class="small" id="ve-prog" aria-live="polite"></span></div>
      <div class="ve-help">${expert() ? "Preview is 360p, fast encode, first 30 seconds from the playhead. Export is H.264 and AAC in the project media folder, as a new file." : "A preview is small and quick. Export makes a new video file in this project. Your original stays as it is."}</div>
      ${(p.exports || []).length ? `<div class="small" style="margin-top:6px">Exports: ${p.exports.slice(-3).map((e) => esc(e.name)).join(", ")}</div>` : ""}`;
  }

  // ----- wiring -----
  function wire() {
    q("#ve-pick").addEventListener("change", (e) => { if (e.target.value) open(e.target.value); else { lastOpen = ""; p = null; freeBlob(); render(); } });
    q("#ve-newbtn").addEventListener("click", openNew);
    q("#ve-del")?.addEventListener("click", async () => {
      if (!confirm("Delete this edit? The original video and any exported files stay on your computer.")) return;
      try { await api(`/videoeditor/projects/${encodeURIComponent(p.id)}`, { method: "DELETE" }); lastOpen = ""; p = null; freeBlob(); await loadList(); render(); } catch (e) { setMsg(e.message, true); }
    });
    if (!p) return;
    q("#ve-name").addEventListener("change", (e) => { p.name = e.target.value; touch(); });
    q("#ve-show-orig").addEventListener("click", () => loadSource("source"));
    q("#ve-show-prev").addEventListener("click", () => loadSource("preview"));

    const field = (obj, f, el) => { obj[f] = f === "text" ? el.value : f === "color" ? el.value : secs(el.value); };
    card.querySelectorAll("[data-seg]").forEach((el) => el.addEventListener("change", () => { field(p.segments[+el.dataset.seg], el.dataset.f, el); touch(); render(); }));
    card.querySelectorAll("[data-segnow]").forEach((b) => b.addEventListener("click", () => { const [i, f] = b.dataset.segnow.split(":"); p.segments[+i][f] = playhead(); touch(); render(); }));
    card.querySelectorAll("[data-segdel]").forEach((b) => b.addEventListener("click", () => { p.segments.splice(+b.dataset.segdel, 1); touch(); render(); }));
    q("#ve-segadd").addEventListener("click", () => { const d = p.info.duration || 10; const last = p.segments.at(-1); p.segments.push({ start: Math.min(d - 0.5, last ? last.end : 0), end: d }); touch(); render(); });
    q("#ve-trans").addEventListener("change", (e) => { p.transition.kind = e.target.value; touch(); });
    q("#ve-transs").addEventListener("change", (e) => { p.transition.seconds = secs(e.target.value) || 0.5; touch(); });
    q("#ve-fin").addEventListener("change", (e) => { p.fadeIn = secs(e.target.value); touch(); });
    q("#ve-fout").addEventListener("change", (e) => { p.fadeOut = secs(e.target.value); touch(); });

    q("#ve-vol").addEventListener("input", (e) => { q("#ve-volv").textContent = e.target.value + "%"; });
    q("#ve-vol").addEventListener("change", (e) => { p.audio.volume = Number(e.target.value); touch(); });
    q("#ve-mute").addEventListener("change", (e) => { p.audio.muted = e.target.checked; touch(); });
    card.querySelectorAll("[data-snd]").forEach((el) => el.addEventListener("change", () => { field(p.sounds[+el.dataset.snd], el.dataset.f, el); touch(); paintTimeline(); }));
    card.querySelectorAll("[data-sndnow]").forEach((b) => b.addEventListener("click", () => { p.sounds[+b.dataset.sndnow].start = playhead(); touch(); render(); }));
    card.querySelectorAll("[data-snddel]").forEach((b) => b.addEventListener("click", () => { p.sounds.splice(+b.dataset.snddel, 1); touch(); render(); }));
    fillSources();
    q("#ve-sndadd").addEventListener("click", () => {
      const sel = q("#ve-sndsrc");
      const opt = sel.selectedOptions[0];
      if (!sel.value) return setMsg("Pick a sound first.", true);
      const src = JSON.parse(sel.value);
      p.sounds.push({ label: opt.textContent.slice(0, 80), src, start: 0, from: 0, length: 0, volume: 100, fadeIn: 0, fadeOut: 0 });
      touch(); render();
    });
    q("#ve-sndfile").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const r = await api("/videoeditor/upload", { method: "POST", body: { name: file.name, kind: "sound", data: await b64(file) } });
        p.sounds.push({ label: file.name.slice(0, 80), src: r.src, start: 0, from: 0, length: 0, volume: 100, fadeIn: 0, fadeOut: 0 });
        touch(); render();
      } catch (er) { setMsg(er.message, true); }
    });

    card.querySelectorAll("[data-sub]").forEach((el) => el.addEventListener("change", () => { field(p.subtitles[+el.dataset.sub], el.dataset.f, el); touch(); paintTimeline(); }));
    card.querySelectorAll("[data-subnow]").forEach((b) => b.addEventListener("click", () => { const s = p.subtitles[+b.dataset.subnow]; const len = s.end - s.start; s.start = playhead(); s.end = secs(s.start + len); touch(); render(); }));
    card.querySelectorAll("[data-subdel]").forEach((b) => b.addEventListener("click", () => { p.subtitles.splice(+b.dataset.subdel, 1); touch(); render(); }));
    q("#ve-subadd").addEventListener("click", () => { const t = playhead(); p.subtitles.push({ start: t, end: secs(t + 2), text: "New subtitle" }); touch(); render(); });
    q("#ve-srtbtn").addEventListener("click", () => { q("#ve-srtbox").hidden = !q("#ve-srtbox").hidden; });
    const importSrt = async (mode) => {
      await save();
      try { p = await api(`/videoeditor/projects/${encodeURIComponent(p.id)}/srt`, { method: "POST", body: { text: q("#ve-srttext").value, mode } }); dirty = false; render(); setMsg("Subtitles added.", false); }
      catch (e) { setMsg(e.message, true); }
    };
    q("#ve-srtgo").addEventListener("click", () => importSrt("replace"));
    q("#ve-srtapp").addEventListener("click", () => importSrt("append"));
    q("#ve-srtget").addEventListener("click", async () => {
      await save();
      try { CC.downloadBlob(await CC.apiBlobUrl(`/videoeditor/projects/${encodeURIComponent(p.id)}/srt`), "subtitles.srt"); } catch (e) { setMsg(e.message, true); }
    });

    card.querySelectorAll("[data-ov]").forEach((el) => el.addEventListener("change", () => { const o = p.overlays[+el.dataset.ov]; field(o, el.dataset.f, el); if (["x", "y", "size"].includes(el.dataset.f)) o[el.dataset.f] = Math.round(Number(el.value)); touch(); paintTimeline(); }));
    card.querySelectorAll("[data-ovdel]").forEach((b) => b.addEventListener("click", () => { p.overlays.splice(+b.dataset.ovdel, 1); touch(); render(); }));
    q("#ve-ovadd").addEventListener("click", () => { const t = playhead(); p.overlays.push({ start: t, end: secs(t + 3), text: "Your text", x: 50, y: 12, size: 6, color: "#ffffff" }); touch(); render(); });

    q("#ve-prev").addEventListener("click", () => render1("preview"));
    q("#ve-exp").addEventListener("click", () => render1("export"));
    q("#ve-cancel").addEventListener("click", async () => { if (busy) { try { await api(`/videoeditor/jobs/${encodeURIComponent(busy.id)}/cancel`, { method: "POST", body: {} }); } catch (e) { setMsg(e.message, true); } } });
    if (busy) poll();
  }

  async function fillSources() {
    try {
      const items = (await api("/videoeditor/sources")).items || [];
      const sel = q("#ve-sndsrc");
      if (!sel) return;
      for (const it of items) {
        const o = document.createElement("option");
        o.value = JSON.stringify({ kind: "job", jobId: it.jobId, i: it.i });
        o.textContent = `${it.kind === "video" ? "Sound from video: " : "Sound: "}${it.label}`;
        sel.appendChild(o);
      }
    } catch {}
  }
  const b64 = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(",")[1] || ""); r.onerror = () => reject(new Error("Could not read that file.")); r.readAsDataURL(file); });

  async function openNew() {
    const box = q("#ve-new");
    box.hidden = !box.hidden;
    if (box.hidden) return;
    box.innerHTML = `<div class="ve-item"><div class="ve-row"><select id="ve-src" class="ve-grow" aria-label="Pick a finished video"><option value="">Pick a finished video...</option></select><button type="button" class="btn sm primary" id="ve-open">Start editing</button></div>
      <div class="ve-row"><label class="btn sm" for="ve-file">Or upload a video</label><input type="file" id="ve-file" accept="video/*,.mp4,.mov,.webm,.mkv,.m4v" hidden><span class="ve-help">Uploads up to 12 MB. Bigger videos: make them in Media first.</span></div></div>`;
    try {
      const items = ((await api("/videoeditor/sources")).items || []).filter((i) => i.kind === "video");
      const sel = q("#ve-src");
      for (const it of items) { const o = document.createElement("option"); o.value = JSON.stringify({ kind: "job", jobId: it.jobId, i: it.i, projectId: it.projectId }); o.textContent = it.label; sel.appendChild(o); }
      if (!items.length) sel.options[0].textContent = "No finished videos yet";
    } catch {}
    const create = async (body) => {
      try { const np = await api("/videoeditor/projects", { method: "POST", body }); await loadList(); await open(np.id); } catch (e) { setMsg(e.message, true); }
    };
    q("#ve-open").addEventListener("click", () => {
      const v = q("#ve-src").value;
      if (!v) return setMsg("Pick a video first.", true);
      const src = JSON.parse(v);
      create({ source: { kind: "job", jobId: src.jobId, i: src.i }, projectId: src.projectId });
    });
    q("#ve-file").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const up = await api("/videoeditor/upload", { method: "POST", body: { name: file.name, kind: "video", data: await b64(file) } });
        create({ source: up.src, name: file.name.replace(/\.[^.]+$/, "") });
      } catch (er) { setMsg(er.message, true); }
    });
  }

  async function render1(kind) {
    await save();
    try {
      const body = kind === "preview" ? { from: playhead(), length: 30 } : {};
      busy = await api(`/videoeditor/projects/${encodeURIComponent(p.id)}/${kind}`, { method: "POST", body });
      render();
    } catch (e) { setMsg(e.message, true); if (e.code === "busy") toast(e.message, true); }
  }
  function poll() {
    stopPoll();
    pollTimer = setTimeout(async () => {
      if (gone() || !busy) return;
      try {
        const j = await api(`/videoeditor/jobs/${encodeURIComponent(busy.id)}`);
        const prog = q("#ve-prog");
        if (j.state === "running") { busy = j; if (prog) prog.textContent = `Working... ${j.percent}%`; poll(); return; }
        const kind = j.kind;
        busy = null;
        if (j.state === "done") {
          p = await api(`/videoeditor/projects/${encodeURIComponent(p.id)}`); dirty = false;
          render();
          if (kind === "preview") { await loadSource("preview"); setMsg("Preview is ready.", false); }
          else { loadSource("source"); setMsg(`Saved a new video: ${j.name}. Your original was not changed.`, false); }
        } else { render(); loadSource("source"); setMsg(j.error || "That did not finish.", j.state === "error"); }
      } catch (e) { busy = null; render(); setMsg(e.message, true); }
    }, 700);
  }

  await loadList();
  if (lastOpen && projects.some((x) => x.id === lastOpen)) await open(lastOpen); else render();
}
CC.mountVideoEditor = mountVideoEditor;
