// One price list for the app, the upgrade dialog, the comparison table, and the docs.
// This file never calls Stripe and never charges. A click opens a Stripe Payment Link in the browser.
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

// Published Stripe Payment Links (live mode, account "Everborn marketing"). The app does not call
// Stripe. A click opens the page. Lifetime is the $349 page. It is not used for the later $499 price.
export const PRO_MONTHLY_PAY_LINK = "https://buy.stripe.com/00wbIUdIrcBz8uP9ybgQE00";
export const PRO_YEARLY_PAY_LINK = "https://buy.stripe.com/dRm4gs0VF597bH1h0DgQE07";
export const EXTREME_MONTHLY_PAY_LINK = "https://buy.stripe.com/dRmdR20VF1WVdP9cKngQE03";
export const EXTREME_YEARLY_PAY_LINK = "https://buy.stripe.com/6oU7sEgUD5978uP7q3gQE04";
export const DEVELOPER_MONTHLY_PAY_LINK = "https://buy.stripe.com/9B6fZafQzgRPdP9dOrgQE05";
export const DEVELOPER_YEARLY_PAY_LINK = "https://buy.stripe.com/9B6dR2gUDeJH7qL7q3gQE06";
export const LIFETIME_PAY_LINK = "https://buy.stripe.com/5kQ7sE8o7bxvh1ldOrgQE02";

// Developer is $34.99 a month or $349 a year. It is not part of the planned monthly raise.
export const DEVELOPER_MONTHLY = 34.99;
export const DEVELOPER_YEARLY = 349;

// The link with the signed-in email prefilled, so the buyer does not retype it and the licence lands
// on the same email the app unlocks by. Anything that is not a Stripe https link, or an email that
// does not look like one, returns the link unchanged. The email is never logged.
const PAY_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function payLinkWithEmail(link, email) {
  if (typeof link !== "string" || !link.startsWith("https://buy.stripe.com/")) return link;
  const mail = String(email ?? "").trim();
  if (!mail || mail.length > 254 || !PAY_EMAIL_RE.test(mail)) return link;
  const u = new URL(link);
  u.searchParams.set("prefilled_email", mail);
  return u.toString();
}

export function moneyPlain(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export const proMonthlyLabel = `$${moneyPlain(PRO_MONTHLY)}/month`;
export const extremeMonthlyLabel = `$${moneyPlain(EXTREME_MONTHLY)}/month`;
export const developerMonthlyLabel = `$${moneyPlain(DEVELOPER_MONTHLY)}/month`;
export const developerYearlyLabel = `$${moneyPlain(DEVELOPER_YEARLY)}/year`;
export const proYearlyLabel = `$${moneyPlain(PRO_YEARLY)}/year`;
export const extremeYearlyLabel = `$${moneyPlain(EXTREME_YEARLY)}/year`;

export const PRO_MONTHLY_PLAN_ID = `pro-monthly-${Math.round(PRO_MONTHLY * 100)}`;
export const EXTREME_MONTHLY_PLAN_ID = `extreme-monthly-${Math.round(EXTREME_MONTHLY * 100)}`;
export const PRO_YEARLY_PLAN_ID = `pro-yearly-${Math.round(PRO_YEARLY)}`;
export const EXTREME_YEARLY_PLAN_ID = `extreme-yearly-${Math.round(EXTREME_YEARLY)}`;
export const DEVELOPER_MONTHLY_PLAN_ID = `developer-monthly-${Math.round(DEVELOPER_MONTHLY * 100)}`;
export const DEVELOPER_YEARLY_PLAN_ID = `developer-yearly-${Math.round(DEVELOPER_YEARLY)}`;

export const LIFETIME_RULE = `$${moneyPlain(LIFETIME_EARLY_PRICE)} for the first ${LIFETIME_EARLY_SEATS}, then $${moneyPlain(LIFETIME_LATER_PRICE)}, then closed after ${LIFETIME_CAP}. Lifetime is Pro for life.`;

export function spotsLeftPhrase(left, { ofFounders = false } = {}) {
  const n = Math.max(0, Math.floor(Number(left) || 0));
  if (ofFounders) return n === 1 ? `1 of ${LIFETIME_EARLY_SEATS} founder spots left` : `${n} of ${LIFETIME_EARLY_SEATS} founder spots left`;
  return n === 1 ? "1 spot left" : `${n} spots left`;
}
