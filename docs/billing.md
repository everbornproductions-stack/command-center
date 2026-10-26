# Billing (Stripe)

Payments run on Stripe (account "Everborn marketing", live mode). The app never calls Stripe and never charges a card. A click on Upgrade opens a Stripe Payment Link in the browser. Stripe collects the card and the buyer email, then sends a signed webhook to the `stripe-webhook` function on the licence server (Supabase). That function creates or updates the licence by email. The app unlocks by the signed-in email, so there is no key to type. The licence key box and promo codes still work as a fallback.

Prices in the app come from `server/price-config.js`. Yearly and lifetime are not derived from monthly. Changing `PRICE_SET` from `current` to `next` is the planned monthly raise (Pro $24.99, Extreme $39.99) and does not change yearly or lifetime.

## Plans and Stripe Payment Links

| Plan | Price | Plan id in the app | Payment Link |
|---|---|---|---|
| Pro monthly | $18.99 a month | `pro-monthly-1899` | https://buy.stripe.com/00wbIUdIrcBz8uP9ybgQE00 |
| Pro yearly | $189 a year | `pro-yearly-189` | https://buy.stripe.com/dRm4gs0VF597bH1h0DgQE07 |
| Extreme monthly | $29.99 a month | `extreme-monthly-2999` | https://buy.stripe.com/dRmdR20VF1WVdP9cKngQE03 |
| Extreme yearly | $299 a year | `extreme-yearly-299` | https://buy.stripe.com/6oU7sEgUD5978uP7q3gQE04 |
| Developer monthly | $34.99 a month | `developer-monthly-3499` | https://buy.stripe.com/9B6fZafQzgRPdP9dOrgQE05 |
| Developer yearly | $349 a year | `developer-yearly-349` | https://buy.stripe.com/9B6dR2gUDeJH7qL7q3gQE06 |
| Lifetime founder | $349 once (first 100), then $499 | `founder-lifetime` | https://buy.stripe.com/5kQ7sE8o7bxvh1ldOrgQE02 |

Every Upgrade button opens its link with `?prefilled_email=` set to the signed-in email (URL-encoded), when the app knows one. A duplicate Pro link exists in Stripe (9B65kwbAjdFDfXhfWzgQE01). The app does not use it.

Developer carries the Extreme limits in the app. Lifetime is Pro for life. It is not Extreme. The licence `plan` column holds `pro-monthly`, `pro-yearly`, `extreme-monthly`, `extreme-yearly`, `developer-monthly`, `developer-yearly`, `lifetime-349` or `lifetime-499`.

### Lifetime founder

| | |
|---|---|
| Early price | $349 for the first 100 |
| Later price | $499 for the next 400 |
| Cap | Closed after 500 total |
| Spots left | Hidden until 40 founders have bought (`FOUNDER_SPOTS_HIDDEN_UNTIL`, default 40). Before that the app says "Limited to the first 100 founders". After that it shows the spots left. |
| Checkout | The $349 Payment Link above. The later $499 price does not use it, so that button stays on the page until a $499 link is made. |
| 100 seats | The webhook logs a warning when the lifetime count reaches 100. Chris then changes the Payment Link price in Stripe. |

## How a payment unlocks the app

1. The buyer pays on the Payment Link. Stripe sends `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted` and `charge.refunded` to the `stripe-webhook` function.
2. The function checks the `Stripe-Signature` header (HMAC SHA256, 5 minute tolerance) with `STRIPE_WEBHOOK_SECRET`, ignores an event id it has seen (`stripe_events`), and creates or updates the `licenses` row for the buyer email. Upgrading Pro to Extreme changes the tier on the same licence. A cancel keeps access until the period ends. A full refund ends access now. No card data is stored.
3. In the app the buyer signs in with Google or Microsoft (the verified email). At sign-in the app swaps the provider's id_token for a licence-server session (`server/licence-session.js`, kept in the vault). It then asks the licence server for an active licence on that email (`activate_license_by_email`) with that session, and the server reads the confirmed email from the session, never from anything typed. No session, no lookup. It never gets the licence key from that call. One-time setup: in Supabase Authentication, turn on the Google and Azure providers and add the app's OAuth client ids.
4. After the buyer opens an Upgrade link, the app re-checks every few seconds for two minutes and whenever the window comes back into focus. The "I paid, check now" button re-checks at once.

The price-to-plan map is `supabase/functions/stripe-webhook/price-tiers.js`. A one-time payment is matched by its Checkout Session, never by the amount charged (a promo code or tax changes that): `meldmind_plan` metadata, then the Payment Link id, then the price or product id from the session's line items. Set `STRIPE_READ_KEY` (a restricted key that can only read Checkout Sessions) as a function secret so the function can read the line items; without it, a paid one-time session that carries no plan id is held for Stripe's retry and logged. Easiest: put `meldmind_plan` = `lifetime-349` (or `lifetime-499`) in the metadata of each Stripe price. Subscriptions use the price id, then metadata, then the price's list amount plus interval (the TODO list is at the top of that file).

Three public tiers, plus Developer. Nothing below is charged from the app. A click opens a Stripe checkout in the browser.

| Tier | Price | Included |
|---|---|---|
| Free | $0 | Bring your own keys. Single mode (best AI for the job), the learning router (picks stay on this computer), status strip with health lights, 3 projects, Credits ledger, 5 councils per month, 1 connected service, 1 email account per provider. No missions, no scheduler, no shared learning, no scores dashboard, no phone pairing, no full history search. A 14-day Pro trial can be started in the app. The trial is not started for you, and nothing is charged. |
| Pro | $18.99 / month, or $189 / year, or lifetime founder ($349 for the first 100, then $499, closed after 500). About 6 months later, monthly rises to $24.99. Yearly stays $189 until Chris sets a yearly change. | Everything in Free plus: every connected service, up to 8 email accounts per provider, Mission mode (plan, assign, QA, assemble), unlimited Council (4 AIs per council, 3 runs at once), the off-peak scheduler and discount rules, balance-aware routing, unlimited projects and link hubs, Subscriptions tracker with burn rate and runway, shared learning, the scores dashboard (Who's best at what), phone pairing, full history search, update channel, priority support, 1 industry pack, Deep Research 8 times a month, 3 desktop control apps, 5 recipes. A Studio licence is treated as Pro. There is no separate Studio price. |
| Extreme | $29.99 / month, or $299 / year. About 6 months later, monthly rises to $39.99. Yearly stays $299 until Chris sets a yearly change. | Everything in Pro plus: 8 AIs per council, 8 runs at once, unlimited Deep Research, all industry packs, a compliance audit log, early access (new features reach Extreme first, behind a flag), Max quality (the best model each connected AI offers, with more reasoning and a longer context, inside the budget cap), team spaces for 5 people total, counting the owner (the owner plus 4 invited), unlimited desktop control apps and recipes, hosted background runs and hosted schedules (gated, not a screen yet), and a monthly budget cap. |
| Owner | No charge. Issued by hand. | The same limits as Extreme. |

There is no fourth public price. The Studio flag for workspaces stays in the app (Phase 8). This plan does not rebuild teams and does not assign workspaces to Extreme until Chris says so.

## Tiers (limits that already ship)

The limits below are in the app today. Prices come from server/price-config.js. 

| Tier | Price the app shows today | Included |
|---|---|---|
| Free | $0 | Bring your own keys. Try it now (demo mode). Simple mode (best AI for the job). The learning router (picks stay on this computer). Status strip with health lights. Safety checks (risky-word warnings, masking preview, and the security page, when those screens land). Backup and restore, and Double-check this, when they land. 3 projects. Credits ledger. 5 councils a month. 1 connected service. 1 email account per provider. No missions. No schedules and no Do this again repeats. No desktop control or program scan. No industry packs. No public share links. No PDF or Word export. No background runs and no pause missions. No shared learning. No scores dashboard. No phone pairing. No full history search. A 14-day Pro trial can be started in the app. The trial is not started for you, and nothing is charged. |
| Pro | $18.99 / month, or $189 / year, or lifetime founder ($349 for the first 100, then $499, closed after 500). A Studio licence is treated as Pro. There is no separate Studio price. | Everything in Free plus: desktop control and program scan, Mission mode (plan, assign, QA, assemble), unlimited Council, schedules and Do this again repeats, 1 industry pack, public share links, PDF and Word export, background runs and pause missions (a row marked "when they land" in the app table is not a separate checkout; it unlocks with Pro when that screen ships), every connected service, up to 8 email accounts per provider, the off-peak scheduler and discount rules, balance-aware routing, unlimited projects and link hubs, Subscriptions tracker with burn rate and runway, shared learning, the scores dashboard (Who's best at what), phone pairing, full history search, update channel, priority support, Deep Research 8 times a month, 3 desktop control apps, 5 recipes. |
| Extreme | $29.99 / month or $299 / year. | Everything in Pro, plus 8 AIs per council, 8 runs at once, unlimited Deep Research, all industry packs, a compliance audit log, early access, Max quality, team spaces for 5 people total, counting the owner, unlimited desktop control apps and recipes, hosted background runs and hosted schedules (gated), and a monthly budget cap. |
| Owner | No charge. Issued by hand. | The same limits as Extreme. |

The free tier is deliberately the "feel the routing" tier. The Credits tab shows what the councils and missions would have saved, which is the upsell. The learning router stays on Free. Shared learning and the scores dashboard are Pro. The same split is in the app as a Free vs Pro table, and a free person who opens a Pro feature sees that table. The list lives in server/feature-gate.js. A later feature registers there and calls guard with its id. Some rows (desktop control, program scan, industry packs, PDF and Word export, background runs, pause missions, safety screens, backup and restore, Double-check this, Do this again) are approved and gated now, and the screen itself lands in a later change. Teams and workspaces stay as they shipped (Phase 8). A Studio flag is not a fourth public price.

## Owner and friends: no charge

The app checks a licence. With no active licence the copy stays on Free. A 14-day Pro trial can be started from the app (placeholder trial credits, nothing charged, no Stripe call). The owner key is issued by hand. To give free access through the same door, use a 100% coupon in Stripe on a Payment Link (a $0 checkout still sends the events) or a promo code. Either way the app's licence check is what unlocks the tier, not Stripe.

## Secrets (Chris adds them; they never go in a file or in git)

- `STRIPE_WEBHOOK_SECRET`: the signing secret of the Stripe webhook destination. It is set as a Supabase secret and read from the environment only.
- The Supabase service key stays on the server side.

## Still to do (Chris, not in this repo)

- Apply `supabase/migrations/20261025_stripe.sql` in the Supabase SQL editor (project everborn-command), then deploy the function: `supabase functions deploy stripe-webhook --no-verify-jwt`. Check in Stripe, Developers, Webhooks, that deliveries return 200.
- Optionally paste the seven Stripe price ids into `price-tiers.js`.
- Activate the Stripe customer portal in Stripe settings if a "Manage my plan" link is wanted.
- Sales tax: Stripe Tax is off. Confirm with the accountant.
- A landing page with the pay links and the download (everbornproductions.com/meldmind).

When the monthly raise ships, set `PRICE_SET` to `next` and make new Pro and Extreme monthly Payment Links in Stripe. Yearly and lifetime stay as they are.
