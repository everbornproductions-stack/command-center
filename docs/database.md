# Database (Supabase) and licensing

## Do we need one?

For one person on one PC: no. Everything lives in `data/` as JSON (vault, ledger, projects, subscriptions, missions). For a product with paying customers, phones and a hosted hub: yes. The cloud side needs to know who paid, which licence key is theirs, which devices use it, what the latest version is, and (later) sync projects between phone and desktop.

## Why Supabase

Free tier: Postgres, Auth, Row Level Security, Edge Functions, 500 MB, no card. Two free projects per account (free projects pause after a week of inactivity; the first paying customer justifies the $25/month Pro plan, which removes that). It is also what Lovable already used for the SnapCreditFix rebuild, so the account exists.

## What is in `supabase/schema.sql`

| Table / function | Purpose |
|---|---|
| `licenses` | key, email, tier (free/pro/extreme/studio/owner), status, Stripe customer + subscription ids, period end, max devices |
| `devices` | each PC/phone that activated a key (device id, name, platform, app version, last seen) |
| `releases` | the update feed the app polls (version, notes, URL, published) |
| `user_sync` | optional phone ↔ desktop sync of projects/subscriptions/settings per signed-in user |
| `promo_codes` | owner key, friends, launch deals (code, tier, max uses, optional email lock) |
| `stripe_events` | webhook idempotency log (event id only) |
| `verify_license(key, device…)` | what the app calls with the anon key: returns tier/status and registers the device. After `20261021_per_person_licences.sql`, the cap is `max_devices` (default 2) and a new computer past the cap is not stored |
| `redeem_promo(code, email)` | turns a promo code into a licence for that email and returns the key. A code with `email` set redeems only for that address |
| `list_license_devices` / `remove_license_device` | Settings > Devices. Added by the per-person migration, not in the original schema |
| `license_reviews` | owner-only flag when one licence is used from many computers or addresses in a short time |

RLS: anon can only call the two functions and read published releases; signed-in users see their own licence (by email) and their own sync rows; everything else is service-role only.

Seeded: promo code **EVERBORN-OWNER** (tier owner, one use) so Chris's own copy never pays, and release 0.1.0.

## Stripe → licence (Edge Function `stripe-webhook`)

`supabase/functions/stripe-webhook/index.ts`: receives Stripe webhooks (`checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`), verifies the `Stripe-Signature` header (HMAC SHA256 over `timestamp.rawBody`, constant-time compare, 5 minute tolerance), ignores an event id it has already seen (`stripe_events`), and creates or updates the licence by buyer email. A paid subscription invoice creates the licence with a fresh key. An upgrade from Pro to Extreme changes the tier on the same licence. `customer.subscription.deleted` sets `cancelled` and keeps the period end. A full refund sets `cancelled` now. A one-time $349 payment is a lifetime founder licence with no end date. Stripe `active` and `trialing` give `active`, `past_due` and `unpaid` give `past_due`, `incomplete` gives `pending` (unlocks nothing), everything else gives `cancelled`. If `STRIPE_WEBHOOK_SECRET` is missing, every POST is rejected with 500 "not configured". The pure logic (signature check, price-to-plan, event handling, key generation) is in `stripe-webhook/logic.js`, which the Node tests import directly. The price-to-plan map is `stripe-webhook/price-tiers.js` (amount plus interval until the price ids are pasted in). The only secret is `STRIPE_WEBHOOK_SECRET`; the function never stores card data and never logs an email or a key.

The app unlocks by the signed-in email through `activate_license_by_email(p_email, ...)` (signed-in users only, since migration `20261026_stripe_unlock_proof.sql`: it ignores the typed email, reads the confirmed email of the caller's Supabase session, answers every miss with the same reply, and never returns the key). `find_active_license_by_email` is service role only.

## Migrations (`supabase/migrations/`)

Run in the SQL editor, in filename order, after `schema.sql`:

| File | What |
|---|---|
| `20261018_license_pending.sql` | adds `pending` to `licenses.status`; `gen_license_key()` uses `gen_random_bytes` instead of `random()`. **Not yet applied** (written 2026-10-18 by the fix run; apply by hand). |
| `20261021_per_person_licences.sql` | per-person cap of 2 computers, optional email lock on promo codes, device list and remove, tester-code function, owner review flag. **Not applied.** Chris runs it by hand after review. See the steps at the end of this file. |
| `20261021_usage_pings.sql` | `usage_pings` (one anonymous ping per install per day) and `record_usage_ping`. RLS is insert-only for anon and authenticated. No select policy. **Not applied** (written 2026-10-21; apply by hand). |
| `20261021_license_plan.sql` | nullable `licenses.plan` (`pro-monthly`, `pro-yearly`, `extreme-monthly`, `extreme-yearly`, `lifetime-349`, `lifetime-499`). Prices stay in `server/metrics-prices.js`. **Not applied** (written 2026-10-21; apply by hand). |

## In the app

Settings → Licence & cloud. **Every copy starts on the Free tier.** Owner comes only from an active owner licence row (the `EVERBORN-OWNER` promo or an owner key), from `CC_OWNER_EMAILS` on a hosted hub, or from `CC_DEV_OWNER=1` in an unpackaged developer run (installed builds ignore it). With no licence server configured or reachable the app is Free, never owner.

Where the licence server address comes from (local mode, in order): Settings → Cloud if both fields are filled in; else the shipped `server/cloud-defaults.json` (project URL, plus the publishable key written in at release build time); else `CC_SUPABASE_URL` / `CC_SUPABASE_ANON_KEY`. The publishable key is not committed. `npm run dist` and `npm run dist:mac` read `CC_SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY`, write it into that file for the installer, then clear it. A release build with neither variable set stops. Saving an empty URL or key in Settings is refused (400); an installed build cannot be pointed at a different project; changing the project resets the verified tier and re-checks, so a switch can never raise the tier.

Tiers: Free = Single mode, the learning router, 5 councils per calendar month (UTC), 3 projects, 1 connected service, 1 email account per provider, no Subscriptions tab, no shared learning, no scores dashboard, no phone pairing, no full history search. A 14-day Pro trial can be started in the app and nothing is charged. Pro unlocks missions, scheduler, unlimited councils and projects, every connected service, up to 8 email accounts per provider, Subscriptions, shared learning, the scores dashboard, phone pairing and full history search. The key is re-checked every 12 hours and on start. If the server cannot be reached, the last known good tier is kept until `current_period_end` or 7 days after the last successful check, whichever is sooner, then the copy drops to Free. Promo codes redeem in the same panel.

Once `20261021_per_person_licences.sql` is applied, a licence is one person and 2 computers (a PC and a laptop). Computers already on the key keep working. A new computer past the cap is refused with "This key is already on 2 computers. Remove one in Settings > Devices." Settings > Devices lists them and removes one after a confirm click. An Extreme team seat is a separate licence, so members do not share one cap. A promo code with `email` set redeems only for that email. Tester codes are made with `scripts/make-tester-code.mjs` (owner only, single use, one email, the code is printed once after it is stored). Four or more different computers, or four or more different IP addresses, in 24 hours writes a row to `license_reviews` for the owner. That flag does not block the person.

## Live project (created 2026-10-18)

| | |
|---|---|
| Organization | Everborn Productions (Free plan) |
| Project | everborn-command, ref `ezbpstloczzdlcxwliwu`, West US (Oregon) |
| URL | https://ezbpstloczzdlcxwliwu.supabase.co |
| Dashboard | https://supabase.com/dashboard/project/ezbpstloczzdlcxwliwu |
| Publishable (anon) key | not committed. A release build injects it from `CC_SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY` into `server/cloud-defaults.json`. From source, paste it in Settings → Cloud. Never the service key |
| Database password | `data/supabase-db-password.txt` (local only; reset in Project Settings → Database if lost) |
| Schema | `supabase/schema.sql` applied once via the SQL editor ("Success. No rows returned") |

Free-tier note: the project pauses after 7 days without activity; the app's 12-hourly licence re-check keeps it awake once a customer exists, and the Pro plan ($25/mo) removes pausing.

## Setup steps

1. Sign in at supabase.com → New project `everborn-command` (free, region US West), set a strong database password (Supabase keeps it; the app never needs it).
2. SQL editor → paste `supabase/schema.sql` → Run.
3. Project Settings → API: the project URL stays in `server/cloud-defaults.json`. For a release build, set `CC_SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY` to the publishable key (do not commit it). From source you can paste both fields in Settings → Cloud or set `CC_SUPABASE_URL` / `CC_SUPABASE_ANON_KEY`.
4. Redeem `EVERBORN-OWNER` in Settings with your email → owner licence.
5. Later, for customers: apply `supabase/migrations/20261025_stripe.sql`, run `supabase functions deploy stripe-webhook --no-verify-jwt`, set `STRIPE_WEBHOOK_SECRET` with `supabase secrets set`, and register the function URL in Stripe → Developers → Webhooks with the five event types.

## Per-person licences (not applied)

`supabase/migrations/20261021_per_person_licences.sql` is a file only. The app does not run it. Chris approves it, then runs it once in the SQL editor. Billing is unchanged.

1. Open the Supabase SQL editor for project everborn-command.
2. Confirm `schema.sql` and `supabase/migrations/20261018_license_pending.sql` have already been applied. If the pending migration has not, review and run that one first.
3. Paste `supabase/migrations/20261021_per_person_licences.sql` and run it. It is safe to re-run.
4. What that run changes, which is the part to approve:
   - `licenses.max_devices` default becomes 2. Rows still set to 3 are set to 2. Any other number is left alone.
   - `verify_license` refuses a new computer past that cap and does not store it. Computers already on the key keep working until they are removed in Settings > Devices.
   - `promo_codes.email`, when set, redeems only for that email.
   - `create_tester_code` is granted to the service role only.
   - A licence seen from 4 or more computers, or 4 or more IP addresses, in 24 hours is inserted into `license_reviews`. The person is not blocked.
5. Check with the service role (not the publishable key): `select key, email, max_devices from public.licenses;` and `select * from public.license_reviews;`
6. To make a tester code after the migration is applied, on an owner machine: set `CC_DEV_OWNER=1`, `CC_SUPABASE_URL`, and `CC_SUPABASE_SERVICE_KEY`, then run `node scripts/make-tester-code.mjs --email person@example.com`. The code prints once. It is single use and locked to that email. Do not commit the service key.
7. To clear a review flag after looking at it: `delete from public.license_reviews where license_id = '<id>';`
