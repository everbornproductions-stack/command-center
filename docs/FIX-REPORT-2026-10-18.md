# Command Center fix report (2026-10-18)

Run by Claude (Fable 5.1) against `docs/FIX-BRIEF-2026-10-18.md`. Repo `C:\Users\chris\Desktop\Everborn\everborn-hq\command-center`, branch `main`, starting commit `28816ce Initial commit (cloud-first backup 2026-10-18)`.

## Read this first: what this run could and could not do

**All eight fixes are written to the working tree. None of them is committed, pushed, backed up or test-run.**

The session's permission mode let me read files, edit files and run read-only commands (`git status`, `git diff`, `node --version`, `rm`), but every other shell command needed an interactive approval that a non-interactive session cannot give. Blocked, each tried at least once in several forms: `node <script>`, `node --check`, `node --test`, `npm test`, `git add`, `git commit`. I did not try to route around the permission system. Consequences:

| Brief requirement | Outcome |
|---|---|
| One git commit per fix (a)–(h) | **Not done.** No commits exist. Commit hashes: none. See "What Chris needs to run" for the commit plan. Because several files carry changes from more than one fix (`server/index.js`, `server/license.js`, `web/app.js`, `electron/main.cjs`, `README.md`, `docs/database.md`), a clean one-commit-per-letter split from the final tree needs `git add -p`; a single commit is the practical alternative. |
| `git push -u origin main` | **Not done** (blocked before reaching credentials). |
| Drive bundle `G:\My Drive\Everborn Cloud\command-center\command-center-2026-10-18.bundle` | **Not done** (git write commands and the Drive path were both outside what the session may touch). |
| `npm test` must pass before the final commit | **Not run.** The tests are written (`test/*.test.js`) but have never executed. Expect first-run typos; they are documented as unverified below. |
| Demo-mode smoke test | **Not run.** Written as `npm run smoke` (`test/smoke.mjs`). |
| Rebuild the installer (optional) | Not done. |

Cloud-first rule (`~/.claude/CLAUDE.md`): **this work currently lives only on Chris's PC**, in the uncommitted working tree. Nothing deployed, nothing in Square changed, nothing under `data/` read or written, no real key or secret read, printed or committed.

Also not reached: `hq\work\marketing\command-center-launch\PLAN.md` (outside the directory the session was allowed to read), so its "MGM Grand" wording was not checked.

## Fix by fix

Verification column honesty: "static review" means I re-read the code paths; no fix was executed.

### (a) No cloud config means Free, not Owner — DONE (code), not run

Files: `server/cloud-defaults.json` (new), `server/license.js` (rewritten), `server/index.js` (`POST /api/cloud`), `electron/main.cjs` (sets `CC_PACKAGED`), `web/app.js` (Settings → Licence & cloud panel), `docs/database.md`.

- `server/cloud-defaults.json` ships the licence server address. **`anonKey` is empty.** The brief said to copy the publishable key from `data/settings.json`; Chris's instruction for this run was "do not read anything under data/" and "do not write any real API keys", so I left it blank. Until Chris pastes the `sb_publishable_…` key into that file, a fresh install is `configured: false` and runs Free (never owner). Chris's own copy keeps working: his `data/settings.json` has both fields, which takes precedence.
- `cloud()` order (local): Settings → Cloud if both fields non-empty, else shipped defaults, else `CC_SUPABASE_URL`/`CC_SUPABASE_ANON_KEY`. Hosted: env only.
- `licenseState()` → `resolveTier()` (pure, unit-tested): owner only from an active owner licence row, `CC_OWNER_EMAILS` (hosted), or `CC_DEV_OWNER=1` when `CC_PACKAGED !== "1"` (`devOwnerAllowed(env, packaged)`). Everything else is free.
- Grace: on a failed check the last good tier is kept until `current_period_end` or 7 days after the last successful check, whichever is sooner (`GRACE_MS`); then free. Never owner on error. A successful check is authoritative on its own (period end is only applied while offline).
- `POST /api/cloud`: empty URL or key → 400; packaged build cannot point at a different project than the shipped one (400); a changed project resets the verified tier (`resetVerifiedTier`) and re-checks asynchronously, so a switch can never raise the tier.
- `activate()`: a *different* key that fails leaves the stored licence alone (throws); the stored key failing drops the tier.
- UI: panel header is `tier: <tier>`; the old "owner build (no cloud configured)" wording is gone; the licence key and promo rows always show; both cloud fields are required.

Verified: static review of `license.js`, the route and the panel. Not verified: runtime, the grace path against a real outage, hosted `loadHostedLicense`.

### (b) Enforce every free-tier limit on the server — DONE (code), not run

Files: `server/license.js` (`guard`, `councilsThisMonth`, `subscriptionsLocked`), `server/index.js` (`startCouncil`, `startMission`, `saveSubscriptionGated`, routes, `fullState`, tick, plugin helpers), `server/plugins/index.js` (402 passthrough), `web/app.js` (locked Subscriptions panel, state wiring, toasts).

- One gate: `guard(feature, info)` with `missions | scheduler | subscriptions | council | projects`. `requireFeature` is now an alias for plugins.
- Councils: counted per **UTC calendar month** from the mission store (`kind === "council"`) plus councils still running for that user (they are only written when they finish). 4th on Free → 402 "You have used 3 of 3 councils this month on Free. Unlimited councils are part of Pro ($15.99/month)…".
- Projects: creating an id not already present at the limit → 402; editing existing projects works. Missing name and id → 400.
- Subscriptions: `POST /api/subscriptions`, `DELETE /api/subscriptions/:id` and `POST /api/setup/track` → 402 with `locked: true`; `fullState()` and the 15-second tick send `subscriptions: []`, `subscriptionTotals: { …, locked: true }`, `subscriptionsLocked: true`. UI shows a locked panel with the pay link and an "I have a licence key" button.
- Missions: `startMission` guards `missions` (+ `scheduler` for off-peak). Plugins receive `runMission: startMission`, `runCouncil: startCouncil`, `saveSubscription: saveSubscriptionGated` instead of the raw functions, so they cannot bypass the gates. Plugin exceptions with `status` now return that status (402) instead of 500.
- Hosted: `licenseState()` is per context, so every gate is per user.

Verified: static review. Not verified: runtime; the in-flight council counter under concurrent requests.

### (c) Neutral starting data on the desktop — DONE (code), not run

Files: `server/projects.js`, `server/subscriptions.js`, `server/paths.js`, `electron/main.cjs`, `server/index.js` (boot log), `web/app.js` (placeholder text, HQ wording), `server/plugins/pipelines.js` (placeholders), `README.md`, `docs/owner-seed.example.json` (new).

- Both modes seed one empty "My project" and only Claude / ChatGPT / Grok rows with empty notes and UNKNOWN prices.
- Chris's seed moved to `docs/owner-seed.example.json` with notes removed (docs/ is excluded from the installer by `electron-builder.yml`). His existing `data/projects.json` and `data/subscriptions.json` are untouched (`doc()` only seeds a missing file).
- HQ adapter: explicit `CC_HQ_DIR` wins; a packaged build (`CC_PACKAGED=1`) never guesses; a run from source still picks up a sibling `hq/` folder only if `hq/state.json` really exists, so Chris's dev workflow keeps working. The sibling-folder guess in `electron/main.cjs` is gone. `hqSnapshot()` returns `available: false` when there is no folder.
- Customer-facing text neutralised: Marching-orders placeholder ("Jake Stien's new single"), the three pipeline template placeholders (Jake Stien, "I Loved You in the Dark", Capital City Life), Settings "HQ folder" line, Projects "No HQ folder found" message. `server/registry.js`, `server/discover.js` and `server/update.js` only contain the product name, the OpenRouter referer and the update feed URL, which are legitimate.

Verified: static review; `test/seed.test.js` greps both seed files for owner-specific strings. Not run.

### (d) Square webhook — DONE (code), not deployed, not run

Files: `supabase/functions/square-webhook/logic.js` (new), `supabase/functions/square-webhook/index.ts` (rewritten), `supabase/migrations/20261018_license_pending.sql` (new, **not applied**), `docs/database.md`.

- Missing `SQUARE_WEBHOOK_SIGNATURE_KEY` or `SQUARE_WEBHOOK_URL` → every POST gets 500 "not configured" and a console error. The `return true; // allow during setup` line is gone.
- Signature: HMAC-SHA256 over `SQUARE_WEBHOOK_URL + rawBody`, compared with a constant-time loop (`timingSafeEqual`); `req.url` is never used.
- `mapSquareStatus`: ACTIVE → active, **PENDING → pending**, PAUSED → past_due, else cancelled.
- Keys: `genLicenseKey()` uses `crypto.getRandomValues`, `byte & 31` over a 32-letter alphabet (no modulo bias). Migration replaces `random()` with `gen_random_bytes` in `public.gen_license_key()` and adds `pending` to the `licenses.status` check constraint (`licenses_status_check`).
- `logic.js` is plain ESM on Web APIs only, imported by both `index.ts` (Deno) and `test/webhook.test.js` (Node).

Verified: static review. Not verified: the Deno function was not type-checked or deployed; the migration was not run.

### (e) Local server: block cross-site requests — DONE (code), not run

Files: `server/index.js`, `web/app.js`, `electron/main.cjs`, `README.md`.

- Per-launch token: `crypto.randomBytes(32)` hex, injected as `<meta name="cc-token">` into `index.html` (served with `no-store`). `web/app.js` sends it as `X-CC-Token` on every `/api` call (`apiHeaders()`), as the first WebSocket message `{ type: "auth", token }`, and fetches the bookmarks download and the pairing QR as blobs with the header (no more plain `<a href>`/`<img src>` to the API). Compared with `crypto.timingSafeEqual`.
- Host check on **every** request including static files (so a DNS-rebinding host cannot read the token page): must be `127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>` → else 421.
- Origin check: if present, must be the loopback origin → else 403. Same on the WebSocket upgrade (close 4403).
- Content-type: POST/PUT/DELETE/PATCH with a body must be `application/json` → else 415, in hosted mode too.
- Exempt: `/api/health`, `/api/config`. WebSocket without a valid first auth message closes 4401 (15 s timeout). On `auth.error` the local UI reloads once (new token after a relaunch).
- Electron now probes `/api/health` instead of `/api/state`; it loads `http://127.0.0.1:<port>/` so Host and Origin match. `Start Command Center.cmd` opens `localhost:<port>`, also allowed. Hosted mode keeps bearer auth; `server/mock.js` unchanged (loopback only, fake answers, no real provider).

Verified: static review. Not verified: runtime, Electron, the service-worker interaction (network-first, so a relaunch serves the fresh token).

### (f) Mac vault — DONE (code), not run on a Mac

Files: `server/vault.js` (rewritten), `electron/main.cjs` (`exposeSafeStorage()`), `web/app.js` (vault wording), `README.md`.

- Windows: DPAPI unchanged. macOS/Linux inside Electron: `safeStorage.encryptString/decryptString`, exposed to the in-process server as `globalThis.__ccSafeStorage` after `app.whenReady`; blobs are prefixed `ss1:`. Linux `basic_text` backend counts as unavailable.
- Plain Node off Windows: `setSecret` throws "Saving keys needs the desktop app on this platform…" (400) before anything is written. No base64 fallback; an old base64 `vault.bin` is ignored with a clear error. Demo-mode pretend keys stay in memory when the vault cannot save, so demo still works there.
- `vaultInfo()` now returns `{ file, method, kind, canSave }`; Settings shows an amber warning when `canSave` is false.

Verified: static review only. No Mac or Linux machine in this run.

### (g) "MGM Grand Las Vegas" on Square checkout — MANUAL STEP FOR CHRIS, nothing changed

Not in the code; it is the only location on the Square account. **Chris:** Square Dashboard → Account & Settings → Business → Locations → rename the location to "Everborn Productions", then open https://square.link/u/dbU38mQC and check the new name shows. `docs/billing.md` already describes this correctly, so it was left as is. `hq\work\marketing\command-center-launch\PLAN.md` could not be read in this session.

### (h) Tests for (a) to (e) — WRITTEN, never executed

Files: `package.json` (`npm test` → `node --test "test/*.test.js"`, `npm run smoke`), `test/helpers.js`, `test/license.test.js`, `test/tiers.test.js`, `test/seed.test.js`, `test/webhook.test.js`, `test/local-security.test.js`, `test/smoke.mjs`. No new dependencies (`node:test`, `node:assert`, and the existing `ws` package for the WebSocket client).

- Every server test spawns `server/index.js` with a temp `CC_DATA_DIR`, random free ports, `CC_CLOUD_DEFAULTS_FILE` and `CC_UPDATE_FEED` pointed at a local stub, env cloud vars cleared, `CC_HQ_DIR` pointed at a non-existent folder. The real Supabase project is never contacted.
- Coverage: (a) free with no cloud; empty `/api/cloud` → 400 and tier unchanged; shipped defaults used (stub receives `verify_license` with the shipped apikey); project switch resets tier; `CC_DEV_OWNER` honoured unpackaged and ignored packaged (server + unit). (b) 4th council → 402, last month's councils don't count, 2nd project → 402 while edits work, subscriptions 402 + locked state + untouched file, mission and pipeline → 402; stubbed Pro and dev-owner allowed. (c) fresh seeds carry none of the forbidden strings. (d) not configured / bad / good signature, wrong URL, PENDING ≠ active, key regex and unbiased mapping. (e) 401/401/200 token cases, 403 Origin, 421 Host (API and static), 415 text/plain, downloads need the token, WebSocket closes 4401/4403 and hello on success.
- The health loop still probes public provider status pages at boot (pre-existing behaviour, not Supabase); tests tolerate it.

**Expect the first `npm test` run to surface mistakes**, since nothing here has executed.

## What Chris needs to run (in this order)

```powershell
cd C:\Users\chris\Desktop\Everborn\everborn-hq\command-center
npm test                 # all five test files must pass; fix anything that fails
npm run smoke            # demo-mode: single, council, mission as dev owner + Free gates
```

Then commit and push. Simplest (one commit):

```powershell
git add -A               # .gitignore already excludes data/, dist/, .env, keys, password files
git commit -m "fix(a-h): Free by default, server-side tier gates, neutral seeds, Square webhook hardening, local CSRF protection, Mac vault, tests (brief 2026-10-18)"
git push -u origin main
```

If the one-commit-per-fix history matters, use `git add -p` with this file map (shared files need hunk picking):

| Fix | Files |
|---|---|
| a | `server/cloud-defaults.json`, `server/license.js`†, `server/index.js`†, `electron/main.cjs`†, `web/app.js`†, `docs/database.md`† |
| b | `server/license.js`†, `server/index.js`†, `server/plugins/index.js`, `web/app.js`† |
| c | `server/projects.js`, `server/subscriptions.js`, `server/paths.js`, `electron/main.cjs`†, `server/index.js`†, `web/app.js`†, `server/plugins/pipelines.js`, `README.md`†, `docs/owner-seed.example.json` |
| d | `supabase/functions/square-webhook/logic.js`, `supabase/functions/square-webhook/index.ts`, `supabase/migrations/20261018_license_pending.sql`, `docs/database.md`† |
| e | `server/index.js`†, `web/app.js`†, `electron/main.cjs`†, `README.md`† |
| f | `server/vault.js`, `electron/main.cjs`†, `web/app.js`†, `README.md`† |
| h | `package.json`, `test/*` |

† shared between fixes.

If the push fails, write the bundle so Drive syncs it: `git bundle create "G:\My Drive\Everborn Cloud\command-center\command-center-2026-10-18.bundle" --all`.

## Manual steps for Chris besides commit/push

1. **Publishable key into the shipped defaults.** Supabase dashboard → project `everborn-command` → Project Settings → API → copy the *publishable* key (`sb_publishable_…`, never the service key) into `server/cloud-defaults.json` → `anonKey`. Commit it (it is designed to be public). Without it every customer copy is Free with "no licence server configured".
2. **Apply the migration** `supabase/migrations/20261018_license_pending.sql` in the SQL editor (after `schema.sql`).
3. **Square webhook secrets** when deploying: `SQUARE_WEBHOOK_SIGNATURE_KEY` and `SQUARE_WEBHOOK_URL` (the exact URL registered in Square). Until both are set the function rejects everything with 500. Deploy with `supabase functions deploy square-webhook --no-verify-jwt` (not done here).
4. **Square location rename** (fix g) as above. Check the pay link afterwards.
5. **Rebuild the installer** (`npm run dist`) after step 1 so it carries the shipped defaults. Do not upload until tests pass.
6. **Mac/Linux**: the safeStorage path has never run. Try it in the desktop app on a Mac before advertising Mac support.

## Open items / not verified

- Nothing executed: tests, smoke, Electron, hosted mode, Deno function, migration.
- `councilsInFlight` is in-memory per context; two councils started in the same millisecond on the same Free account could both pass if the store count is exactly 2. Acceptable for a 3-per-month limit; noted.
- `/api/pair/qr.svg` now needs the token in local mode (fetched as a blob by the UI); hosted keeps it public for phone pairing.
- Health loop still reaches public status pages at boot (pre-existing).
- `docs/schema.sql` was deliberately not edited (brief: migration file only); a brand-new project must run `schema.sql` then the migration.
