# Hosted hub (2026-10-18)

Goal: the command center runs as a hub in the cloud so Chris, and later every subscriber, can use it from a phone or any browser with the PC off. Local single-user mode stays the default and is unchanged.

## Decision from Chris (relayed 2026-10-18, updated the same afternoon)

First call: free or cheapest host. Updated call: **everything under Cloudflare**, which already runs the Everborn sites and DNS. So: Cloudflare Containers on the Workers Paid plan ($5/month) running the existing Node 24 image, a thin Worker in front (also carries the WebSocket), hub at **command.everbornproductions.com** through Cloudflare DNS, the Windows installer served from **R2** at downloads.everbornproductions.com (Pages caps files at 25 MB; the installer is 112 MB). Supabase stays the database and auth (no D1 migration). Chris runs the plan upgrade and the deploy himself. Fly.io stays documented as the fallback only.

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
| `CC_HUB_URL` | no | public address of the hub, shown in the pairing QR |
| `CC_SUPABASE_SERVICE_KEY` | no | service-role key; lets writes outlive a user's token (keep it only on the hub) |
| `PORT` | no | listen port (Fly sets 8080 via fly.toml; default 4747) |

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
| Durability | Instances can be stopped by platform events (host restarts) and are stopped on purpose after `sleepAfter` (15 min idle). All state is in Supabase, so a restart loses only a mission that was mid-flight (it shows as failed; re-run it). Off-peak **scheduled** missions only fire while the container is awake. |
| Image build | `wrangler deploy` builds the image with **Docker on the PC** and pushes it to Cloudflare's registry. Docker Desktop (free for personal use) must be installed and running once. |

### Real monthly cost (October 2026, [Cloudflare pricing](https://developers.cloudflare.com/containers/pricing/))

| Item | Cost |
|---|---|
| Workers Paid plan (required for Containers) | **$5.00/month** flat, card required |
| Container usage included in the plan | 25 GiB-hours memory, 375 vCPU-minutes, 200 GB-hours disk per month |
| Hub on `lite` with 15-minute sleep, used a few hours a day | inside the included allowance → **$0 extra** |
| Hub if it never sleeps (always awake, worst case) | memory 0.25 GiB × 730 h = 182 GiB-h, 157 over → ≈ $1.41; disk ≈ $0.30; CPU pennies → **≈ $1.75 extra** |
| R2 for the installer | 10 GB storage, 1 M writes, 10 M reads per month free, **no egress fee** → $0 at this scale |
| DNS, TLS, `command.` and `downloads.` subdomains | $0 (zone already on Cloudflare) |
| **Expected total** | **$5/month; $7 at the very worst** |

Overage rates if ever exceeded: $0.0000025 per GiB-second memory, $0.000020 per vCPU-second, $0.00000007 per GB-second disk, $0.025 per GB egress beyond 1 TB.

### Steps (Chris runs these in PowerShell from `everborn-hq\command-center`; none were run by Claude)

```powershell
# 0. One time: Docker Desktop (wrangler builds the image with it) and the Workers Paid plan
winget install Docker.DockerDesktop        # then start Docker Desktop once and let it finish
# Cloudflare dashboard → Workers & Pages → Plans → Workers Paid ($5/month)

# 1. Sign in to Cloudflare from the terminal
npx wrangler@latest login

# 2. Generate the master key once; keep a copy in 1Password (it is not recoverable later)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 3. Secrets (each command prompts for the value; paste it)
npx wrangler@latest secret put CC_MASTER_KEY             # the base64 from step 2
npx wrangler@latest secret put CC_SUPABASE_ANON_KEY      # from data/settings.json → cloud.anonKey (sb_publishable_…)
# optional: npx wrangler@latest secret put CC_SUPABASE_SERVICE_KEY   (Supabase → Project Settings → API keys → secret)

# 4. Deploy: builds the Dockerfile with Docker, pushes the image, publishes the Worker, creates the DNS record
npx wrangler@latest deploy

# 5. Check
curl https://command.everbornproductions.com/api/health   # → {"ok":true,"mode":"hosted",...}  (first call wakes the container, ~5-10 s)
npx wrangler@latest tail                                   # live logs
```

Non-secret settings (`CC_SUPABASE_URL`, `CC_HUB_URL`, `CC_OWNER_EMAILS`) are already in `wrangler.jsonc` under `vars`; change them there and redeploy. The DNS record for `command.everbornproductions.com` is created by the `routes` entry (`custom_domain: true`); nothing to add by hand in DNS.

Then, once, in the Supabase dashboard:

1. **SQL editor → run `supabase/hosted.sql`** (creates the four tables and their RLS). Already loaded in the editor in the Claude browser pane on 2026-10-18; it only needs Run.
2. **Authentication → URL configuration**: Site URL = `https://command.everbornproductions.com`; add `https://command.everbornproductions.com/**` to Redirect URLs. (The magic link only returns to listed addresses; anything else falls back to the Site URL, which today is the default `http://localhost:3000`.) Add `http://localhost:3000/**` too if you want to keep testing hosted mode on the PC.
3. Optional: Authentication → Email templates → Magic Link: put "Everborn Command" in the subject.

Open `https://command.everbornproductions.com`, enter your email, open the link from the email on the same device, you are in. Settings → *Phone & other devices* shows the QR to scan with the phone.

### Installer download on R2 (downloads.everbornproductions.com)

```powershell
npx wrangler@latest r2 bucket create everborn-downloads
npx wrangler@latest r2 object put everborn-downloads/Everborn-Command-Setup-0.1.0.exe --file "dist\Everborn Command Setup 0.1.0.exe" --content-type application/octet-stream
```
Dashboard → R2 → `everborn-downloads` → Settings → **Custom Domains → Connect domain** → `downloads.everbornproductions.com` (Cloudflare adds the DNS record and TLS). The file is then at `https://downloads.everbornproductions.com/Everborn-Command-Setup-0.1.0.exe`; put that URL in `release/latest.json` (and the copy on the website) so the in-app update banner points at it. Each new version: `r2 object put` again with the new file name, bump `latest.json`. Large files upload fine through wrangler (multipart); R2 has no 25 MB cap.

### Operating notes

- `wrangler secret put` and `wrangler deploy` both roll the Worker; the container restarts on the next request. Logs: `npx wrangler tail`. Stop everything: delete the Worker in the dashboard (the plan stays until downgraded).
- `sleepAfter` is 15 minutes in `worker/index.js`. Longer keeps the hub warm (faster phone opens, scheduled missions fire) at the cost of memory-hours; "always on" is about $1.75/month extra as computed above.
- Supabase free projects pause after 7 days without database activity; a hub with any sign-in keeps it awake, and Pro ($25/month) removes pausing. The hub does not need Supabase Pro for anything else.
- Master-key rotation: decrypt with the old key, re-encrypt with the new, bump `key_version` (not automated; users can also just re-paste keys).
- Memory: each loaded user holds their last 35 days of ledger plus docs in RAM; contexts are never evicted in this version (fine for a handful of users on 256 MiB; add idle eviction before selling widely).

### Fallback: Fly.io (not chosen)

Same `Dockerfile`; `fly.toml` is in the folder. Cost: one `shared-cpu-1x` 256 MB machine is $0.0027/hour ≈ $1.94/month always on, less with auto-stop, no free tier for new accounts ([Fly pricing](https://fly.io/docs/about/pricing/)). Commands: `fly launch --no-deploy --copy-config --name everborn-command --region sjc`, `fly secrets set …`, `fly deploy`. Cheaper than Cloudflare by about $3/month, but outside the Cloudflare account Chris already runs everything in.

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
