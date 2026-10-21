// One price list for the app, the upgrade dialog, the comparison table, and the docs.
// This file never calls Square and never charges.
//
// The planned monthly raise is one line: change PRICE_SET from "current" to "next".
// Yearly and lifetime are not derived from monthly, and that line does not change them.

export const PRICE_SET = "current";

export const MONTHLY_SETS = {
  current: { pro: 18.99, extreme: 29.99 },
  next: { pro: 24.99, extreme: 39.99 },
};

const monthly = MONTHLY_SETS[PRICE_SET];
if (!monthly) throw new Error(`Unknown PRICE_SET "${PRICE_SET}". Use "current" or "next".`);

export const PRO_MONTHLY = monthly.pro;
export const EXTREME_MONTHLY = monthly.extreme;

// Not monthly times 12. Editing PRICE_SET leaves these as they are.
export const PRO_YEARLY = 189;
export const EXTREME_YEARLY = 299;

// Lifetime is Pro for life. $349 for the first 100, $499 for the next 400, closed after 500.
// Extreme yearly stays $299. That number is not the founder price.
export const LIFETIME_EARLY_PRICE = 349;
export const LIFETIME_LATER_PRICE = 499;
export const LIFETIME_EARLY_SEATS = 100;
export const LIFETIME_CAP = 500;
export const LIFETIME_TIER = "pro";
export const LIFETIME_PLAN_ID = "founder-lifetime";

// Hide the spots-left counter until this many founders have bought.
export const FOUNDER_SPOTS_HIDDEN_UNTIL = 40;
export const FOUNDER_LIMITED_LINE = `Limited to the first ${LIFETIME_EARLY_SEATS} founders`;

// People already paying the live Square price stay there. The app does not edit that plan.
export const GRANDFATHER_PRO_MONTHLY = 15.99;
export const GRANDFATHER_PLAN_ID = "pro-monthly-1599";
export const GRANDFATHER_PAY_LINK = "https://square.link/u/dbU38mQC";

// Published Square pay pages. The app does not call Square. A click opens the page.
// Lifetime is the $349 page. It is not used for the later $499 price.
export const PRO_MONTHLY_PAY_LINK = "https://square.link/u/UrcjlAqi";
export const PRO_YEARLY_PAY_LINK = "https://square.link/u/8JlyJzxb";
export const EXTREME_MONTHLY_PAY_LINK = "https://square.link/u/u5FdCONv";
export const EXTREME_YEARLY_PAY_LINK = "https://square.link/u/LxwtyrCy";
export const LIFETIME_PAY_LINK = "https://square.link/u/nKrsGaj2";

export function moneyPlain(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export const proMonthlyLabel = `$${moneyPlain(PRO_MONTHLY)}/month`;
export const extremeMonthlyLabel = `$${moneyPlain(EXTREME_MONTHLY)}/month`;
export const proYearlyLabel = `$${moneyPlain(PRO_YEARLY)}/year`;
export const extremeYearlyLabel = `$${moneyPlain(EXTREME_YEARLY)}/year`;

export const PRO_MONTHLY_PLAN_ID = `pro-monthly-${Math.round(PRO_MONTHLY * 100)}`;
export const EXTREME_MONTHLY_PLAN_ID = `extreme-monthly-${Math.round(EXTREME_MONTHLY * 100)}`;
export const PRO_YEARLY_PLAN_ID = `pro-yearly-${Math.round(PRO_YEARLY)}`;
export const EXTREME_YEARLY_PLAN_ID = `extreme-yearly-${Math.round(EXTREME_YEARLY)}`;

export const LIFETIME_RULE = `$${moneyPlain(LIFETIME_EARLY_PRICE)} for the first ${LIFETIME_EARLY_SEATS}, then $${moneyPlain(LIFETIME_LATER_PRICE)}, then closed after ${LIFETIME_CAP}. Lifetime is Pro for life.`;

export const GRANDFATHER_NOTE = `If you already pay $${moneyPlain(GRANDFATHER_PRO_MONTHLY)} a month, that price stays. New Pro monthly is ${proMonthlyLabel}. This app does not change the old Square plan and does not charge.`;

// Square plan ids Chris creates by hand. Nothing here calls Square.
export const SQUARE_PLANS_TO_CREATE = [
  { id: PRO_MONTHLY_PLAN_ID, name: "Meldmind Pro monthly", amount: PRO_MONTHLY, cadence: "month", tier: "pro", payLink: PRO_MONTHLY_PAY_LINK },
  { id: PRO_YEARLY_PLAN_ID, name: "Meldmind Pro yearly", amount: PRO_YEARLY, cadence: "year", tier: "pro", payLink: PRO_YEARLY_PAY_LINK },
  { id: EXTREME_MONTHLY_PLAN_ID, name: "Meldmind Extreme monthly", amount: EXTREME_MONTHLY, cadence: "month", tier: "extreme", payLink: EXTREME_MONTHLY_PAY_LINK },
  { id: EXTREME_YEARLY_PLAN_ID, name: "Meldmind Extreme yearly", amount: EXTREME_YEARLY, cadence: "year", tier: "extreme", payLink: EXTREME_YEARLY_PAY_LINK },
  { id: LIFETIME_PLAN_ID, name: "Meldmind Lifetime founder", amount: LIFETIME_EARLY_PRICE, laterAmount: LIFETIME_LATER_PRICE, cadence: "once", tier: LIFETIME_TIER, earlySeats: LIFETIME_EARLY_SEATS, cap: LIFETIME_CAP, payLink: LIFETIME_PAY_LINK },
];

export function spotsLeftPhrase(left, { ofFounders = false } = {}) {
  const n = Math.max(0, Math.floor(Number(left) || 0));
  if (ofFounders) return n === 1 ? `1 of ${LIFETIME_EARLY_SEATS} founder spots left` : `${n} of ${LIFETIME_EARLY_SEATS} founder spots left`;
  return n === 1 ? "1 spot left" : `${n} spots left`;
}
