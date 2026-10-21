// Smarter control: routing changes you can undo, app cards, recipes, the monthly budget, and phone approvals.
const { api, toast, esc, money } = window.CC;

const KINDS = [["website", "Website"], ["desktop", "Windows app"], ["mcp", "MCP"]];
const CAPS = [["analysis", "Analysis"], ["research", "Research"], ["code", "Code"], ["fast", "Quick jobs"]];

function panel(title, body) {
  return `<div class="panel"><h3>${title}</h3>${body}</div>`;
}

CC.register({
  id: "smarter-control",
  command: { order: 46, async render(el) {
    let apps, phone;
    try {
      [apps, phone] = await Promise.all([api("/control-apps"), api("/phone-approvals")]);
    } catch { el.innerHTML = ""; return; }
    const using = apps.using;
    const waiting = phone.pending || [];
    if (!using && !waiting.length) { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="route" style="margin-top:8px">
      ${using ? `<div class="row" style="gap:8px;align-items:center"><b>${esc(using.text)}</b><button class="btn sm" id="sc-stop" type="button">Stop</button></div>` : ""}
      ${waiting.map((item) => `<div class="row small" style="gap:8px;margin-top:6px"><span>Approve before it goes out: ${esc(item.action)}${item.amount != null ? ` (${money(item.amount)})` : ""}</span><button class="btn sm primary" data-yes="1" data-id="${esc(item.id)}" type="button">Approve</button><button class="btn sm" data-yes="0" data-id="${esc(item.id)}" type="button">Decline</button></div>`).join("")}
    </div>`;
    el.querySelector("#sc-stop")?.addEventListener("click", async () => {
      try { await api("/control-apps/stop", { method: "POST", body: { id: using.id } }); toast("Stopped."); el.innerHTML = ""; }
      catch (e) { toast(e.message); }
    });
    el.querySelectorAll("[data-id]").forEach((btn) => btn.addEventListener("click", async () => {
      try {
        await api("/phone-approvals/decide", { method: "POST", body: { id: btn.dataset.id, yes: btn.dataset.yes === "1", from: "pc" } });
        toast(btn.dataset.yes === "1" ? "Approved." : "Declined. Nothing was sent.");
        btn.closest(".row")?.remove();
      } catch (e) { toast(e.message); }
    }));
  } },
  settings: { order: 44, async render(el) {
    el.innerHTML = `<div class="grid">${panel("Routing", `<div class="dim small">Loading…</div>`)}</div>`;
    let tune, apps, guard, phone, recipes;
    try {
      [tune, apps, guard, phone, recipes] = await Promise.all([
        api("/learn-tune"), api("/control-apps"), api("/cost-guard"), api("/phone-approvals"), api("/recipes"),
      ]);
    } catch (e) {
      el.innerHTML = panel("Smarter control", `<div class="dim small">${esc(e.message)}</div>`);
      return;
    }
    const appRows = (apps.apps || []).map((app) => `<div class="row small" style="gap:8px;margin-top:6px"><b>${esc(app.name)}</b><span class="dim">${esc(app.kind)}</span><span class="chip">${esc(app.status)}</span>${app.allowed ? `<button class="btn sm" data-revoke="${esc(app.id)}" type="button">Revoke</button>` : `<button class="btn sm" data-allow="${esc(app.id)}" type="button">Allow</button>`}</div>`).join("");
    const recipeRows = (recipes.recipes || []).map((recipe) => `<div class="small" style="margin-top:6px"><b>${esc(recipe.name)}</b> <span class="dim">${esc(recipe.lastPlain || "")}</span></div>`).join("");
    el.innerHTML = `<div class="grid">
      ${panel("Routing", `<div class="small">${esc(tune.plain)}</div>${tune.canUndo ? `<button class="btn sm" id="sc-undo" type="button" style="margin-top:8px">Undo</button>` : ""}`)}
      ${panel("Apps", `<div class="dim small">Add an app, then Allow it. A draft stays out of missions. Revoke hides it. Passwords are never stored.</div>
        <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap">
          <input id="sc-name" placeholder="App name" maxlength="40">
          <select id="sc-kind">${KINDS.map(([id, label]) => `<option value="${id}">${label}</option>`).join("")}</select>
          <select id="sc-cap">${CAPS.map(([id, label]) => `<option value="${id}">${label}</option>`).join("")}</select>
          <button class="btn sm" id="sc-add" type="button">Add app</button>
        </div>
        ${appRows || `<div class="dim small" style="margin-top:8px">No apps yet.</div>`}
        ${apps.using ? `<div class="row" style="gap:8px;margin-top:8px"><b>${esc(apps.using.text)}</b><button class="btn sm" id="sc-stop2" type="button">Stop</button></div>` : ""}`)}
      ${panel("Recipes", `<div class="dim small">Record a task once, then run it again on a schedule. A send, buy, or delete still waits for a yes. Unlimited on Extreme.</div>${recipeRows || `<div class="dim small" style="margin-top:8px">No recipes yet.</div>`}`)}
      ${panel("Monthly budget", `<div class="small">${esc(guard.plain)}</div><div class="small" style="margin-top:6px">${esc(guard.savedPlain)}</div><div class="dim small">The top bar still shows You saved this month. That figure is an estimate.</div>
        <div class="row" style="gap:8px;margin-top:8px"><input id="sc-cap-usd" type="number" min="1" step="1" placeholder="Monthly cap" value="${guard.cap || ""}"><button class="btn sm" id="sc-budget" type="button">${guard.included ? "Save cap" : guard.optedIn ? "Save cap" : "Turn on budget cap"}</button></div>`)}
      ${panel("Phone approvals", `<div class="small">${esc(phone.note)}</div>${(phone.pending || []).map((item) => `<div class="small" style="margin-top:6px">${esc(item.action)}</div>`).join("") || `<div class="dim small" style="margin-top:6px">Nothing is waiting.</div>`}`)}
    </div>`;
    const save = document.querySelector("#s-save");
    if (save && !save.dataset.scHook) {
      save.dataset.scHook = "1";
      save.addEventListener("click", () => {
        setTimeout(() => {
          const box = document.querySelector("[data-feature='smarter-control']");
          if (box) render(box);
        }, 400);
      });
    }
    el.querySelector("#sc-undo")?.addEventListener("click", async () => {
      try {
        await api("/learn-tune/undo", { method: "POST", body: {} });
        toast("Routing change undone.");
        if (window.CC.refresh) await window.CC.refresh();
        else render(el);
      } catch (e) { toast(e.message); }
    });
    el.querySelector("#sc-add")?.addEventListener("click", async () => {
      const name = el.querySelector("#sc-name").value.trim();
      try {
        await api("/control-apps/apps", { method: "POST", body: { name, kind: el.querySelector("#sc-kind").value, capabilities: [el.querySelector("#sc-cap").value] } });
        toast("App added. Allow it before Meldmind uses it.");
        render(el);
      } catch (e) { toast(e.message); }
    });
    el.querySelectorAll("[data-allow]").forEach((btn) => btn.addEventListener("click", async () => {
      try { await api("/control-apps/allow", { method: "POST", body: { id: btn.dataset.allow, allowed: true } }); render(el); }
      catch (e) { toast(e.message); }
    }));
    el.querySelectorAll("[data-revoke]").forEach((btn) => btn.addEventListener("click", async () => {
      try { await api("/control-apps/allow", { method: "POST", body: { id: btn.dataset.revoke, allowed: false } }); render(el); }
      catch (e) { toast(e.message); }
    }));
    el.querySelector("#sc-stop2")?.addEventListener("click", async () => {
      try { await api("/control-apps/stop", { method: "POST", body: { id: apps.using.id } }); render(el); }
      catch (e) { toast(e.message); }
    });
    el.querySelector("#sc-budget")?.addEventListener("click", async () => {
      const cap = Number(el.querySelector("#sc-cap-usd").value);
      try {
        await api("/cost-guard", { method: "POST", body: { on: true, cap } });
        toast("Monthly budget saved.");
        render(el);
      } catch (e) { toast(e.message); }
    });
  } },
});

async function render(el) {
  const feature = window.CC.features.find((item) => item.id === "smarter-control");
  if (feature?.settings) await feature.settings.render(el);
}
