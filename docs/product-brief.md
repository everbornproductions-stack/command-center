# Everborn Command Center: product brief (2026-10-17)

## One line

A desktop console that turns every AI you already pay for into one team: you give the orders once, the console picks who does what, the AIs check each other, you watch it happen live, and you always know what it cost and what is left.

## Why it can sell

The research (docs/market-research-2026-10-17.md) found nobody ships the full combination. Perplexity Computer ($200/mo), Abacus ChatLLM and Genspark each do part of it, all of them on resold credits, none with bring-your-own-key, none with media tools, none with a real project hub. The loudest complaints in this market are opaque credits, rate-limit anxiety, subscription sprawl and fear of key-harvesting GUIs. This product's answers:

| Complaint | Our answer |
|---|---|
| Opaque credits, charged for failures | Every call logged with tokens and dollars; failed and retried calls visible; no resold credits, zero markup |
| Rate-limit and balance anxiety | Status light per AI from real signals (status pages, your own latency/errors, balance APIs), amber before the wall |
| Subscription sprawl | Subscriptions tab with renewals, credits left, burn rate, runway, and a keep/watch/cancel signal |
| Key-harvesting fear | Keys sealed on the PC with Windows DPAPI, never sent anywhere but the provider; local-first, no Docker |
| "Council" tools only average the answers | Anonymous peer review, scoreboard, "where they disagreed", and the router learns who wins at what |
| Agent dashboards are single-vendor and developer-only | Cross-vendor live graph: nodes per AI, edges light up on hand-offs, sub-agent counts, task progress |
| Chat AIs and media AIs live in different worlds | Kling, Suno, Flow, Sync.so, Hedra, ElevenLabs in the same strip with their credits |

## What is built (v0.1, working today)

- Providers: Claude (official SDK), ChatGPT, Grok, Gemini, Perplexity, OpenRouter, DeepSeek, Groq, Mistral (OpenAI-compatible adapter). Media tiles: Kling, Suno, Google Flow, Sync.so, Hedra, ElevenLabs, Cursor, CapCut.
- Three run modes: Single, Council (answer → anonymous review → chair verdict → learning), Mission (plan → assign → parallel execution in dependency waves → QA by a different AI → one revision → assemble; failover to another vendor; dollar cap).
- Router: cheap classification, capability × cost scoring, three priority modes, "cheaper route" advice in plain English, learned skills matrix.
- Live ops: SVG agent graph with hand-off particles, task board with progress, live feed, status strip with health lights and "N working" badges.
- Credits: ledger of every call, 30-day spend chart, spend by AI, balance where the provider exposes one (OpenRouter, DeepSeek, ElevenLabs), media credits log, HQ credit-log breakdown.
- Subscriptions: tracker with renewals, credits, burn, runway, signals.
- Projects hub: projects → categories → link tiles with favicons; HQ tasks and decisions; every AI run filed under its project.
- Settings: DPAPI vault, key test, editable prices, live model lists from each account, demo mode (three pretend AIs, zero spend).

## What to build next (in order)

1. **Real keys and a week of use.** Confirm subscription prices, run councils to teach the router, tune the capability baselines from actual wins.
2. **Media actions, not just tiles.** Kling (official API with access/secret key), Runway, ElevenLabs, fal.ai: generate from inside a mission ("storyboard → 6 Kling shots → lipsync"), with cost estimates and the credit log written automatically. Suno and Midjourney have no official API; keep them as links.
3. **Pipelines (templates).** Music video, Instagram week, client site launch: saved mission plans with each step pre-assigned, one click to run.
4. **Electron packaging** (safeStorage for keys, tray icon, autostart) and a Windows installer; macOS second.
5. **Usage from the chat subscriptions.** Claude.ai, ChatGPT Plus and Grok have no API for plan usage; options are manual entry or browser-extension readers (as Tokens 4 Breakfast does on macOS).
6. **OpenRouter exact costs** from `usage.cost`; Anthropic/OpenAI admin usage APIs for teams.
7. **Scheduled missions** (daily standup brief, weekly spend report) and notifications (amber/red lights, renewals in 3 days).
8. **Accounts and licensing** for selling: license key check, update channel, telemetry opt-in only.

## Pricing (decided: subscription service)

Chris's call on 2026-10-18: this is a subscription service. Grok's advice in the "Selling an AI-Made App" chat (read 2026-10-18) and our market research agree on the shape; the research adds one guardrail: never resell opaque credits.

| Tier | Price | What you get | Notes |
|---|---|---|---|
| Free | $0 | Bring your own keys, 3 projects, Single mode, status strip, 5 councils/month | Enough to feel the routing; converts through the Credits tab ("here is what you would have saved") |
| Pro | **$18.99 / month** (raised from $15.99 on 2026-10-21; people who already pay $15.99 stay on that price); **$189 / year**; lifetime founder $349 for the first 100, then $499, closed after 500. Lifetime is Pro for life. | Everything: Council, Mission, scheduler, off-peak routing, unlimited projects, subscription tracker, priority support, Deep Research with a monthly limit | Pro monthly, Pro yearly, and the $349 lifetime page open their Square pay pages. |
| Extreme | **$29.99 / month** or **$299 / year** | Everything in Pro, plus more AIs per council, more runs at once, unlimited Deep Research, all industry packs, a compliance audit log, early access, Max quality, and team spaces for 5 people total, counting the owner (the owner plus 4 invited) | Hosted background runs and schedules are gated until those screens exist. Monthly and yearly open their Square pay pages. |
| Studio / Agency | $49 to $79 / month | Shared projects, team view, client workspaces, white-label hub links | For people running work for clients the way Everborn does |
| Managed keys (later) | Pro + usage at cost + 10% | We hold the provider accounts for people who do not want API keys | Only with a live, itemised ledger; this is where the "hybrid" model lives |

The old Square pay link (live 2026-10-18) is **https://square.link/u/dbU38mQC** and still bills $15.99. New prices and the published pay pages are in docs/billing.md. The app does not send a new plan to that old link. The $349 founder page is https://square.link/u/nKrsGaj2.

Positioning line (Grok's draft, kept): "One place to talk. It picks the right AI (ChatGPT, Claude, Grok…), routes for speed and cost, and coordinates them to actually finish the project." Sell the savings and the finished work, not "orchestration".

## Launch marketing (from the Grok chat, matches the Everborn Reels workflow)

- Organic first: 3–7 Reels a week on Instagram, cross-posted to Facebook. Hook in the first 2 seconds, then a screen recording of the console: orders typed, the graph lighting up, the deliverable landing, the cost line at the end.
- Best angles: "same project, manual vs command center: tokens and minutes"; "I told it to build X and it used Claude for reasoning, Grok for research, ChatGPT for copy"; before/after of a multi-step job; the status strip going amber before a wall.
- Paid: boost the Reels that get watch time, then Meta Ads Manager with the Traffic objective (web app) or App Promotion once there is an installer; vertical video, refresh creatives every 7–10 days; audiences around ChatGPT, Claude, Grok, coding tools, productivity software, people paying for several AI subscriptions.
- Prerequisites: professional Instagram + Facebook Page connected in Meta Business Suite, landing page with waitlist, Meta pixel on it.

## Naming

Chris asked about **CommandAI** (2026-10-18). Problem: "Command AI" is an existing, well-known software brand (formerly CommandBar, acquired by Amplitude in October 2024, still operating at command.ai), and "CommanderAI" has a 2024 US trademark filing for AI software; "Comand AI" is a French defence-software company. A Play Store / App Store listing called CommandAI would sit next to those and invite a takedown or confusion.

Safer directions that keep the idea: **Marching Orders** (Chris's own phrase; distinctive, memorable, no obvious software conflict found), **Everborn Command** (brand-anchored, current working title), **Command Deck**, **Warroom**. Recommendation: run the store listing as *Marching Orders, by Everborn* and keep "AI command center" as the category phrase in the description, where it is descriptive and not a mark. A $250–400 USPTO search by an attorney before launch is worth it for whichever name wins.

Working display name as of 2026-10-19: **Meldmind**, tagline "an Everborn product", subtitle "Take command of all your AIs." where a subtitle fits. Provisional, pending attorney trademark review before public launch (Cisco MINDMELD risk). The appId, the data folder, and the updater feed stay unchanged.

## Known limits of v0.1

- Model IDs and prices follow October 2026 research and will drift; the live model list on each Settings card and editable prices cover it.
- Perplexity moved its endpoint on 2026-09-27; the registry points at the new router endpoint but it is unverified against a real key.
- Status page JSON for xAI, OpenRouter, Mistral and DeepSeek could not be verified; those lights rely on probe calls.
- No Electron shell yet: the app is a local Node server plus browser tab.
