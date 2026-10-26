// Shared MindMedia pieces (0.4.20), used by the hub, the Finish drawer and every "done" screen:
//   CC.resultCard({ what, detail, savedWhere, item, actions })  -> an element: what was made, where it went, what to do next
//   CC.publishPanel(box, { projectId, assetId, kind, title, text, onResult })  -> pick a place, preview, confirm
//   CC.mmStatusChip(status) -> html for one status chip (one vocabulary: Draft, Review, Approved, Published)
// Colours come from the theme variables only, so light and dark both work.
const { api, toast, esc } = window.CC;

export const STATUS_TONE = { Draft: "", Review: "amber", Approved: "green", Published: "violet" };

const CSS = `
.mm-card { display: flex; flex-direction: column; gap: 10px; padding: 16px; border: 1px solid var(--line-2); border-radius: var(--radius); background: var(--panel-solid); color: var(--text); }
.mm-card h4 { margin: 0; font-size: 1rem; }
.mm-card .mm-done { display: flex; gap: 10px; align-items: flex-start; }
.mm-card .mm-tick { flex: none; width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; border: 2px solid var(--green); color: var(--green); font-weight: 700; }
.mm-card .mm-where { color: var(--muted); font-size: .85rem; }
.mm-card .mm-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.mm-pub { display: flex; flex-direction: column; gap: 8px; }
.mm-pub .mm-ch { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--line-2); border-radius: 10px; background: var(--field-bg); color: var(--field-text); cursor: pointer; text-align: left; width: 100%; }
.mm-pub .mm-ch[aria-pressed="true"] { border-color: var(--accent); }
.mm-pub .mm-ch small { color: var(--muted); margin-left: auto; }
.mm-pub .mm-note { color: var(--muted); font-size: .85rem; }
.mm-pub .mm-warn { color: var(--amber); font-size: .85rem; }
.mm-pub textarea { min-height: 70px; }
.chip.violet { color: var(--violet); border-color: var(--violet); }
`;
if (!document.getElementById("mm-parts-css")) {
  const st = document.createElement("style");
  st.id = "mm-parts-css";
  st.textContent = CSS;
  document.head.appendChild(st);
}

export function statusChip(status) {
  return `<span class="chip ${STATUS_TONE[status] || ""}">${esc(status || "Draft")}</span>`;
}
window.CC.mmStatusChip = statusChip;

// The one "done" component. actions: [{ label, onClick, primary, title }]
window.CC.resultCard = function resultCard({ what = "Your result", detail = "", savedWhere = "", item = null, actions = [] } = {}) {
  const el = document.createElement("div");
  el.className = "mm-card";
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", `${what} is ready`);
  el.innerHTML = `<div class="mm-done"><span class="mm-tick" aria-hidden="true">&#10003;</span><div><h4>${esc(what)}</h4>${detail ? `<div class="mm-where">${esc(detail)}</div>` : ""}<div class="mm-where mm-saved">${esc(savedWhere || "Not saved yet.")}</div></div></div><div class="mm-actions"></div>`;
  const bar = el.querySelector(".mm-actions");
  const all = [...actions];
  if (item?.assetId || item?.id) all.push({ label: "Open in MindMedia", onClick: () => window.CC.openMindMedia?.(item.projectId, item.assetId || item.id) });
  for (const a of all) {
    if (!a || !a.label) continue;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn sm" + (a.primary ? " primary" : "");
    b.textContent = a.label;
    if (a.title) b.title = a.title;
    b.addEventListener("click", async () => { try { await a.onClick?.(b, el); } catch (e) { toast(e.message || "That did not work.", true); } });
    bar.appendChild(b);
  }
  return el;
};

// Places that fit this item, with a plain "Practice only" note when a place is not connected.
window.CC.publishPanel = async function publishPanel(box, opts = {}) {
  const { projectId = "", assetId = "", kind = "file", title = "", text = "", onResult } = opts;
  box.classList.add("mm-pub");
  box.innerHTML = `<div class="mm-note">Looking for places this can go...</div>`;
  let chans = [];
  try { chans = await api("/publish/channels"); } catch (e) { box.innerHTML = `<div class="mm-warn">${esc(e.message)}</div>`; return; }
  const fits = chans.filter((c) => !c.accepts || c.accepts.includes(kind));
  if (!fits.length) { box.innerHTML = `<div class="mm-note">No connected place takes a ${esc(kind)} yet. You can still download it.</div>`; return; }
  let channel = "", previewId = "";
  const nameOf = (c) => ({ drive: "Google Drive", ghl: "HighLevel", instagram: "Instagram", slack: "Slack" }[c.id] || c.name);
  box.innerHTML = `<div class="mm-note">Where should this go? Nothing is sent until you press the final button.</div>
    ${fits.map((c) => `<button type="button" class="mm-ch" data-ch="${esc(c.id)}" aria-pressed="false"><b>${esc(nameOf(c))}</b><small>${c.ready ? "Connected" : "Practice only, nothing is sent"}</small></button>`).join("")}
    <div class="mm-more" hidden>
      ${kind === "text" ? `<label class="lbl" for="mm-pub-text">Words to send</label><textarea id="mm-pub-text">${esc(text.slice(0, 2200))}</textarea>` : `<label class="lbl" for="mm-pub-text">Caption (optional)</label><textarea id="mm-pub-text">${esc(text.slice(0, 2200))}</textarea>`}
      <div class="row"><button type="button" class="btn sm" data-a="preview">Preview</button><button type="button" class="btn sm primary" data-a="go" disabled>Send</button></div>
      <div class="mm-out mm-note" role="status" aria-live="polite"></div>
    </div>`;
  const more = box.querySelector(".mm-more"), out = box.querySelector(".mm-out"), go = box.querySelector('[data-a="go"]');
  const bodyOf = () => ({ channel, title: title || "From MindMedia", text: box.querySelector("#mm-pub-text").value, mediaAssetId: assetId || undefined, mediaProjectId: projectId || undefined, projectId: projectId && projectId !== "unfiled" ? projectId : undefined });
  const stale = () => { previewId = ""; go.disabled = true; go.textContent = "Send"; };
  box.querySelector("#mm-pub-text").addEventListener("input", stale);
  box.querySelectorAll("[data-ch]").forEach((b) => b.addEventListener("click", () => {
    channel = b.dataset.ch;
    box.querySelectorAll("[data-ch]").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
    more.hidden = false; stale(); out.textContent = "";
  }));
  box.querySelector('[data-a="preview"]').addEventListener("click", async () => {
    if (!channel) return toast("Pick a place first.", true);
    try {
      const r = await api("/publish/preview", { method: "POST", body: bodyOf() });
      previewId = r.previewId;
      const probs = r.problems || [];
      out.innerHTML = `${esc(r.summary || "")}${probs.length ? `<div class="mm-warn">${probs.map(esc).join(" / ")}</div>` : ""}${r.dryRun ? `<div class="mm-note">Practice only, nothing is sent. This place is not connected, so Meldmind only records the practice run.</div>` : ""}`;
      go.textContent = r.dryRun ? "Practice run" : "Send now";
      go.disabled = probs.length > 0 && !r.dryRun;
    } catch (e) { stale(); out.innerHTML = `<span class="mm-warn">${esc(e.message)}</span>`; }
  });
  go.addEventListener("click", async () => {
    if (!previewId) return toast("Preview first.", true);
    go.disabled = true;
    try {
      const r = await api("/publish/post", { method: "POST", body: { channel, previewId, confirmed: true } });
      const msg = r.status === "posted" ? `Sent${/^https:\/\//.test(r.result?.url || "") ? `: ${r.result.url}` : "."}` : r.status === "dry-run" ? "Practice run recorded. Nothing was sent." : `Did not send: ${r.error}`;
      out.textContent = msg;
      toast(msg, r.status === "failed");
      onResult?.(r);
    } catch (e) { stale(); out.innerHTML = `<span class="mm-warn">${esc(e.message)}</span>`; }
  });
};
