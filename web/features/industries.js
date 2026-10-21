// Phase 62. Industry packs on the Prompts page. Filling orders does not send anything.
const { api, toast, esc, go } = window.CC;

function fieldsIn(text) {
  return [...new Set(String(text || "").match(/\{\{(\w+)\}\}/g) || [])].map((m) => m.slice(2, -2));
}

async function render(el) {
  if (!el) return;
  let data;
  try { data = await api("/industries"); }
  catch (e) { el.innerHTML = `<div class="panel"><h3>Industry packs</h3><div class="dim small">${esc(e.message)}</div></div>`; return; }
  const packs = data.packs || [];
  el.innerHTML = `<div class="panel"><h3>Industry packs <span class="right">${data.open ? esc(data.tier || "") : "Pro"}</span></h3>
    <p class="small" style="margin:6px 0 0">${esc(data.message || "Picking a prompt fills Marching orders. Nothing runs until you send it.")}</p>
    ${data.open ? "" : `<div class="small" style="margin-top:8px">These packs are part of Pro. Add a licence key in Settings.</div>`}
    ${packs.map((p) => `<div style="margin-top:12px"><b>${esc(p.name)}</b>${p.scf ? ` <span class="chip amber">SCF</span>` : ""}
      <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:6px">${(p.prompts || []).map((t) => `<button class="btn sm" type="button" data-ind="${esc(t.id)}" ${data.open ? "" : "disabled"}>${esc(t.name)}${t.outbound ? " (draft)" : ""}</button>`).join("")}</div>
    </div>`).join("")}
    <div id="ind-form"></div>
  </div>`;
  if (!data.open) return;
  const byId = {};
  for (const p of packs) for (const t of p.prompts || []) byId[t.id] = { ...t, pack: p.name, scf: p.scf };
  el.querySelectorAll("[data-ind]").forEach((btn) => btn.addEventListener("click", () => {
    const item = byId[btn.dataset.ind];
    const box = el.querySelector("#ind-form");
    if (!item || !box) return;
    const keys = fieldsIn(item.text);
    box.innerHTML = `<div style="margin-top:12px"><b>${esc(item.pack)}: ${esc(item.name)}</b>
      <div class="small dim" style="margin-top:4px">${item.outbound ? "This stays a draft. Nothing is sent until you send it yourself." : "This fills Marching orders. Nothing runs until you send it."}${item.scf ? " Credit repair keeps the SCF, CROA, and RESPA marks." : ""}</div>
      ${keys.map((k) => `<label class="small" style="display:block;margin-top:8px">${esc(k)}<input data-k="${esc(k)}" style="width:100%"></label>`).join("")}
      <div class="row" style="margin-top:10px"><button class="btn sm primary" type="button" id="ind-fill">Put in Marching orders</button></div>
    </div>`;
    box.querySelector("#ind-fill").addEventListener("click", async () => {
      const inputs = {};
      box.querySelectorAll("[data-k]").forEach((input) => { inputs[input.dataset.k] = input.value; });
      try {
        const filled = await api("/industries/fill", { method: "POST", body: { id: item.id, inputs } });
        const orders = document.getElementById("orders");
        if (orders) orders.value = filled.orders || "";
        window.CC.S.lastOrders = filled.orders || "";
        toast(filled.draft ? "Draft is in Marching orders. Nothing was sent." : "In Marching orders. Nothing runs until you send it.");
        go("command");
      } catch (e) { toast(e.message, true); }
    });
  }));
}

window.CC.mountIndustryPacks = render;
window.CC.register({ id: "industries" });
