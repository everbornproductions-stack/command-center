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
    const plans = apps.plans || [];
    if (!using && !waiting.length && !plans.length) { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="route" style="margin-top:8px">
      ${using ? `<div class="row" style="gap:8px;align-items:center"><b>${esc(using.text)}</b><button class="btn sm" id="sc-stop" type="button">Stop</button></div>` : ""}
      ${plans.map((pl) => `<div class="small" style="margin-top:6px" data-plan-box="${esc(pl.id)}"><b>${esc(pl.app)} will press these controls, in this order, only after you click Press these:</b><ol style="margin:4px 0 4px 18px;padding:0">${pl.actions.map((a) => `<li>${esc(a.name)}${a.risky ? ` <span class="chip amber">this will ${esc(a.risky)}</span>` : ""}</li>`).join("")}</ol><div class="row" style="gap:8px"><button class="btn sm primary" data-plan-go="${esc(pl.id)}" type="button">Press these</button><button class="btn sm" data-plan-no="${esc(pl.id)}" type="button">Cancel</button><span class="dim">Nothing has been pressed yet. Stop halts it between controls.</span></div></div>`).join("")}
      ${waiting.map((item) => `<div class="row small" style="gap:8px;margin-top:6px"><span>Approve before it goes out: ${esc(item.action)}${item.amount != null ? ` (${money(item.amount)})` : ""}</span><button class="btn sm primary" data-yes="1" data-id="${esc(item.id)}" type="button">Approve</button><button class="btn sm" data-yes="0" data-id="${esc(item.id)}" type="button">Decline</button></div>`).join("")}
    </div>`;
    el.querySelector("#sc-stop")?.addEventListener("click", async () => {
      try { await api("/control-apps/stop", { method: "POST", body: { id: using.id } }); toast("Stopped."); el.innerHTML = ""; }
      catch (e) { toast(e.message); }
    });
    el.querySelectorAll("[data-plan-go]").forEach((btn) => btn.addEventListener("click", async () => {
      try {
        const r = await api(`/control-apps/plans/${encodeURIComponent(btn.dataset.planGo)}/confirm`, { method: "POST" });
        toast(r.status === "done" ? "Done. Only the listed controls were pressed." : r.status === "stopped" ? "Stopped." : (r.reason || r.status));
        renderCommandBox(el);
      } catch (e) { toast(e.message); }
    }));
    el.querySelectorAll("[data-plan-no]").forEach((btn) => btn.addEventListener("click", async () => {
      try { await api(`/control-apps/plans/${encodeURIComponent(btn.dataset.planNo)}/cancel`, { method: "POST" }); toast("Cancelled. Nothing was pressed."); renderCommandBox(el); }
      catch (e) { toast(e.message); }
    }));
    el.querySelectorAll("[data-id]").forEach((btn) => btn.addEventListener("click", async () => {
      try {
        await api("/phone-approvals/decide", { method: "POST", body: { id: btn.dataset.id, yes: btn.dataset.yes === "1", from: "pc" } });
        toast(btn.dataset.yes === "1" ? "Approved." : "Declined. Nothing was sent.");
        btn.closest(".row")?.remove();
      } catch (e) { toast(e.message); }
    }));
  } },
  // a planned list of controls shows up in Command as soon as a step makes it
  onEvent(ev) {
    if (ev.type === "control.plan") renderCommandBox(document.querySelector('#cmd-extras [data-feature="smarter-control"]'));
  },
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
      ${panel("Apps", `<div class="dim small">Add an app, then Allow it. A draft stays out of missions. Revoke hides it. Passwords are never stored. A banner says Meldmind is using the app, and Stop halts the next step.</div>
        <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap">
          <input id="sc-name" placeholder="App name" maxlength="40">
          <select id="sc-kind">${KINDS.map(([id, label]) => `<option value="${id}">${label}</option>`).join("")}</select>
          <select id="sc-cap">${CAPS.map(([id, label]) => `<option value="${id}">${label}</option>`).join("")}</select>
          <button class="btn sm" id="sc-add" type="button">Add app</button>
        </div>
        <label class="small" style="display:flex;gap:8px;align-items:center;margin-top:8px"><input id="sc-signed" type="checkbox"> Use my signed-in Edge or Chrome profile</label>
        <select id="sc-browser" disabled style="margin-top:6px"><option value="edge">Edge</option><option value="chrome">Chrome</option></select>
        <div class="dim small" style="margin-top:6px">This uses the cookies in that browser profile. Site terms may limit automation. The profile is not uploaded. Leave this off and Meldmind uses a profile it owns. Send, buy, and delete still wait for a yes.</div>
        ${appRows || `<div class="dim small" style="margin-top:8px">No apps yet.</div>`}
        ${apps.using ? `<div class="row" style="gap:8px;margin-top:8px"><b>${esc(apps.using.text)}</b><button class="btn sm" id="sc-stop2" type="button">Stop</button></div>` : ""}`)}
      ${panel("Recipes", `<div class="dim small">Record a task once, then run it again on a schedule. A send, buy, or delete still waits for a yes. Unlimited on Extreme.</div>${recipeRows || `<div class="dim small" style="margin-top:8px">No recipes yet.</div>`}`)}
      ${panel("Monthly budget", `<div class="small">${esc(guard.plain)}</div><div class="small" style="margin-top:6px">${esc(guard.savedPlain)}</div><div class="dim small">The top bar still shows You saved this month. That figure is an estimate.</div>
        <div class="row" style="gap:8px;margin-top:8px"><input id="sc-cap-usd" type="number" min="0.01" step="0.01" placeholder="Monthly cap" value="${guard.cap || ""}"><button class="btn sm" id="sc-budget" type="button">${guard.included ? "Save cap" : guard.optedIn ? "Save cap" : "Turn on budget cap"}</button><button class="btn sm" id="sc-budget-test" type="button" title="A practice check. Nothing is spent and no AI is called.">Test my budget</button></div><div class="small" id="sc-budget-out" role="status" aria-live="polite" style="margin-top:6px"></div>`)}
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
    el.querySelector("#sc-signed")?.addEventListener("change", () => {
      const box = el.querySelector("#sc-browser");
      if (box) box.disabled = !el.querySelector("#sc-signed").checked;
    });
    el.querySelector("#sc-add")?.addEventListener("click", async () => {
      const name = el.querySelector("#sc-name").value.trim();
      const signedIn = !!el.querySelector("#sc-signed")?.checked;
      try {
        await api("/control-apps/apps", { method: "POST", body: {
          name,
          kind: el.querySelector("#sc-kind").value,
          capabilities: [el.querySelector("#sc-cap").value],
          signedIn,
          profile: signedIn ? el.querySelector("#sc-browser").value : "owned",
        } });
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
    el.querySelector("#sc-budget-test")?.addEventListener("click", async () => {
      try { const r = await api("/cost-guard/test", { method: "POST", body: {} }); el.querySelector("#sc-budget-out").textContent = r.plain; } catch (e) { toast(e.message); }
    });
    el.querySelector("#sc-budget")?.addEventListener("click", async () => {
      const cap = Number(el.querySelector("#sc-cap-usd").value);
      try {
        const g = await api("/cost-guard", { method: "POST", body: { on: true, cap } });
        window.CC.S.guardCap = g.cap;
        window.CC.renderBudget?.();
        toast(`Monthly budget saved: $${Number(g.cap).toFixed(2)}.`);
        render(el);
      } catch (e) { toast(e.message); }
    });
  } },
});

function renderCommandBox(el) {
  const feature = window.CC.features.find((item) => item.id === "smarter-control");
  if (el && feature?.command) feature.command.render(el);
}
async function render(el) {
  const feature = window.CC.features.find((item) => item.id === "smarter-control");
  if (feature?.settings) await feature.settings.render(el);
}
