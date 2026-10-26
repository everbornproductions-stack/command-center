// 0.4.21: the one Owner checklist. Everything only Chris can do on Everborn's side so that paying on
// the website unlocks the app, and so that cloud features work on two computers. The same list is in
// docs/RELEASING.md (a test keeps the two in step). Items the app can see for itself tick on their
// own; the rest are ticked by hand. Nothing here runs SQL or touches Stripe, Google or Azure.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { doc, putDoc } from "./store.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOC = "owner.checklist";
export const LICENCE_DEADLINE = "2026-12-31";

function licencePubkeySet() {
  try { return !!String(JSON.parse(fs.readFileSync(path.join(HERE, "license-pubkey.json"), "utf8"))?.publicKey || "").trim(); } catch { return false; }
}

export const ITEMS = [
  { id: "unlock-sql", title: "Run the unlock SQL", how: "In the Supabase SQL editor, run supabase/migrations/20261026_stripe_unlock_proof.sql. Without it a paid buyer stays on Free." },
  { id: "auth-providers", title: "Turn on Google and Azure sign-in in Supabase", how: "Supabase > Authentication > Providers: switch on Google and Azure with Everborn's own client id and secret. This is how the app proves a buyer's email." },
  { id: "stripe-read-key", title: "Set STRIPE_READ_KEY", how: "Make a restricted Stripe key that can only read Checkout Sessions and save it as the function secret STRIPE_READ_KEY on stripe-webhook." },
  { id: "price-tiers", title: "Fill in price-tiers.js", how: "Paste the seven Stripe price ids (and the lifetime product or Payment Link id) into the maps in supabase/functions/stripe-webhook/price-tiers.js, then deploy that function." },
  { id: "licence-key", title: "Set the license signing key (H10)", how: `Put the license server's Ed25519 public key in server/license-pubkey.json (publicKey) and ship a build before ${LICENCE_DEADLINE}. After that date installs from before the seal drop to Free.`, auto: licencePubkeySet, deadline: LICENCE_DEADLINE },
  { id: "free-posting-sql", title: "Run the free Community posting SQL", how: "Run supabase/community.sql, then supabase/community_free_posting.sql, so free accounts can post." },
  { id: "hub-sql", title: "Run the report-back and Teams SQL", how: "Run supabase/hub_reportback_teams.sql. After that, report-back and Teams work across two computers." },
  { id: "catalog-sql", title: "Run the Marketplace catalog SQL and publish free items", how: "Run supabase/marketplace_catalog.sql, then add free rows to market_listings. Set a catalog signing key (server/catalog-pubkey.json) when you want rows checked." },
  { id: "google-consent", title: "Finish the Google consent screen", how: "Add test users, declare the gmail, drive and calendar scopes, finish Branding, publish, then go through Google verification. Then set \"consent\" to \"live\" in server/oauth-clients.json." },
  { id: "billing-go-live", title: "Billing go-live (needs Chris's OK)", how: "Nothing is switched to live billing by a build. Chris approves this one himself." },
];

export function checklist() {
  const saved = doc(DOC, () => ({ done: {} })).done || {};
  const now = Date.now();
  return ITEMS.map((it) => {
    const auto = it.auto ? !!it.auto() : false;
    const done = auto || !!saved[it.id];
    const out = { id: it.id, title: it.title, how: it.how, done, auto };
    if (it.deadline) out.daysLeft = Math.ceil((Date.parse(it.deadline + "T23:59:59Z") - now) / 86400000);
    return out;
  });
}

export function mark(id, done) {
  if (!ITEMS.some((i) => i.id === id)) { const e = new Error("No such item."); e.status = 404; throw e; }
  const d = doc(DOC, () => ({ done: {} }));
  d.done = { ...(d.done || {}), [id]: !!done };
  putDoc(DOC, d);
  return checklist();
}
