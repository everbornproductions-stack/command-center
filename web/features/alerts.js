// Spend caps + alerts: caps per AI, cap state in Command, push/email preferences in Settings.
const { S, api, toast, esc, money, pname, pcolor } = window.CC;

const urlB64ToU8 = (s) => { const pad = "=".repeat((4 - (s.length % 4)) % 4); const b = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };

async function enablePush(st) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Push is not supported in this browser");
  const perm = await Notification.requestPermission(); if (perm !== "granted") throw new Error("Notifications were not allowed");
  const reg = await navigator.serviceWorker.register("/features/alerts-sw.js", { scope: "/features/" });
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToU8(st.vapidPublicKey) });
  await api("/alerts/subscribe", { method: "POST", body: sub.toJSON() });
}

CC.register({
  id: "alerts",
  command: { order: 40, async render(el) {
    let st; try { st = await api("/alerts/state"); } catch { el.innerHTML = ""; return; }
    const rows = Object.entries(st.perProvider || {});
    if (!rows.length) { el.innerHTML = `<div class="dim small" style="margin-top:6px">No spend caps set. Settings → Spend caps.</div>`; return; }
    el.innerHTML = `<div class="route" style="margin-top:8px"><div class="small muted" style="margin-bottom:4px">Monthly caps</div>${rows.map(([pid, r]) => `<div class="row small" style="gap:8px;padding:2px 0"><span class="dot" style="background:${pcolor(pid)}"></span><span style="width:90px">${esc(pname(pid))}</span><div style="flex:1;height:4px;background:#1a2333;border-radius:3px"><i style="display:block;height:100%;width:${Math.min(100, r.pct)}%;background:${r.level === "stop" ? "var(--red)" : r.level === "amber" ? "var(--amber)" : "var(--green)"}"></i></div><span class="mono dim">${money(r.spend)} / ${money(r.cap, 0)}</span>${r.level !== "ok" ? `<span class="chip ${r.level === "stop" ? "red" : "amber"}">${r.level === "stop" ? "stopped" : "80%"}</span>` : ""}</div>`).join("")}</div>`;
  } },
  settings: { order: 30, async render(el) {
    let st; try { st = await api("/alerts/state"); } catch (e) { el.innerHTML = `<div class="panel"><h3>Spend caps &amp; alerts</h3><div class="dim small">${esc(e.message)}</div></div>`; return; }
    const textP = S.providers.filter((p) => p.kind === "text");
    el.innerHTML = `<div class="panel"><h3>Spend caps &amp; alerts <span class="right">amber at 80% · hard stop at 100%</span></h3>
      <div class="grid" style="grid-template-columns:repeat(3,1fr);gap:8px">${textP.map((p) => `<label class="row small" style="gap:6px"><span class="dot" style="background:${p.color}"></span><span style="width:84px">${esc(p.name)}</span><span class="dim">$</span><input type="number" min="0" step="1" data-cap="${p.id}" value="${st.caps?.[p.id] ?? ""}" placeholder="no cap" style="width:80px;padding:4px 6px"></label>`).join("")}</div>
      <div class="row" style="margin-top:10px"><button class="btn sm primary" id="al-save">Save caps</button><span class="dim small">Caps also stop the router from sending that AI new work at 100%.</span></div>
      <div class="cat-h" style="margin-top:14px">Where alerts go</div>
      <div class="row"><label class="row small" style="gap:6px"><input type="checkbox" id="al-push" ${st.prefs?.pushOn ? "checked" : ""}> Push to this device</label><button class="btn sm" id="al-enable">Enable push here</button><span class="dim small">${st.pushDevices} device${st.pushDevices === 1 ? "" : "s"} registered</span></div>
      <div class="row" style="margin-top:8px"><label class="row small" style="gap:6px"><input type="checkbox" id="al-emailon" ${st.prefs?.emailOn ? "checked" : ""}> Email</label><input type="text" id="al-email" placeholder="you@example.com" value="${esc(st.prefs?.email || "")}" style="width:260px"><span class="dim small">needs a Resend key saved as provider "resend" (Settings → paste in the field below)</span></div>
      <div class="row" style="margin-top:8px"><input type="password" id="al-resend" placeholder="Resend API key (re_…)" style="width:260px"><button class="btn sm" id="al-resend-save">Save key</button><button class="btn sm" id="al-test" style="margin-left:auto">Send test alert</button><button class="btn sm" id="al-sweep">Check renewals now</button></div>
    </div>`;
    el.querySelector("#al-save").addEventListener("click", async () => { const caps = {}; el.querySelectorAll("[data-cap]").forEach((i) => { if (i.value !== "") caps[i.dataset.cap] = Number(i.value); }); try { await api("/alerts/caps", { method: "POST", body: { caps } }); toast("Caps saved"); } catch (e) { toast(e.message, true); } });
    const prefs = async () => { try { await api("/alerts/prefs", { method: "POST", body: { pushOn: el.querySelector("#al-push").checked, emailOn: el.querySelector("#al-emailon").checked, email: el.querySelector("#al-email").value } }); toast("Alert preferences saved"); } catch (e) { toast(e.message, true); } };
    el.querySelector("#al-push").addEventListener("change", prefs); el.querySelector("#al-emailon").addEventListener("change", prefs); el.querySelector("#al-email").addEventListener("change", prefs);
    el.querySelector("#al-enable").addEventListener("click", async () => { try { await enablePush(st); toast("Push enabled on this device"); } catch (e) { toast(e.message, true); } });
    el.querySelector("#al-resend-save").addEventListener("click", async () => { const k = el.querySelector("#al-resend").value.trim(); if (!k) return; try { await api("/keys", { method: "POST", body: { provider: "resend", key: k } }); toast("Resend key saved"); } catch (e) { toast(e.message, true); } });
    el.querySelector("#al-test").addEventListener("click", async () => { try { await api("/alerts/test", { method: "POST" }); toast("Test alert sent"); } catch (e) { toast(e.message, true); } });
    el.querySelector("#al-sweep").addEventListener("click", async () => { try { await api("/alerts/sweep", { method: "POST" }); toast("Renewals checked"); } catch (e) { toast(e.message, true); } });
  } },
});
