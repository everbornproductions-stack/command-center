// Free, Pro, and Extreme stay three columns at desktop and at 390px.
// Prices and rows come from the server. This file does not call Stripe.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const COMPARE_MIN_WIDTH = 390;

// The table does not stack. 390px and a desktop window both show three columns.
export function compareColumnCount(width) {
  const w = Number(width);
  if (!Number.isFinite(w)) return 3;
  if (w >= COMPARE_MIN_WIDTH) return 3;
  return 3;
}

export function planCompareHtml(compare) {
  const cols = compare?.columns;
  if (!Array.isArray(cols) || cols.length < 3) return "";
  const rows = Array.isArray(compare.rows) ? compare.rows : [];
  const body = cols.slice(0, 3).map((col, i) => `<div class="plan-col" data-tier="${esc(col.id)}"><h4>${esc(col.name)}</h4><div class="plan-price">${esc(col.price)}</div>${rows.map((row) => `<div class="plan-row"><span>${esc(row.label)}</span><b>${esc(row.cells?.[i] ?? "")}</b></div>`).join("")}</div>`).join("");
  return `<div class="plan-compare" data-cols="3" data-min-width="${COMPARE_MIN_WIDTH}">${body}</div>`;
}

function planButton(plan, cls) {
  if (!plan) return "";
  const label = plan.button || plan.label || plan.name || "Plan";
  if (plan.payLink && plan.checkout !== false) {
    return `<a class="${cls}" href="${esc(plan.payLink)}" target="_blank" rel="noopener" data-upgrade-link="${esc(plan.id)}">${esc(label)}</a>`;
  }
  return `<button type="button" class="${cls}" data-pro-plan="${esc(plan.id)}">${esc(label)}</button>`;
}

// Buy buttons. Each opens a Stripe Payment Link, with the signed-in email prefilled by the server.
export function upgradeButtonsHtml({ plans, tier = "free", primary = false } = {}) {
  const p = plans || {};
  const parts = [];
  const main = primary ? "btn primary" : "btn";
  const rest = "btn";
  if (tier === "free") {
    parts.push(planButton(p.monthly, main));
    parts.push(planButton(p.yearly, rest));
    parts.push(planButton(p.extremeMonthly, rest));
    parts.push(planButton(p.extremeYearly, rest));
    parts.push(planButton(p.developerMonthly, rest));
    parts.push(planButton(p.developerYearly, rest));
    parts.push(planButton(p.lifetime, rest));
  } else if (tier === "pro") {
    parts.push(planButton(p.extremeMonthly, main));
    parts.push(planButton(p.extremeYearly, rest));
    parts.push(planButton(p.developerMonthly, rest));
    parts.push(planButton(p.developerYearly, rest));
  } else if (tier === "extreme" || tier === "studio") {
    parts.push(planButton(p.developerMonthly, main));
    parts.push(planButton(p.developerYearly, rest));
  }
  return parts.filter(Boolean).join("");
}

export function extremeExtrasHtml() {
  return `<div class="dim small" data-extreme-extras>Extreme includes early access (new features reach Extreme first, behind a flag), Max quality (the best model each connected AI offers, with more reasoning and a longer context, inside the budget cap), and team spaces for 5 people total, counting the owner (the owner plus 4 invited).</div>`;
}

export function founderSpotsHtml(plans) {
  const life = plans?.lifetime;
  if (!life) return "";
  return `<div class="dim small" data-founder-spots>${esc(life.spotsLine || "")}</div>${life.rule ? `<div class="dim small">${esc(life.rule)}</div>` : ""}`;
}
