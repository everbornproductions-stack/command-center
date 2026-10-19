# Pipeline marketplace (design, build after pipelines have users)

## Status (Phase 10)

The app has a Marketplace tab for a local and demo catalog. Install copies a pipeline, agent, or prompt onto this computer and does not run it. Paid prices are placeholders. Checkout is off unless `CC_MARKET_PAID=1`, and even then nothing is charged and no payment service is called. The tables below are a sketch for a later hosted catalog. The app does not create them.

## What it is

Users publish the pipelines they have proven (steps, assignments, inputs, example output) and other users install them with one click. Everborn takes a cut. It turns the best customers into sellers and gives new customers a reason to stay subscribed: the library keeps growing.

## Listing

- Title, category (Social Posts, Music Videos, Client Work, Sales, Ops), one-line promise, screenshots of a real deliverable, the step list with which capability each step needs (not the model: buyers bring their own AIs), average cost per run from the seller's own receipts, ratings.
- Price: free, one-time ($5–49), or included in a seller's bundle. Everborn keeps 20% on paid; free listings cost nothing.
- Versioned: sellers push updates; buyers see "update available" with a diff of the steps.

## Trust

- Pipelines are data (steps and prompts), never code; nothing runs on install except what the buyer's own hub runs through its own router with its own keys.
- Sellers verify identity through their Everborn account and Square payout (Stripe Connect or Square payouts later).
- Report button; listings pulled on complaint pending review; prompt injection scan on publish (steps that try to exfiltrate keys or disable QA are rejected).

## Mechanics

- Supabase tables: `market_listings` (seller_id, pipeline json, price, version, stats), `market_installs` (user_id, listing_id, version), `market_reviews`.
- Install = copy the listing's pipeline json into the buyer's `pipelines.saved` doc with `sourceListing` set, so updates can be offered.
- Payments: Square checkout links per listing at first (manual payouts weekly), then automated payouts.
- Discovery: Pipelines tab gets a "Marketplace" section; sort by installs, rating, "saved the most".

## Metrics that matter

Installs per listing, runs per install (dead installs tell you the listing over-promised), average savings per run (from receipts), seller retention.

## Not before

Pipelines (feature 1) shipped and used for a month; receipts (7) producing numbers; hosted hub live so installs can sync between devices.
