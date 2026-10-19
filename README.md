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
7. **Subscriptions**: every paid AI service on one page. AI providers with credits left and month-to-date spend (live from OpenRouter, DeepSeek and, with an optional admin key, the OpenAI and Anthropic cost reports; otherwise from the ledger), tied to the spend caps. Subscriptions with price per cycle, next renewal, a reminder N days before (default 3), credits, burn per day, runway, and a signal (ok / renewing / low / attention). Prices seeded as UNKNOWN until you confirm them.

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
| Guided API-key setup: one provider at a time, where to get the key, paste, a test call, then the vault; a refused key is never kept; keys never logged or shown again | Settings → Guided API-key setup, last stop of the tour |
| Live web search with cited sources: Tavily, Brave Search or Serper with your own key, or the model's own search (Perplexity, Grok); "Search the web" toggle per Single, Council and Mission (off by default); numbered results in the prompt, clickable [1] [2] source chips under the answer; every search in the ledger with its cost, monthly caps; demo mode uses a pretend engine | Command (toggles), Settings → Web search |
| MCP tools: add Model Context Protocol servers (a local command, or a remote Streamable HTTP / SSE server with headers or OAuth sign-in); enable their tools per workspace; any tool-calling AI can use them through the local server; tools that write, send or delete ask for your OK each time, read-only tools can run without asking when you allow it; secrets in the vault; a demo tools server for trying it without a key | Settings → Tools, approval prompts in Command |
| Smart fallback: a job never fails because one AI is out of credits, rate limited, refusing its key or unreachable; that AI is skipped for new work and comes back on its own after the next good health check, the same model is retried through OpenRouter first when you have a key there, then the next-best model for the job takes over; the feed and the deliverable say who stood in and why; small jobs use a free tier you have (Gemini, OpenRouter free route, Groq) within its allowance; every call in the ledger, inside the spend caps | automatic; Settings → Smart fallback, chips under the deliverable |
| Learning router: every chat, council and mission teaches the router which model is best at which task type for the price, per user (council scores and wins, your thumbs, QA scores, cost per job, speed, failures; never prompts, answers or keys); picks start from the built-in scores and follow your own track record as it grows; a "Who's best at what" view per task type with win rate, average score, cost per job, speed and how many jobs it rests on; learning on/off, export, reset; an opt-in for sharing anonymous totals later (off by default, nothing is sent in this version) | automatic; Who's best tab |
| Subscriptions and services: one page for every paid AI service; credits left and month-to-date per AI provider, live where an API exists (OpenRouter credits and key, DeepSeek balance, OpenAI and Anthropic cost and usage reports through an optional admin key in the vault), else from the ledger, amber / red with the spend caps; an optional read-only Gmail or Outlook connection finds receipt and renewal emails (Google AI Pro / Ultra, Kling, Suno, ChatGPT Plus, Claude Max, Midjourney, ElevenLabs and more) and suggests rows with a confidence and a link to the email, saved only after you confirm or edit (only the extracted fields and the message id are kept); manual add and edit; renewal reminders N days ahead per row; monthly total across APIs and subscriptions; "possible duplicate or unused" hints; every value labelled auto-detected (API, ledger or email with confidence) or entered by you; sample emails for demo mode | Subscriptions tab |
| Grok Bot agent: your own assistant (signed-in browser, Gmail, Drive, Calendar, teammate bots) joins councils and missions for the parts that need those, never for plain text work; webhook URL and sender key in the vault (header name optional, default Authorization: Bearer); results come back to a one-time callback address per job, or you paste them in by hand until Grok Bot can reach the app; its answers are scored next to the other AIs; Auto / Always / Never per run; a built-in mock for demo mode; Grok Bot and Browser helper cards on the hub with a status light and activity feed (see docs/grokbot.md) | Settings → Integrations → Grok Bot, Agents panel in Command |
| Built-in browser helper, for people without Grok Bot: the cheapest capable AI drives a browser window inside the desktop app (its own session, never your main browser profile) one step at a time by reading the page, with an action log and a Stop button; Gmail and Google Drive through your own Google sign-in (read-only by default, sending only when you tick it); it asks for your OK before any send, post, delete, purchase or form submit and shows exactly what will happen; never types passwords (you sign in yourself in its window), never fills in card details, never opens Square or billing pages; joins councils and missions for the parts that need a website, Gmail or Drive, scored next to the other AIs; every AI call in the ledger; a demo page and a text reader when there is no desktop window (see docs/browser-helper.md) | Settings → Integrations → Browser helper, Browser helper panel in Command |
| Organize my bookmarks: sorts the bookmarks you already have (Chrome, Edge, Brave, and Firefox as an import file) into folders by topic, named by an AI you pick with your own key (an estimate first, in the ledger, inside the caps); read only after you pick the browser and click allow; titles and addresses go only to that AI, with anything after ? or # cut off; a preview where you rename folders, move or untick bookmarks and tick duplicates to merge; apply only with the browser closed (a running browser is detected and refused), the original backed up next to the file and in the app data folder, one-click Undo; nothing deleted except duplicates you ticked; sample bookmarks in demo mode | Setup (next to the AI bookmark folder), Settings → Organize my bookmarks |
| Side-by-side comparison: one prompt to 2 to 6 models you pick, answers streaming into parallel columns, each with its cost, time to first words and total time; an estimate before you click Compare; exactly the models you picked (no stand-ins), an AI without a key or at its monthly spend cap is skipped with a note; every call in the ledger (role compare); "Pick winner" is a thumbs-up the router learns from; save model sets and reuse them; works with the demo AIs | Compare tab |
| Knowledge libraries: build a library from uploaded files and folders, a folder on this PC, Google Drive files and folders, or Notion pages (Drive and Notion through your own read-only sign-in: drive.readonly only, Notion read endpoints only); text, Markdown, CSV, JSON, code, HTML, Word and text PDFs; passages embedded with the embedding model you pick per library (OpenAI, Gemini, Mistral, a custom OpenAI-compatible provider such as Ollama, or the demo embedder), stored on this PC (one SQLite file per library, keyword index plus vectors); an estimate before indexing, every embedding call in the ledger (role embed), refused at the spend cap; hybrid search (keywords and meaning), each half also on its own; attach a library to a chat (per project), a workspace or an agent and Single, Council and Mission add the best passages, cited as [L1], [L2] chips that open the passage; a question falls back to keyword search when the embedder is capped or down; delete a library and its index file goes; desktop only for now | Libraries tab, chip row in Command, Settings → Library sources |
| Custom agents and a prompt library: name an agent, pick its model (or Auto), write its instructions, choose which tools it may use (none, every tool you switched on, or a chosen few; writes still ask first) and which knowledge libraries it reads, add starter prompts, and run it as a chat with your own keys (ledger, spend caps and smart fallback as usual); saved prompts with {{variables}} ask for every value in a small form before sending; export and import agents and prompts as one JSON file (no keys in it); share them with a workspace, where members can run or copy them and viewers can only look; save a Marketplace listing draft (nothing is published, no price) | Agents tab, saved prompts row in Command |
| Schedules: run an agent, a chat or a mission on a cron schedule, from a webhook (its own secret token, shown once, 401 without it) or when a new file lands in a watched folder; run history; a monthly spend cap per schedule (it pauses and alerts you when reached); a result that is sent to a web address waits in "Needs your approval" until you click Approve; desktop schedules only run while the app is running (the tray counts), always-on schedules need the hosted hub later (see docs/schedules.md) | Schedules tab |
| Artifacts side panel: web pages, mini apps, charts (bar, line, pie from a small JSON spec), SVG, Markdown, JavaScript and Python from an answer open in a side panel and run in a sandbox (no access to the app, your keys or files, and no network unless you tick Allow internet, which opens https: only); every edit is a new version and old ones stay; re-run, preview an unsaved edit, export any version as a file; Python through Pyodide, downloaded only when you click Run Python | Artifacts tab, "Open in artifacts" under the deliverable, Settings |
| Quick launcher: a global shortcut (default Alt+Space, your choice) opens a small box over any app; Enter sends it to a Chat or Council here; a shortcut Windows or another app already holds is never taken, and it is released on quit (see docs/extras.md) | desktop app, Settings > Quick launcher, tray |
| Chrome / Edge extension: right-click or the popup sends the page, a selection or a link to Command AI on this PC only (host permissions 127.0.0.1 / localhost), paired with a code shown once; by default it waits in Marching orders until you press Send, or it asks a chat or council right away | `extension/` (Load unpacked), Settings > Browser extension |
| Live model prices: list prices from the OpenRouter models API once a day (no key), feeding the router, the ledger estimates and the savings receipts; your own price always wins | Settings > Model prices |
| Team SSO and workspace keys: "Continue with Google / Microsoft" on the hosted hub (through Supabase Auth), a per-workspace rule "sign in with Google or Microsoft at these domains"; API keys per workspace, used only while that workspace is active (vault on the desktop, encrypted per workspace on the hub, viewers use their own) | hub sign-in page, Settings > Team sign-in, Settings > Workspace API keys |
| Pipelines: saved missions with the steps pre-decided (Instagram week, music video from a song, client site launch; save your own from any mission) | Pipelines tab |
| Rate the result: thumbs up/down per AI under every deliverable, feeds the router | under the deliverable |
| Project memory: brand voice, offers, never-say list, facts; injected into every prompt for that project; import from HQ client files | Settings → Project memory |
| Savings receipt: this run vs all-on-the-flagship, with a PNG export for Reels; running total in Command | under the deliverable |
| Media actions: video, image and voice through Kling, ElevenLabs, Runway and fal.ai, from the Media tab or as a step in a mission; the estimate comes first and Generate (or Approve on a mission's media step) repeats it, so nothing spends without that click; spend caps checked before any call; one ledger line per paid job; the file is saved to the project and added to the mission; without a key it is a dry run that saves a placeholder | Media tab, "Media from this mission" under the deliverable, Settings → Media API keys |
| Chat with files: drop PDFs, Word files, text or images into a project, see what will be read and what it costs, then Add to project; the project gets its own library (passages stored per project), attached to its chats, councils and missions, cited as [L1], [L2]; images are saved to the project and described once by an AI that can see them (OpenAI, Anthropic or Gemini with your key, the pretend AI in demo mode); remove a file and its passages go; desktop only for now | Files in this project, in Command |
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

Media generation from inside the console (Kling/Runway/ElevenLabs API calls), Electron packaging and installer, accounts/licensing, cloud sync, OpenRouter cost pass-through from `usage.cost`, always-on schedules (desktop schedules exist; see docs/schedules.md).

## Hosted hub (phone, PC off)

The same server runs as a hub in the cloud so the console works from a phone or any browser while the PC is off. Set `CC_MODE=hosted` plus `CC_SUPABASE_URL`, `CC_SUPABASE_ANON_KEY` and `CC_MASTER_KEY` and the server switches to: email sign-in (Supabase magic link), one data context per signed-in user, API keys encrypted with AES-256-GCM and stored in Supabase (`user_secrets`), everything else in `user_docs` / `user_ledger` / `user_missions`, nothing written to `data/`. Local single-user mode is unchanged and remains the default. Tables: `supabase/hosted.sql`. Container: `Dockerfile` + `fly.toml`. Architecture, costs and the deploy runbook: **docs/hosted-hub.md**.

Deployment target (Chris, 2026-10-18): Cloudflare Containers at command.everbornproductions.com (Workers Paid, $5/month); `worker/index.js` + `wrangler.jsonc`. Fly.io config kept as a fallback.

Pairing: Settings → *Phone & other devices* shows the hub address and a QR code; scanning it opens the hub on the phone, where it installs as an app. The web app also accepts `?hub=https://your-hub` to point at a different hub and remembers it.
