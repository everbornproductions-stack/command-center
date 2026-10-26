// Growth (Phase 9): free trial counter and upgrade prompt, the "No keys needed" managed plan, referral rewards.
// All behind flags set by the host; with every flag off this feature shows nothing. Every amount is a placeholder.
import { planCompareHtml } from "/plan-compare.js";
const { S, api, toast, esc, money, ago, go, refresh } = window.CC;
let cache = null;

async function load(force = false) {
  if (!force && cache && Date.now() - cache.at < 15000) return cache.g;
  cache = { at: Date.now(), g: await api("/growth") };
  return cache.g;
}
const anyOn = (g) => g && (g.flags.trial || g.flags.managed || g.flags.referrals);
const PH = `<span class="chip amber" title="Chris decides real pricing">placeholder</span>`;

function upgradeBox(g) {
  if (!g.upgrade?.show) return "";
  const table = planCompareHtml(g.upgrade.compare);
  const spots = g.upgrade.spotsLine ? `<div class="dim small" data-founder-spots>${esc(g.upgrade.spotsLine)}</div>` : "";
  return `<div class="route upgrade-dialog" role="region" aria-label="Upgrade" style="margin-top:8px;border-left:3px solid var(--amber)"><div class="row small" style="gap:8px"><span style="flex:1">${esc(g.upgrade.text)}</span><button class="btn sm primary" data-g-upgrade>Upgrade to Pro</button></div>${table}${spots}<div class="dim small" style="margin-top:4px">Upgrading means adding a license key in Settings. Nothing is charged from here.</div></div>`;
}

function trialLine(g) {
  const t = g.trial;
  if (!t) return "";
  if (t.active) {
    const end = t.endsAt ? new Date(t.endsAt).toLocaleDateString() : "";
    return `<span class="chip green" id="cc-trial-chip">Free trial: ${t.daysLeft} day${t.daysLeft === 1 ? "" : "s"} left.${end ? ` Ends ${esc(end)}.` : ""}</span>`;
  }
  if (t.started) return `<span class="chip">Free trial ended</span>`;
  return "";
}

const block = {
  flag_off: "The managed plan is off on this install.",
  no_pool: "The managed key pool is not set up on this install.",
  not_on: "Off. Turn it on to use AIs without your own keys.",
  monthly_cap: "This month's managed limit is reached. It resets next month.",
  no_credits: "Your credits are used up. Upgrade to Pro or add your own API key.",
};

function settingsHtml(g) {
  const parts = [];
  if (g.trial) {
    const t = g.trial;
    parts.push(`<div class="route"><div class="row"><b>Free trial</b> ${PH} ${trialLine(g)}</div>
      <div class="small muted" style="margin-top:4px">${t.days} days of Pro (missions, the scheduler, unlimited councils and projects) and ${money(t.credits)} of credits for managed AIs. Once per install. Nothing is charged.</div>
      ${t.canStart ? `<div class="row" style="margin-top:8px"><button class="btn sm primary" data-g-trial>Start free trial</button></div>` : t.active ? `<div class="dim small" style="margin-top:6px">Ends ${esc(new Date(t.endsAt).toLocaleString())}.</div>` : t.started ? "" : `<div class="dim small" style="margin-top:6px">You already have a plan, so the trial is not needed.</div>`}</div>`);
  }
  if (g.managed) {
    const m = g.managed, u = m.usage || {};
    parts.push(`<div class="route" style="margin-top:8px"><div class="row"><b>No keys needed (managed plan)</b> ${PH}<label class="row small" style="margin-left:auto;gap:6px;cursor:pointer"><input type="checkbox" data-g-managed ${m.on ? "checked" : ""} ${m.providers.length ? "" : "disabled"}> use Everborn's managed AIs</label></div>
      <div class="small muted" style="margin-top:4px">AIs without your own key go through Everborn's key pool. Your own keys always come first. Usage is metered only: credits are used first, then usage is counted at cost plus ${g.placeholder.managedMarkupPct}% (placeholder). Nothing is charged.</div>
      <div class="small" style="margin-top:6px">${m.available ? `<span class="chip green">in use</span>` : `<span class="chip">${esc(block[m.block] || m.block)}</span>`} ${m.providers.map((p) => `<span class="chip">${esc(p.name)}${p.ownKey ? " (your key)" : ""}</span>`).join(" ")}</div>
      <div class="kpi" style="grid-template-columns:repeat(3,1fr);margin-top:8px">
        <div class="k"><div class="l">Managed calls ${esc(m.month)}</div><div class="v" style="font-size:18px">${u.calls || 0}</div><div class="s">${(u.inTok || 0) + (u.outTok || 0)} tokens</div></div>
        <div class="k"><div class="l">Usage at cost</div><div class="v" style="font-size:18px">${money(u.cost || 0, 4)}</div><div class="s">${money(u.fromCredits || 0, 4)} from credits · limit ${money(m.cap, 0)}/month</div></div>
        <div class="k"><div class="l">Would be billed</div><div class="v" style="font-size:18px">${money(m.wouldBill || 0, 4)}</div><div class="s">placeholder, not charged</div></div>
      </div></div>`);
  }
  if (g.referrals) {
    const r = g.referrals;
    const red = r.redeemed;
    parts.push(`<div class="route" style="margin-top:8px"><div class="row"><b>Referral rewards</b> ${PH}</div>
      <div class="small muted" style="margin-top:4px">A friend who joins with your code gets ${money(g.placeholder.referralFriendUsd)} of credits, and you get ${money(g.placeholder.referralRewardUsd)} once the license server confirms it. Copying the link sends nothing.</div>
      <div class="row" style="margin-top:8px;gap:8px"><span class="mono">${esc(r.code)}</span><input type="text" readonly value="${esc(r.link)}" style="flex:1" data-g-link><button class="btn sm" data-g-copy>Copy link</button></div>
      <div class="small" style="margin-top:6px">${r.stats ? `${r.stats.confirmed} friend${r.stats.confirmed === 1 ? "" : "s"} confirmed · ${r.stats.pending} pending` : r.server ? "Not checked yet." : "No license server is configured, so rewards cannot be confirmed."}${r.statsAt ? ` <span class="dim">· checked ${esc(ago(r.statsAt))}</span>` : ""}${r.statsError ? ` <span class="dim">· ${esc(r.statsError)}</span>` : ""} ${r.server ? `<button class="ghost small" data-g-refresh>Check now</button>` : ""}</div>
      ${red?.status === "confirmed" ? `<div class="small" style="margin-top:6px"><span class="chip green">used ${esc(red.code)}</span></div>` : `<div class="row" style="margin-top:8px;gap:8px"><input type="text" placeholder="A friend's code: REF-XXXXXXXX" data-g-code value="${esc(red?.code || "")}" style="flex:1;font-family:var(--mono)"><button class="btn sm" data-g-redeem>Use code</button></div>${red ? `<div class="dim small" style="margin-top:4px">${esc(red.code)}: ${esc(red.message || red.status)}</div>` : ""}`}</div>`);
  }
  const lines = g.credits.lines;
  parts.push(`<div class="route" style="margin-top:8px"><div class="row"><b>Credits</b><span class="right mono" style="margin-left:auto">${money(g.credits.balance, 4)} left</span></div>
    ${lines.length ? `<table class="tbl" style="margin-top:6px"><tbody>${lines.map((l) => `<tr><td class="small dim">${esc(new Date(l.ts).toLocaleDateString())}</td><td class="small">${esc(l.note || l.kind)}</td><td class="right mono" style="color:${l.amount < 0 ? "var(--muted)" : "var(--green)"}">${l.amount < 0 ? "" : "+"}${money(l.amount, 4)}</td></tr>`).join("")}</tbody></table>` : `<div class="dim small" style="margin-top:4px">No credits yet.</div>`}</div>`);
  return `<div class="panel" id="growth"><h3>Plan, trial and credits <span class="right">${esc(g.placeholder.note)}</span></h3>${upgradeBox(g)}${parts.join("")}</div>`;
}

function wire(el, rerender) {
  const act = async (fn, ok) => { try { const g = await fn(); cache = { at: Date.now(), g }; if (ok) toast(ok); await refresh?.(); rerender(); } catch (e) { toast(e.message, true); } };
  el.querySelector("[data-g-upgrade]")?.addEventListener("click", () => { go("settings"); setTimeout(() => document.getElementById("lic-key")?.focus(), 50); });
  el.querySelector("[data-g-trial]")?.addEventListener("click", () => act(() => api("/growth/trial/start", { method: "POST" }), "Free trial started"));
  el.querySelector("[data-g-managed]")?.addEventListener("change", (e) => act(() => api("/growth/managed", { method: "POST", body: { on: e.target.checked } }), e.target.checked ? "Managed plan on" : "Managed plan off"));
  el.querySelector("[data-g-copy]")?.addEventListener("click", async () => { const v = el.querySelector("[data-g-link]").value; try { await navigator.clipboard.writeText(v); toast("Referral link copied"); } catch { toast("Select the link and copy it", true); } });
  el.querySelector("[data-g-redeem]")?.addEventListener("click", () => act(() => api("/growth/referrals/redeem", { method: "POST", body: { code: el.querySelector("[data-g-code]").value } })));
  el.querySelector("[data-g-refresh]")?.addEventListener("click", () => act(() => api("/growth/referrals/refresh", { method: "POST" }), "Checked"));
}

// Command: the trial counter and, when needed, the upgrade prompt
async function renderCommand(el) {
  let g; try { g = await load(); } catch { el.innerHTML = ""; return; }
  if (!anyOn(g)) { el.innerHTML = ""; return; }
  const t = trialLine(g);
  const credits = g.flags.managed || g.flags.referrals || g.trial?.started ? `<span class="chip">${money(g.credits.balance, 2)} credits</span>` : "";
  el.innerHTML = (t || credits ? `<div class="row small" style="margin-top:6px;gap:6px">${t}${credits}</div>` : "") + upgradeBox(g);
  wire(el, () => renderCommand(el));
}
async function renderSettings(el) {
  let g; try { g = await load(); } catch { el.innerHTML = ""; return; }
  if (!anyOn(g)) { el.innerHTML = ""; return; }
  el.innerHTML = settingsHtml(g);
  wire(el, () => renderSettings(el));
}

CC.register({
  id: "growth",
  command: { order: 5, render: renderCommand },
  settings: { order: 2, render: renderSettings },
  onEvent(ev) { if (ev.type === "growth.update") cache = null; },
});
