// "Use Meldmind inside your other AI tools" (0.4.21). Shows the exact lines to copy into Claude Code, Codex,
// Gemini CLI or Claude desktop. Nothing is written for the person, so nothing in their other tools changes
// until they paste it. Meldmind keeps the spending limit, the council and MindMedia.
const { api, toast, esc } = window.CC;

async function render(el) {
  el.innerHTML = `<div class="panel" id="mcp-clients"><h3>Use Meldmind inside your other AI tools</h3><div class="dim small">Looking...</div></div>`;
  let d;
  try { d = await api("/bridge/clients"); } catch (e) { el.querySelector(".dim").textContent = e.message; return; }
  el.innerHTML = `<div class="panel" id="mcp-clients"><h3>Use Meldmind inside your other AI tools</h3>
    <p class="small">${esc(d.note)}</p>
    <label class="lbl" for="mcp-client-pick">Which tool?</label>
    <select id="mcp-client-pick">${d.clients.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select>
    <p class="small" id="mcp-client-where"></p>
    <textarea id="mcp-client-text" readonly rows="6" style="width:100%;font-family:var(--mono, monospace)" aria-label="Setup lines"></textarea>
    <div class="row" style="margin-top:6px"><button type="button" class="btn sm primary" id="mcp-client-copy">Copy</button></div></div>`;
  const pick = el.querySelector("#mcp-client-pick");
  const show = () => {
    const c = d.clients.find((x) => x.id === pick.value) || d.clients[0];
    el.querySelector("#mcp-client-where").textContent = c.where;
    el.querySelector("#mcp-client-text").value = c.text;
  };
  pick.addEventListener("change", show);
  show();
  el.querySelector("#mcp-client-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(el.querySelector("#mcp-client-text").value); toast("Copied. Paste it into that tool."); } catch { el.querySelector("#mcp-client-text").select(); toast("Press Ctrl+C to copy.", true); }
  });
}

window.CC.register({ id: "mcp-clients", settings: { order: 49, render } });
