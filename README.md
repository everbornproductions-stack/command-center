# Command AI

*an Everborn product* by Everborn Productions. (Internal and repo name: Everborn Command Center / command-center.)

One console for every AI you pay for. Give marching orders once; the console picks the right AI for each part, lets them check each other's work, shows you who is working and who is talking to whom in real time, and keeps score of what everything costs.

Runs on your PC. Your API keys never leave it (sealed with Windows DPAPI, or the OS keychain through the desktop app on macOS and Linux). Zero markup: you pay the providers directly.

The local server only answers its own window: it binds 127.0.0.1, pins the `Host` and `Origin` headers to the loopback address, requires `application/json` on every write, and issues a fresh session token on each launch that the page must send with every API call and as the first WebSocket message. A web page you happen to visit cannot read your console or start work on your keys.

## Install on Windows (no Node needed)

Run **Command-AI-Setup-<version>.exe** from the `dist` folder (or the portable `.exe`, which needs no install). The app opens in its own window, keeps serving from the tray when the window is closed, and stores everything under `%APPDATA%\Everborn Command\data`. Windows SmartScreen will warn once because the build is not code-signed yet; choose "More info → Run anyway". Build it yourself with `npm run dist`.

## Run from source

```bash
cd everborn-hq/command-center
npm install
npm start
```

Open http://localhost:4747. Or double-click **Start Command Center.cmd** (installs once, starts the server, opens the browser). The browser pane in Claude Code can also start it (`command-center` in `.claude/launch.json`).

## First run: Setup wizard

On first launch the app opens **Setup**. Three opt-in steps, all local: scan browser history (Chrome / Edge / Brave) to list the AIs and creative tools you actually use, check for API keys already on the PC (environment variables), and build a "🤖 AI" bookmark folder from what was found (download as an import file, or add to the browser directly with a backup). For each AI it shows "Open key page" (opens the provider's key page), a paste box and Save. Media tools without an API get a "Track credits" button that adds them to Subscriptions. Re-run any time from Settings.

## First five minutes

1. **Settings → Demo mode** (checkbox): three pretend AIs come online so you can see everything work without spending a cent. Turn it off when you have real keys.
2. **Settings → paste API keys** for the AIs you use (Claude, ChatGPT, Grok, Gemini, Perplexity, OpenRouter, DeepSeek, Groq, Mistral). Each key is tested on save and the light in the status strip turns green.
3. **Command → Marching orders.** Type what you want. Pick how to run it:
   - **Single**: the router classifies the job and sends it to the best available AI for that kind of work.
   - **Council**: several AIs answer at once, review each other anonymously, a chair writes the verdict, and the router remembers who won at what.
   - **Mission**: a planner breaks the goal into tasks, each task goes to the best-fit AI (each AI can carry several sub-agents), a *different* AI QA-checks every deliverable and sends it back for one revision if needed, then an assembler compiles the result.
4. **Priority** (Quality / Balanced / Economy) changes how much the router weighs cost against quality. **Preview route** shows, before you spend anything, who would get the job, what it should cost, and whether a cheaper AI would do.
5. **Projects**: every project has categories (Website, Social Posts, Music Videos, CRM…) with clickable links to where the work actually lives (YouTube Studio, Instagram, GoHighLevel, Cloudflare…), plus the open HQ tasks and every AI run for that project.
6. **Credits**: API spend by day and by AI, "who's best at what" matrix (baseline + learned from councils), media credits log (Kling, Suno, Flow, Sync).
7. **Subscriptions**: what you pay, when it renews, credits left, burn per day, runway, and a signal (ok / renewing / low / attention). Prices seeded as UNKNOWN until you confirm them.

## The status strip

One tile per AI at the bottom. Light colours: **green** key works and no incident · **amber** incident on the provider's status page, slow, rate-limited or low balance · **red** key rejected, no credits, or provider error · **grey** no key saved. A tile pulses while that AI is working and shows how many sub-agents it is running. Media tools (Kling, Suno, Flow, Sync.so, Hedra, ElevenLabs) show credits left or the renewal date.

## How routing works (and how it saves credits)

- Every job is classified (capability × difficulty × needs-web) by the cheapest available model, with a keyword fallback.
- Each model has a baseline score per capability (`server/registry.js`). Council results adjust those scores over time (`data/skills.json`), so the router learns *your* winners.
- Score = quality for that capability minus a cost penalty. Economy mode weighs cost about 7× more than Quality mode.
- Missions get a dollar cap; if the plan's estimate exceeds it, every task drops to economy picks.
- If a provider fails mid-task, the task is re-assigned to the next-best AI from a different vendor.
- Prices live in `data/pricing.json` (editable in Settings) because providers change them.


## What else is in the box (built 2026-10-18)

| Feature | Where |
|---|---|
| Pipelines: saved missions with the steps pre-decided (Instagram week, music video from a song, client site launch; save your own from any mission) | Pipelines tab |
| Rate the result: thumbs up/down per AI under every deliverable, feeds the router | under the deliverable |
| Project memory: brand voice, offers, never-say list, facts; injected into every prompt for that project; import from HQ client files | Settings → Project memory |
| Savings receipt: this run vs all-on-the-flagship, with a PNG export for Reels; running total in Command | under the deliverable |
| Media actions: Kling, ElevenLabs, Runway, fal.ai through their APIs, estimate first, dry run without keys | Media tab, Settings → Media API keys |
| Posting hooks: Instagram (Graph API), GoHighLevel social planner, Drive-synced folder; preview + confirm on every post | under the deliverable, Publish tab |
| Weekly report: spend by AI, low credits, renewals, what shipped, keep/downgrade/cancel; Monday 07:00 or Run now; email via Resend | Reports tab |
| Spend caps + alerts: per-AI monthly cap, amber at 80%, hard stop at 100% (router skips it), renewal and red-light alerts; in-app, email, Web Push | Settings → Spend caps & alerts |
| Live-share link: read-only, expiring page mirroring one run for clients or recordings | under the deliverable |
| Voice orders: hold-to-talk mic on Marching Orders (Chrome, Edge, desktop app) | Command |
| Teams and shared workspaces (Studio tier): roles owner, admin, member, viewer; invite links (nothing emailed); share chosen projects; usage per member; workspace switcher in the header | Workspaces tab, header switcher |
| Pipeline marketplace | design only: docs/marketplace.md |

Features are plugins: `server/plugins/<id>.js` + `web/features/<id>.js` (see docs/plugin-api.md).

## Saving credits automatically

- **Off-peak scheduler**: pick "Off-peak" under *When* and the mission is queued for the next discount window (DeepSeek publishes 50% off outside its peak hours; rules are in `data/pricing-rules.json` and listed on the Credits tab). Preview route tells you when waiting would save 20% or more.
- **Balance-aware routing**: an AI whose prepaid balance is under $1 is skipped while another is available; amber health (incident, rate limit, slow) costs points in the ranking.
- **Exact costs**: OpenRouter reports the billed amount per call; the ledger uses it (✓ in Recent calls) instead of an estimate.

## Updates

The app checks `https://everbornproductions.com/command-center/latest.json` on start and every 6 hours (override with `CC_UPDATE_FEED`). When the version there is newer than `package.json`, a banner appears with the notes and a download link. To ship an update: bump the version, publish the new build, and upload `release/latest.json` with the new version, notes and URL. Electron packaging later turns the banner into a one-click install.

## Where things live

```
server/index.js        HTTP + WebSocket server, API routes
server/registry.js     providers, models, prices, capability baselines
server/providers.js    streaming adapters (Anthropic SDK; OpenAI-compatible for the rest)
server/router.js       classification, ranking, cheaper-route advice, learned skills
server/council.js      council mode
server/mission.js      mission mode (plan → assign → execute → QA → assemble)
server/health.js       status lights, balance checks, status pages, live model lists
server/ledger.js       usage ledger (data/ledger.jsonl)
server/subscriptions.js, server/projects.js
server/vault.js        key vault (data/vault.bin): Windows DPAPI; macOS/Linux via Electron safeStorage (Keychain / libsecret);
                       plain Node on macOS/Linux refuses to save keys (no base64 fallback)
server/mock.js         demo mode
server/discover.js     setup wizard: history scan, key detection, AI bookmark folder
server/update.js       update checker (release/latest.json is the feed template)
web/                   the UI (no build step)
data/                  your data: vault, ledger, projects, subscriptions, missions, pricing, skills
docs/                  market research, provider API research, product brief
```

The optional HQ adapter reads `<CC_HQ_DIR>/hq/state.json` (task board, decisions waiting on you) and `<CC_HQ_DIR>/studio/credit-log.csv` (Kling/Flow generations). It is only active when `CC_HQ_DIR` is set (a run from source also picks up a sibling `hq/` folder when one exists; installed builds never guess). New installs start with one empty project and three generic subscription rows; `docs/owner-seed.example.json` shows the import shape for a fuller set.

## Not yet built (see docs/product-brief.md)

Media generation from inside the console (Kling/Runway/ElevenLabs API calls), Electron packaging and installer, accounts/licensing, cloud sync, OpenRouter cost pass-through from `usage.cost`, scheduled missions.

## Hosted hub (phone, PC off)

The same server runs as a hub in the cloud so the console works from a phone or any browser while the PC is off. Set `CC_MODE=hosted` plus `CC_SUPABASE_URL`, `CC_SUPABASE_ANON_KEY` and `CC_MASTER_KEY` and the server switches to: email sign-in (Supabase magic link), one data context per signed-in user, API keys encrypted with AES-256-GCM and stored in Supabase (`user_secrets`), everything else in `user_docs` / `user_ledger` / `user_missions`, nothing written to `data/`. Local single-user mode is unchanged and remains the default. Tables: `supabase/hosted.sql`. Container: `Dockerfile` + `fly.toml`. Architecture, costs and the deploy runbook: **docs/hosted-hub.md**.

Deployment target (Chris, 2026-10-18): Cloudflare Containers at command.everbornproductions.com (Workers Paid, $5/month); `worker/index.js` + `wrangler.jsonc`. Fly.io config kept as a fallback.

Pairing: Settings → *Phone & other devices* shows the hub address and a QR code; scanning it opens the hub on the phone, where it installs as an app. The web app also accepts `?hub=https://your-hub` to point at a different hub and remembers it.
