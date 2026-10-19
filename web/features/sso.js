// Team SSO (Phase 24), hosted hub only. Settings > Team sign-in: how you signed in, and per workspace the rule
// "members sign in with Google or Microsoft, with an address on these domains" (owners and admins set it).
const { api, toast, esc } = window.CC;

const NAMES = { google: "Google", azure: "Microsoft" };
const how = (s) => (s?.sso ? `Google or Microsoft (${(s.providers || []).map((i) => `${NAMES[i.provider] || i.provider}${i.email ? ` ${i.email}` : ""}`).join(", ") || "single sign-on"})` : s?.method ? "an emailed sign-in link" : "unknown");

async function renderSettings(el) {
  if (window.CC.S.mode !== "hosted") { el.innerHTML = ""; return; }
  let me, ws;
  try { [me, ws] = await Promise.all([api("/sso"), api("/workspaces")]); } catch { el.innerHTML = ""; return; }
  const managed = [...(ws.owned || []), ...(ws.memberOf || [])].filter((w) => ["owner", "admin"].includes(w.role));
  const locked = [...(ws.memberOf || [])].filter((w) => w.locked);
  const rules = await Promise.all(managed.map((w) => api(`/sso/policy/${encodeURIComponent(w.id)}`).then((r) => ({ w, r })).catch(() => null)));
  el.innerHTML = `<div class="panel"><h3>Team sign-in <span class="right">${me.providers.length ? me.providers.map((p) => esc(p.name)).join(" and ") + " on" : "email link only"}</span></h3>
    <div class="small muted">You signed in with ${esc(how(me.session))}. ${me.providers.length ? "Teammates can sign in with their work Google or Microsoft account." : "Google and Microsoft sign-in can be turned on by the hub owner (CC_SSO_PROVIDERS, after enabling them in Supabase Auth)."}</div>
    ${locked.map((w) => `<div class="small" style="margin-top:6px;color:var(--amber)"><b>${esc(w.name)}</b>: ${esc(w.locked)}</div>`).join("")}
    ${rules.filter(Boolean).map(({ w, r }) => `<div class="cat-h" style="margin-top:12px">${esc(w.name)}</div>
      <div class="row small" style="gap:10px;flex-wrap:wrap" data-sso-ws="${esc(w.id)}">
        <label class="row" style="gap:6px"><input type="checkbox" data-k="required" ${r.policy.required ? "checked" : ""}> Members must sign in with</label>
        ${Object.entries(NAMES).map(([id, n]) => `<label class="row" style="gap:4px"><input type="checkbox" data-k="p" value="${id}" ${r.policy.providers.includes(id) ? "checked" : ""} ${me.providers.some((p) => p.id === id) ? "" : "disabled title=\"not turned on for this hub\""}> ${n}</label>`).join("")}
        <input type="text" data-k="domains" value="${esc(r.policy.domains.join(", "))}" placeholder="domains, e.g. example.com" style="width:220px">
        <button class="btn sm" data-sso-save>Save</button>
      </div>
      <div class="dim small">The owner is never locked out. Someone who does not meet the rule sees the workspace locked and cannot use its keys.</div>`).join("")}
  </div>`;
  el.querySelectorAll("[data-sso-save]").forEach((b) => b.addEventListener("click", async () => {
    const row = b.closest("[data-sso-ws]");
    const body = { required: row.querySelector('[data-k="required"]').checked, providers: [...row.querySelectorAll('[data-k="p"]:checked')].map((x) => x.value), domains: row.querySelector('[data-k="domains"]').value };
    try { await api(`/sso/policy/${encodeURIComponent(row.dataset.ssoWs)}`, { method: "POST", body }); toast(body.required ? "Sign-in rule on" : "Sign-in rule off"); renderSettings(el); } catch (e) { toast(e.message, true); }
  }));
}

window.CC.register({ id: "sso", settings: { order: 47, render: renderSettings } });
