# Hosted hub (2026-10-18)

Goal: the command center runs as a hub in the cloud so Chris, and later every subscriber, can use it from a phone or any browser with the PC off. Local single-user mode stays the default and is unchanged.

## Decision from Chris (relayed 2026-10-18, updated the same afternoon)

First call: free or cheapest host. Updated call: **everything under Cloudflare**, which already runs the Everborn sites and DNS. So: Cloudflare Containers on the Workers Paid plan ($5/month) running the existing Node 24 image, a thin Worker in front (also carries the WebSocket), hub at **hub.everbornproductions.com** through Cloudflare DNS for now (**hub.meldmind.ai** once meldmind.ai is a Cloudflare zone; see *Hub address* below). The Worker is named **meldmind-hub**. The Windows installer is served from **R2** at downloads.everbornproductions.com (Pages caps files at 25 MB; the installer is 112 MB). Supabase stays the database and auth (no D1 migration). Chris runs the plan upgrade and the deploy himself. Fly.io stays documented as the fallback only, with the same public address.

## Turn on checklist (2026-10-30)

Everything below is ready in git. Nothing has been deployed, paid for, signed in or set as a secret. Chris turns it on once all the builds are done:

1. Install Docker Desktop: `winget install Docker.DockerDesktop`, start it once and wait for "Engine running".
2. Turn on Workers Paid ($5/month): Cloudflare dashboard > Workers & Pages > Plans.
3. Run the one command from the `command-center` folder: `powershell -ExecutionPolicy Bypass -File tools\deploy-hub.ps1` (run it with `-WhatIf` first to see every step without running anything). It signs in to Cloudflare if needed (browser), deploys, sets the four secrets (you paste only the Supabase secret key, hidden), and checks `/api/health`.
4. Supabase > Authentication > URL configuration: Site URL `https://hub.everbornproductions.com`, add `https://hub.everbornproductions.com/**` to Redirect URLs (and run `supabase/hosted.sql` if it was never run).
5. Upload the installer to the R2 bucket `everborn-downloads` (*Installer download on R2* below).
6. Test sign-in: open `https://hub.everbornproductions.com`, enter your email, open the magic link on the same device. Then make a test schedule a few minutes out and check it runs.

## Hub address (one setting)

The hub address is the route `pattern` and `CC_HUB_URL` in `wrangler.jsonc` (the block marked HUB ADDRESS). Both say `hub.everbornproductions.com` today, because everbornproductions.com is a zone in Chris's Cloudflare account (with capitalcitylife.com and captialcitylife.com). meldmind.ai is not a zone there, so a `hub.meldmind.ai` route would fail the deploy.

To move to hub.meldmind.ai later: add meldmind.ai as a zone in Cloudflare, change the two lines as the comment in `wrangler.jsonc` shows (keep `hub.everbornproductions.com` as a second route so installed apps that use it keep working), set `DEFAULT_HUB_URL` in `server/hub-address.js` and `CC_HUB_URL` in `fly.toml` to the same address, update the Supabase redirect URLs, and run `tools\deploy-hub.ps1` again. The Worker reads the address from `CC_HUB_URL` (the schedule tick in `worker/hub-clock.js`), and the desktop app's usage ping default comes from `server/hub-address.js`, so nothing else hard-codes the host.

The appId (`com.everborn.command`), the updater feed (`everbornproductions-stack/command-center-releases`, `latest.yml`), the installer names (`Meldmind-Setup-<version>`) and `CC_OWNER_EMAILS` are unchanged. Moving the hub address does not move existing desktop installs.

## Status (end of 2026-10-18 build)

| Piece | State |
|---|---|
| Per-user server (`CC_MODE=hosted`) | Built. Boots, serves the sign-in gate, rejects every data route without a valid Supabase token, writes nothing to `data/`. |
| Local mode | Verified unchanged: demo council + mission, learned skills, price override, project edit, demo toggle, QR all work against a copy of `data/`. |
| Cloud vault (AES-256-GCM, `user_secrets`) | Verified 2026-10-18 11:46: three demo keys stored as ciphertext for Chris's account; the hub decrypted them to run the council. |
| Supabase tables (`supabase/hosted.sql`) | Applied 2026-10-18 by the main session through Chris's Chrome ("Success. No rows returned"). |
| Sign-in end to end, key save, demo council landing in Supabase | **Verified 2026-10-18 11:46** on the local hosted hub (port 3000) against the real project: Chris signed in with the magic link, demo mode on, council ran; Supabase shows user_docs 8 rows, user_secrets 3, user_ledger 8, user_missions 1 (council c-mve6fmay, done); the hub wrote nothing under data/. |
| Dockerfile, Worker + wrangler.jsonc (Cloudflare), fly.toml (fallback), health check, runbook | Written. Not deployed. Cloudflare Containers can run the server as is; nothing blocks it (see runbook). |
| Phone pairing (hub address + QR) | Built, in Settings → Phone & other devices. |

## Plan (as executed)

1. **Two modes, one code base.** `CC_MODE=hosted` (with `CC_SUPABASE_URL`, `CC_SUPABASE_ANON_KEY`, `CC_MASTER_KEY`) switches the server to hosted mode. Without it the server is exactly what it was: one user, `data/` folder, DPAPI vault, no sign-in, `node server/index.js`.
2. **Per-user context** (`server/store.js`). Every module that kept module-level state (vault secrets, ledger entries, projects, subscriptions, skills, price overrides, discount rules, scheduled missions, health lights, settings, licence) reads it from the context of the current user, carried through Node's `AsyncLocalStorage`, so council/mission code kept its shape. Local mode has one context ("local") backed by `FileStore` (the `data/` folder, same file names as before). Hosted mode creates a context per Supabase user id on first request, backed by `SupabaseStore` (write-behind: memory is the source of truth for reads; writes are upserted asynchronously, coalesced per document).
3. **Sign-in** (`web/app.js`, `server/auth.js`, `server/hosted.js`). Hosted mode shows a gate: email → Supabase magic link (`POST /auth/v1/otp` with the publishable key, no SDK). Supabase redirects back with the session in the URL hash; the browser keeps it in `localStorage` (`cc.auth`), refreshes it itself (`/auth/v1/token?grant_type=refresh_token`), sends it as `Authorization: Bearer` on every API call and as the first WebSocket message (`{type:"auth", token}`). The server verifies each token with `GET /auth/v1/user` (cached ≤5 min, never past the token's own `exp`). Events on the bus carry the user id, so WebSocket fan-out is per user.
4. **Cloud vault** (`server/hosted.js`, `server/vault.js`). AES-256-GCM with a 32-byte master key from `CC_MASTER_KEY`, random 12-byte IV per row, AAD = `userId:provider` so a row copied between accounts does not decrypt. Blob layout `base64(iv | tag | ciphertext)` in `user_secrets.ciphertext`. Keys are decrypted into the user's in-memory context and only leave the server in requests to the provider. API responses carry masked keys only (`sk-a…b123`), as before. The env-var key fallback is disabled in hosted mode (it would leak one key to every user).
5. **Data tables** (`supabase/hosted.sql`): `user_docs(user_id, kind, data)` for settings/projects/subscriptions/skills/pricing/rules/scheduled/license, `user_ledger(user_id, ts, entry)`, `user_missions(user_id, id, kind, status, started_at, summary, data)`, `user_secrets(user_id, provider, ciphertext, key_version)`. RLS: owner only on all four; anon revoked. The hub calls PostgREST with the user's own token, so RLS is the security boundary and the hub holds no god key. Optional `CC_SUPABASE_SERVICE_KEY` makes the hub write with the service role (still scoped by `user_id` in code) so writes keep working after a user's token expires (long or scheduled missions).
6. **Licence per user** (`server/license.js`). Hosted: the tier is the `licenses` row on the signed-in email (existing RLS policy), `owner` if the email is in `CC_OWNER_EMAILS`, else `free`. Promo redemption and key activation keep working through the same RPCs.
7. **Hosted-only differences.** Setup wizard, browser-history scan, "open in Explorer", the HQ folder adapter and the Cloud-connection fields are local-PC features and are hidden/refused (`400`) on a hub. Demo mode is per user (the pretend providers register once per process; a user "has" them when a demo key sits in their vault). New hosted users start with one empty project and the three generic chat subscriptions instead of Chris's seeds.
8. **Deployment**: `Dockerfile` (node:24-alpine, `npm ci --omit=dev`) works on Cloudflare Containers and Fly alike. Primary: `worker/index.js` + `wrangler.jsonc` (Cloudflare). Fallback: `fly.toml`. Runbook below.
9. **Phone pairing**: the web app remembers a hub address (`localStorage` `cc.hub`, also set by `?hub=` or `#hub=`); Settings → *Phone & other devices* shows the address and a server-rendered QR (`/api/pair/qr.svg`, `qrcode-generator`, no CDN). CORS is enabled in hosted mode only, so a shell served elsewhere can call the hub with its bearer token.

## Request flow (hosted)

```
browser ──(Bearer token)──▶ hub /api/*  ──verify──▶ Supabase Auth /auth/v1/user
                                 │
                                 ├─ AsyncLocalStorage.run(userContext, route)
                                 │     reads: in-memory context (docs, ledger, secrets, health)
                                 │     writes: SupabaseStore → PostgREST (user token, RLS)
                                 └─ provider calls (Anthropic, OpenAI, …) with the user's decrypted key
browser ◀──(WebSocket, per-user events)── hub
```

## Environment variables (hub)

| Variable | Required | Meaning |
|---|---|---|
| `CC_MODE=hosted` | yes | switches to hosted mode |
| `CC_SUPABASE_URL` | yes | `https://ezbpstloczzdlcxwliwu.supabase.co` |
| `CC_SUPABASE_ANON_KEY` | yes | the publishable key (`sb_publishable_…`), safe in the browser |
| `CC_MASTER_KEY` | yes | base64 of 32 random bytes; **losing it loses every stored API key** (users re-paste them) |
| `CC_OWNER_EMAILS` | no | comma-separated emails that get the owner tier without a licence |
| `CC_HUB_URL` | no | public https address of the hub, shown in the pairing QR and used as the OAuth redirect on the hub |
| `CC_IDLE_EVICT_MIN` | no | minutes a hosted user can sit idle before their in-memory context is dropped (default 30). Ignored in local mode |
| `CC_SUPABASE_SERVICE_KEY` | no | service-role key; lets writes outlive a user's token, and lets the schedule tick load a user who is not already in memory (keep it only on the hub) |
| `CC_TICK_SECRET` | for schedules | shared secret for `POST /api/internal/schedules/tick`. Set with `npx wrangler secret put CC_TICK_SECRET`. Never written into `wrangler.jsonc` or git |
| `CC_METRICS_SECRET` | for the owner report | shared secret for `GET /api/metrics/report`. Set with `npx wrangler secret put CC_METRICS_SECRET`. Never written into `wrangler.jsonc` or git. The service key stays on the hub. |
| `PORT` | no | listen port (Fly sets 8080 via fly.toml; default 4747) |
| `CC_SSO_PROVIDERS` | no | `google,azure` shows "Continue with Google / Microsoft" on the sign-in page (Phase 24). Turn the providers on in Supabase Auth first; see docs/extras.md |
| `CC_LIVE_PRICING` | no | `off` keeps the built-in model prices instead of OpenRouter's daily list (Phase 24) |

Publishing sign-in (Google Drive, Instagram via Meta, HighLevel and Slack) returns to `http://127.0.0.1:<port>/` on the desktop. On the hub the redirect is built from `CC_HUB_URL` and must be https (`https://hub.everbornproductions.com/`). A non-https hub address is refused. Settings shows that exact redirect URL on each of the four connectors.

## Deploy runbook (Cloudflare Containers)

### Can Cloudflare Containers run this server as is? Yes.

Checked against the [Containers docs](https://developers.cloudflare.com/containers/) and the [`@cloudflare/containers` helper](https://github.com/cloudflare/containers):

| Concern | Finding |
|---|---|
| `child_process` (PowerShell for the DPAPI vault) | Local mode only; the container runs `CC_MODE=hosted` and never calls it. A real Linux container would allow it anyway. |
| `node:sqlite` (browser-history scan) | Local mode only; `/api/setup/*` returns 400 on a hub. Node 24 in the image has it regardless. |
| Long-lived WebSockets | The `Container` class proxies WebSocket upgrades to the container in both directions (`hub.fetch(request)`; the docs warn only that `containerFetch` does not do WebSockets, which the Worker here does not use). The UI reconnects automatically after any drop. |
| Outbound calls (Supabase, Anthropic, OpenAI, …) | Allowed; egress to North America/Europe has 1 TB/month included. |
| Memory | `lite` instance = 1/16 vCPU, 256 MiB. The server idles around 70 MB locally. Move to `basic` (1 vCPU, 1 GiB) if `wrangler tail` ever shows OOM restarts. |
| Durability | Instances can be stopped by platform events (host restarts) and are stopped on purpose after `sleepAfter` (15 min idle). All state is in Supabase, so a restart loses only a mission that was mid-flight (it shows as failed; re-run it). Off-peak scheduled missions run while the container is awake. Cron schedules wake it on time (see *Schedules on the hub*) and it sleeps again 15 minutes later. |
| Image build | `wrangler deploy` builds the image with **Docker on the PC** and pushes it to Cloudflare's registry. Docker Desktop (free for personal use) must be installed and running once. |

### Real monthly cost (October 2026, [Cloudflare pricing](https://developers.cloudflare.com/containers/pricing/))

| Item | Cost |
|---|---|
| Workers Paid plan (required for Containers) | **$5.00/month** flat, card required |
| Container usage included in the plan | 25 GiB-hours memory, 375 vCPU-minutes, 200 GB-hours disk per month |
| Hub on `lite` with 15-minute sleep, used a few hours a day | inside the included allowance → **$0 extra** |
| Each schedule run | wakes the container for the run plus 15 minutes. An hourly schedule all month is about 46 GiB-h, roughly $0.30 extra; a daily one is free |
| Hub if it never sleeps (always awake, worst case) | memory 0.25 GiB × 730 h = 182 GiB-h, 157 over → ≈ $1.41; disk ≈ $0.30; CPU pennies → **≈ $1.75 extra** |
| R2 for the installer | 10 GB storage, 1 M writes, 10 M reads per month free, **no egress fee** → $0 at this scale |
| DNS, TLS, `hub.everbornproductions.com` and `downloads.` | $0 (zone already on Cloudflare) |
| **Expected total** | **$5/month; $7 at the very worst** |

Overage rates if ever exceeded: $0.0000025 per GiB-second memory, $0.000020 per vCPU-second, $0.00000007 per GB-second disk, $0.025 per GB egress beyond 1 TB.

### The one command

```powershell
cd $HOME\Desktop\Everborn\everborn-hq\command-center
powershell -ExecutionPolicy Bypass -File tools\deploy-hub.ps1 -WhatIf   # prints every step, runs nothing
powershell -ExecutionPolicy Bypass -File tools\deploy-hub.ps1           # the real deploy
```

`tools/deploy-hub.ps1` checks Docker Desktop is installed and running (starts it and waits up to 3 minutes), checks `npx wrangler@latest whoami` and runs `wrangler login` if you are not signed in, asks you to confirm Workers Paid is on (`-Yes` skips the question; nothing is bought), lists the secrets the Worker already has (names only), runs `wrangler deploy`, then sets only the missing secrets:

| Secret | Where the value comes from |
|---|---|
| `CC_MASTER_KEY` | 32 random bytes (base64) generated in memory and written straight to `wrangler secret put` on stdin. Never printed, never on disk. An existing one is never replaced (a new key loses every stored API key; users would re-paste them). |
| `CC_TICK_SECRET` | 32 random bytes (hex), the same way. |
| `CC_SUPABASE_ANON_KEY` | `server/cloud-defaults.json` `anonKey` (empty in git), else the `CC_SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY` variable, else a hidden prompt. A pasted `sb_secret_` key is refused. |
| `CC_SUPABASE_SERVICE_KEY` | You paste it at a hidden prompt (`Read-Host -AsSecureString`). Supabase > Project Settings > API keys > secret. |

Last it calls `https://<hub>/api/health` (retries for up to 3 minutes while the container starts) and prints the answer. If the deploy fails it says whether it looks like the plan (Workers Paid off), Docker, or the hub address (route not in a zone). Any secret value in wrangler's reply is replaced with `***` before it is printed.

Manual equivalent, if you ever need it (each `secret put` prompts for the value):

```powershell
npx wrangler@latest login
npx wrangler@latest deploy
npx wrangler@latest secret put CC_MASTER_KEY             # base64 of 32 random bytes
npx wrangler@latest secret put CC_TICK_SECRET            # any long random string
npx wrangler@latest secret put CC_SUPABASE_ANON_KEY      # sb_publishable_...
npx wrangler@latest secret put CC_SUPABASE_SERVICE_KEY   # Supabase secret key
curl https://hub.everbornproductions.com/api/health      # {"ok":true,"mode":"hosted",...}
npx wrangler@latest tail                                 # live logs
```

Non-secret settings (`CC_SUPABASE_URL`, `CC_HUB_URL`, `CC_OWNER_EMAILS`) are already in `wrangler.jsonc` under `vars`; change them there and redeploy. `CC_OWNER_EMAILS` stays `everbornproductions@gmail.com`. The DNS record for the hub address is created by the `routes` entry (`custom_domain: true`); nothing to add by hand in DNS. The Worker name in that file is `meldmind-hub`. Secrets (`CC_MASTER_KEY`, `CC_SUPABASE_ANON_KEY`, `CC_SUPABASE_SERVICE_KEY`, `CC_TICK_SECRET`) are never written into `wrangler.jsonc`. `CC_METRICS_SECRET` (owner report) is optional and set by hand with `secret put` when wanted.

Then, once, in the Supabase dashboard:

1. **SQL editor → run `supabase/hosted.sql`** (creates the four tables and their RLS). Already loaded in the editor in the Claude browser pane on 2026-10-18; it only needs Run.
2. **Authentication → URL configuration**: Site URL = `https://hub.everbornproductions.com`; add `https://hub.everbornproductions.com/**` to Redirect URLs. (The magic link only returns to listed addresses; anything else falls back to the Site URL, which today is the default `http://localhost:3000`.) Add `http://localhost:3000/**` too if you want to keep testing hosted mode on the PC.
3. Optional: Authentication → Email templates → Magic Link: put "Everborn Command" in the subject.

Open `https://hub.everbornproductions.com`, enter your email, open the link from the email on the same device, you are in. Settings → *Phone & other devices* shows the QR to scan with the phone.

### Installer download on R2 (downloads.everbornproductions.com)

```powershell
npx wrangler@latest r2 bucket create everborn-downloads
npx wrangler@latest r2 object put everborn-downloads/Everborn-Command-Setup-0.1.0.exe --file "dist\Everborn Command Setup 0.1.0.exe" --content-type application/octet-stream
```
Dashboard → R2 → `everborn-downloads` → Settings → **Custom Domains → Connect domain** → `downloads.everbornproductions.com` (Cloudflare adds the DNS record and TLS). The file is then at `https://downloads.everbornproductions.com/Everborn-Command-Setup-0.1.0.exe`; put that URL in `release/latest.json` (and the copy on the website) so the in-app update banner points at it. Each new version: `r2 object put` again with the new file name, bump `latest.json`. Large files upload fine through wrangler (multipart); R2 has no 25 MB cap.

### Operating notes

- Check the Worker without Docker: `npx wrangler@latest deploy --dry-run --containers-rollout=none --outdir <temp folder>` bundles the Worker and prints the bindings and vars; nothing is uploaded. Plain `--dry-run` stops because it builds the image with Docker even in dry-run mode (checked 2026-10-30, wrangler 4.156).
- `wrangler secret put` and `wrangler deploy` both roll the Worker; the container restarts on the next request. Logs: `npx wrangler tail`. Stop everything: delete the Worker in the dashboard (the plan stays until downgraded).
- `sleepAfter` is 15 minutes in `worker/index.js`. The 15-minute cron does not keep the container awake: it only reads one stored time in the Durable Object (see *Schedules on the hub*). Before 2026-10-30 the cron ran every 5 minutes and always woke the container, so it never slept (the always-on row in the cost table, about $1.75 extra). The Fly fallback does not run this cron.
- Supabase free projects pause after 7 days without database activity; a hub with any sign-in keeps it awake, and Pro ($25/month) removes pausing. The hub does not need Supabase Pro for anything else.
- Master-key rotation: decrypt with the old key, re-encrypt with the new, bump `key_version` (not automated; users can also just re-paste keys).
- Memory: each loaded user holds their last 35 days of ledger plus docs in RAM. In hosted mode a user who has been idle for `CC_IDLE_EVICT_MIN` minutes (default 30) is dropped from memory after any waiting cloud writes are flushed. They are not dropped while they have a running mission, council, chat or media job, an open WebSocket, a queued off-peak mission, or a write that has not finished. The next request loads them again from Supabase. Local mode keeps its one context and never evicts.

### Schedules on the hub

The container sleeps 15 minutes after the last request and is woken only when a schedule is due. The logic is in `worker/hub-clock.js` (no Cloudflare imports, tested by `test/hub-clock.test.js`); the Durable Object `Hub` in `worker/index.js` wires it up:

1. **The tick.** Starting the container and POSTing `<CC_HUB_URL>/api/internal/schedules/tick` with the header `x-cc-tick-secret` (value `CC_TICK_SECRET`, a wrangler secret) runs `schedules.tick()` for every user with a due cron slot, in memory or only in Supabase (`CC_SUPABASE_SERVICE_KEY` loads the latter). The reply also carries `nextDue`: the earliest slot still to come for anyone. The route answers 401 when the header is missing or wrong, and 404 in local mode.
2. **The wake-up.** The Durable Object stores `nextDue` and sets one alarm for that minute (`Container.schedule`, which does not start the container by itself). When the alarm fires it runs the tick, which stores the next time and sets the next alarm.
3. **Schedule changes.** When a request on the hub creates, edits, pauses, resumes or deletes a schedule, the server adds that user's earliest next slot as the response header `x-cc-next-due`. The Durable Object moves the alarm earlier if needed (never later) and removes the header before the response leaves Cloudflare, so the browser never sees it.
4. **The cron (`*/15 * * * *`).** A safety net that reads storage only. It ticks (and so starts the container) only on the first run, once a day to re-read every schedule from Supabase, or when an alarm is more than 2 minutes late. Otherwise it makes sure the alarm is set and leaves the container asleep.
5. **Failures.** If a tick fails (no `CC_TICK_SECRET`, a 401 or 404, or the container did not start), the next try is an hour later, never every 15 minutes, so a broken setup cannot keep the container awake.

A slot is claimed before the run starts, so a second tick does not run it again. A slot older than the 5-minute lookback is not replayed (the alarm starts the container at the slot's minute, well inside it). Spend caps and the Approve click are unchanged: a result that is sent out still waits until you click Approve. Webhooks work on the hub too. A watched folder stays on the desktop app. Desktop schedules still run only while the app is open; local mode keeps its own timer and does not call the tick route.

Trade-off: each run keeps the container awake for the run plus 15 minutes (the `sleepAfter` window), so many frequent schedules cost a little more (an hourly schedule is roughly $0.30/month extra). The worst case is still the always-on row in the cost table.

## Report-back relay

An AI that was handed a job can POST the outcome to this server at `POST /api/handoff/:jobId/done`. The desktop does not open a port for that. It polls the hub with `CC_WORKER_URL` and `CC_WORKER_TOKEN` (outbound only).

Operators point `CC_WORKER_URL` at the running hub. The live relay address is `https://meldmind-hub.fly.dev`. That variable is not given a default in the app, so a machine with it unset never calls out. `CC_HUB_URL` stays `https://hub.everbornproductions.com` for pairing and OAuth. This relay does not change that address.

The hub only relays. Each job and its one-time token are scoped to the worker token of the account that created the job, stored as a hash. Only that account's app can read the inbox. The per-job token can post a result and cannot read one. The result is deleted when that app acknowledges it, or after 7 days. The store is memory only: no disk, no database, and no admin view of the contents. The log line is `report-back <job id> <status>` and never includes the summary, the links, the files, or either token.

A self-hosted or local app with no hub does not advertise a callback address. The prompt tells the other AI to reply with `DONE: <summary>`, and the person uses Paste result.

### Fallback: Fly.io (not chosen)

Same `Dockerfile`; `fly.toml` is in the folder. Its public address is the same route, `https://hub.everbornproductions.com` (`CC_HUB_URL` in `[env]`). The Fly app name stays `everborn-command` (that is the fallback app, not the Cloudflare Worker). Cost: one `shared-cpu-1x` 256 MB machine is $0.0027/hour ≈ $1.94/month always on, less with auto-stop, no free tier for new accounts ([Fly pricing](https://fly.io/docs/about/pricing/)). Commands: `fly launch --no-deploy --copy-config --name everborn-command --region sjc`, `fly secrets set …`, `fly deploy`. Cheaper than Cloudflare by about $3/month, but outside the Cloudflare account Chris already runs everything in. Point the hub DNS record at Fly only if you are using this fallback instead of Cloudflare.

## Teams and shared workspaces (Studio tier, Phase 8)

Files: `supabase/workspaces.sql` (migration file only; Chris runs it in the Supabase SQL editor after review, it was never run by an agent), `server/plugins/workspaces.js`, `web/features/workspaces.js`, tests in `test/workspaces.test.js`. Gate: `licenseState().tier` must be `studio` or `owner` to create or change a workspace (402 otherwise). Reading, joining and switching are open, so a Free-tier invitee can still see what was shared with them.

Roles: **owner** (everything, including delete), **admin** (invite and remove members and viewers, change their roles, share projects, rename, see everyone's usage), **member** (sees shared projects; calls made while the workspace is active count toward it), **viewer** (read-only). The permission table is `PERMISSIONS` in the plugin and is mirrored in RLS through `ws_role()` / `ws_can_manage()`.

| Table | Purpose | Who may read / write (RLS) |
|---|---|---|
| `workspaces` | id, owner, name | owner: all; admin: rename; active member: read |
| `workspace_members` | invited email, role, invite hash, expiry, user id once joined, status | owner: manage all; admin: manage members and viewers; invitee: read own row, joins only through `ws_accept_invite()` / `ws_join_by_email()` (no direct UPDATE, so nobody can promote themselves) |
| `workspace_projects` | snapshot of each shared project (name, categories, links) | owner and admins: write; members and viewers: read |
| `workspace_usage` | calls and cost per member per month | owner and admins: read all; others: own; writes only through `ws_add_usage()` (viewers are not counted) |

Invites: the owner or an admin enters an email and a role; the app returns an invite link `https://<hub>/#join=<code>` once and stores only the SHA-256 hash of the code. Nothing is emailed; the person who invites sends the link. The link works only for the invited email and expires after 14 days ("new link" makes a fresh one). Signing in with an invited email also activates the invite.

Switcher: the header shows "Workspace: Personal / <name> (role)". AI calls made while a workspace is picked are counted toward it (local mode: in the `workspaces` document; hosted: batched every 20 s through `ws_add_usage()`).

Local mode (desktop, offline): the owner side works fully on this PC (create, invite, roles, share, usage of your own calls). Teammates can only join through the hosted hub.

Verified 2026-10-18 by tests (local mode, demo AIs). Hosted mode against the real tables is not verified: it needs `workspaces.sql` applied and a second signed-in email.

### Shared agents and prompts (Phase 19)

File: `supabase/agents.sql` (migration file only, run after `workspaces.sql`; never run by an agent). Table `workspace_agents`: a snapshot of each agent or saved prompt someone shared into a workspace (text only, never a key). RLS through `ws_role()`: everyone in the workspace reads; owner, admin and member share their own and update or remove what they shared; owner and admin update or remove anything; a viewer only reads (the server also refuses a viewer's run and copy). Sharing needs Studio, like the workspaces. Each person's own agents and prompts stay in `user_docs` (`agents.custom`, `agents.prompts`). Tested against a local stand-in for Supabase (`test/agents.test.js`), not against the real tables.

## Verify locally (what was done and what is left)

Done against the real project on 2026-10-18: hosted server boots with the real URL and publishable key, `/api/health` and `/api/config` answer, `/api/state` returns 401 without a token and with a malformed token, local-PC routes return 401/400, CORS preflight answers, the sign-in gate renders at `http://localhost:3000`, and `data/` is not created or written (`CC_DATA_DIR` pointed at a folder that still does not exist).

Left (needs Chris): click **Run** on the loaded SQL; then on the gate at `http://localhost:3000` request a sign-in link for `everbornproductions@gmail.com` and open it on this PC. After that Claude can: save a key, run a demo council, and confirm rows in `user_secrets`, `user_docs`, `user_ledger`, `user_missions` in the Table editor. The local test hub was started with `PORT=3000` on purpose because Supabase's default Site URL is `http://localhost:3000`, so the magic link returns there without touching the URL configuration.
