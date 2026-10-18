# Database (Supabase) and licensing

## Do we need one?

For one person on one PC: no. Everything lives in `data/` as JSON (vault, ledger, projects, subscriptions, missions). For a product with paying customers, phones and a hosted hub: yes. The cloud side needs to know who paid, which licence key is theirs, which devices use it, what the latest version is, and (later) sync projects between phone and desktop.

## Why Supabase

Free tier: Postgres, Auth, Row Level Security, Edge Functions, 500 MB, no card. Two free projects per account (free projects pause after a week of inactivity; the first paying customer justifies the $25/month Pro plan, which removes that). It is also what Lovable already used for the SnapCreditFix rebuild, so the account exists.

## What is in `supabase/schema.sql`

| Table / function | Purpose |
|---|---|
| `licenses` | key, email, tier (free/pro/studio/owner), status, Square customer + subscription ids, period end, max devices |
| `devices` | each PC/phone that activated a key (device id, name, platform, app version, last seen) |
| `releases` | the update feed the app polls (version, notes, URL, published) |
| `user_sync` | optional phone ↔ desktop sync of projects/subscriptions/settings per signed-in user |
| `promo_codes` | owner key, friends, launch deals (code, tier, max uses) |
| `square_events` | webhook idempotency log |
| `verify_license(key, device…)` | what the app calls with the anon key: returns tier/status and registers the device (limit 3 active in 30 days) |
| `redeem_promo(code, email)` | turns a promo code into a licence and returns the key |

RLS: anon can only call the two functions and read published releases; signed-in users see their own licence (by email) and their own sync rows; everything else is service-role only.

Seeded: promo code **EVERBORN-OWNER** (tier owner, one use) so Chris's own copy never pays, and release 0.1.0.

## Square → licence (Edge Function `square-webhook`)

`supabase/functions/square-webhook/index.ts`: receives Square webhooks (subscription.created / updated, invoice.payment_made / payment_failed), verifies the HMAC signature, creates a licence with a fresh key on first sight of a subscription, flips status on cancellation or failed payment, and emails the key (Resend) if an API key is set. Secrets: `SQUARE_WEBHOOK_SIGNATURE_KEY`, `SQUARE_ACCESS_TOKEN` (to look up the buyer email), `RESEND_API_KEY`.

## In the app

Settings → Licence & cloud. With no cloud configured the build runs as **owner** (everything unlocked). With the Supabase URL + anon key saved, the app enforces tiers: Free = Single mode, 3 councils/month, 1 project; Pro unlocks missions, scheduler, unlimited councils and projects. The key is re-checked every 12 hours and on start. Promo codes redeem in the same panel.

## Live project (created 2026-10-18)

| | |
|---|---|
| Organization | Everborn Productions (Free plan) |
| Project | everborn-command, ref `ezbpstloczzdlcxwliwu`, West US (Oregon) |
| URL | https://ezbpstloczzdlcxwliwu.supabase.co |
| Dashboard | https://supabase.com/dashboard/project/ezbpstloczzdlcxwliwu |
| Publishable (anon) key | stored in the app (`data/settings.json` → `cloud.anonKey`); safe to ship in the client |
| Database password | `data/supabase-db-password.txt` (local only; reset in Project Settings → Database if lost) |
| Schema | `supabase/schema.sql` applied once via the SQL editor ("Success. No rows returned") |

Free-tier note: the project pauses after 7 days without activity; the app's 12-hourly licence re-check keeps it awake once a customer exists, and the Pro plan ($25/mo) removes pausing.

## Setup steps

1. Sign in at supabase.com → New project `everborn-command` (free, region US West), set a strong database password (Supabase keeps it; the app never needs it).
2. SQL editor → paste `supabase/schema.sql` → Run.
3. Project Settings → API: copy the Project URL and the anon public key into the app (Settings → Cloud) or into `data/settings.json` under `cloud`.
4. Redeem `EVERBORN-OWNER` in Settings with your email → owner licence.
5. Later, for customers: `supabase functions deploy square-webhook --no-verify-jwt`, set the secrets, paste the function URL into Square Developer → Webhooks, subscribe to the four event types.
