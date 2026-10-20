# Move learning scores and licence checks to the server

Plan only. Do not deploy. Do not run SQL. Do not add an edge function in this change. Do not touch Square, billing, or `supabase/functions/square-webhook`.

Have an attorney review before any of this is built, because it changes where customer data and licence decisions live.

## Why this is a plan

The packaged app is an asar archive. These pieces ship inside it today, so anyone who unpacks the installer can read them:

- Learning-router weights and the blend with the registry, in `server/brain.js` (`QUALITY_K`, `COST_K`, `LATENCY_K`, `THUMB_WEIGHT`, `THUMB_SCORE`) and `server/router.js` (`rank`).
- Community score math, in `server/community.js` (`replaceCommunity`, `communityStat`) and the anonymous share rows built by `sharePreview` in `server/brain.js`.
- Licence-key checks, in `server/license.js` (`resolveTier`, `GRACE_MS`, `TIERS`, `guard`, `activate`) and the client call to `verify_license`. The SQL for `verify_license` is already in `supabase/schema.sql` on the project. The grace rules, the tier table, and `guard` still ship in the app.

A patched copy can ignore `guard` and treat itself as owner. Moving the decision off the device is what makes that patch stop working for anything the server has to agree to.

## What stays true

Locked decisions are unchanged. This document does not build them and does not rewrite them.

- Decision 16 (smart fallback) stays in the app. It reacts to a live provider error (out of credits, rate limit, key rejected) and must keep working when the learning server is down.
- Decision 18 (learning router) stays the product behavior: scores, thumbs, cost, latency, and task type per model. No prompt text, no secrets, no personal data. "Who's best at what" still shows that. Training a later model still uses only aggregated, opt-in data.
- Decision 23 (bring your own Supabase) is not built. These functions would run on Everborn's project. A customer's own project would not host them.
- Privacy text in `docs/legal/privacy.md` and `docs/legal/shared-learning.md` stays the customer promise: prompts, content, and keys are not shared. This plan does not start uploading them.
- Nothing is posted or sent without a click. Shared learning stays opt-in. The current build still sets `sent: false` on the share preview and does not upload.

## What would move

Three Supabase edge functions, new files under `supabase/functions/`, separate from the Square webhook. Names below are the plan, not files to add yet.

### 1. `learning-rank`

The app sends a task type, a difficulty, a priority (quality, balanced, savings, speed), and the caller's own anonymous totals for models they have already used (the same fields as a brain stat: jobs, successes, score, cost, latency, thumbs). It does not send the prompt, the answer, a chat id, or a key.

The function owns the weights. It returns the ordered model ids and the score it used. The installed app stops shipping `QUALITY_K` and the blend formula. `rank()` in the app becomes a request, with the registry order as the offline fallback (the same order a new user gets today when there is no record).

The person's own totals can stay on the device (`brain` document) so export, reset, and delete still work offline. The secret is the formula, not the person's totals.

### 2. `community-scores`

The community pool (`server/community.js`) and the opt-in share rows (`sharePreview`) move here.

- Upload, only after the person checks **I am willing to share anonymous track records**, and only when they click to send. The body is the row list `sharePreview` already builds: model, task type, and the anonymous totals. No account id in the row.
- Download of the merged community table, so Quality, Balanced, Max savings, and Speed can read it the way `communityStat` does today. The merge (how rows become the stat object) lives in the function. The app stores the downloaded table as a cache and can drop it.
- The Free tier still cannot turn sharing on (`guard("sharedLearning")`). That check should ask `license-check` rather than trust a local flag.

Until this exists, the app keeps the on-device pool and does not upload. `docs/help/getting-started.md` says nothing is uploaded. Do not change that sentence until the click-to-send path is real.

### 3. `license-check`

Wraps the existing `verify_license` (and, later, `redeem_promo`) so the grace window, the owner rule, and the tier limits are not in the asar.

- The app sends the licence key, the device id, and the app version. It does not send provider API keys.
- The function calls `verify_license` with the service role. The service role stays in the function secret store. It is never written into the app, into git, or into a log.
- The reply is the tier, the limits, and an expiry. A missing or failed reply stays Free, which is the rule `resolveTier` already uses when there is no licence.
- Offline grace, if it remains, should be a short signed expiry from the function, not `GRACE_MS` copied into the client. A patched client that invents its own grace gets no signature and stays Free for any feature the server can refuse.

`activate`, `redeem`, and `recheck` in `server/license.js` become callers of this function. `TIERS` can stay as labels for the UI, but a local edit of `TIERS` must not unlock a feature the function said was off.

## What a patched app can still do

Be plain about the limit. Customer API keys stay on the device and go to the provider the customer chose (`docs/legal/privacy.md`). A patched desktop build that has those keys can still call the provider even if it ignores `license-check`. Moving the check raises the cost of reading the rules and stops honest builds from unlocking themselves. It does not, by itself, stop a rebuilt client from using a key it already holds.

Full enforcement means the provider call goes through Everborn, which would put customer keys or prompts on our server. That conflicts with the privacy note and is not part of this plan. Do not do it under this document.

What this plan does remove from the installer is the scoring formula, the community merge, and the licence decision table.

## Auth

The publishable key in `server/cloud-defaults.json` is not an access check. Anyone with the app can call a public function.

- `license-check` accepts a licence key and returns only that key's tier. Rate-limit it. Do not echo the key back in logs.
- `learning-rank` and `community-scores` should require a licence the function just accepted, or a signed-in Supabase user, so they are not an open anonymous write.
- Do not put the service role, a Square token, or any provider key in the function source. Edge secrets are set in the Supabase dashboard, outside git.

## Rollout, when Chris adds it to the run order

1. Add the three functions and their tests against a local stand-in. Do not deploy. Do not run the SQL on the live project. Tests keep using mocks on local ports.
2. Ship the app able to call them, with the current on-device path still in place, behind a flag that defaults off.
3. Compare answers (server rank vs `rank()`, server tier vs `resolveTier`) in tests until they match.
4. Turn the flag on for packaged builds only. Unpackaged `npm start` can keep the local path so development does not need the network.
5. Remove the weights, `replaceCommunity`'s merge, and the grace table from the packaged tree in a later version. Do not remove them in the same change that introduces the flag.

Decision 14's run order is unchanged. This work is not a phase until Chris adds it.

## Explicitly out of scope

- No deploy, no `supabase functions deploy`, no `db push`, no migration run on the hosted database.
- No edit to `supabase/functions/square-webhook`.
- No welcome email (decision 22) and no build of bring-your-own Supabase (decision 23).
- No change to Square prices, promo redemption behavior, or the Free / Pro / Studio / Owner limits the customer already has.
- No bytenode. See `electron-builder.yml`. Bytecode is not a substitute for moving these checks.
