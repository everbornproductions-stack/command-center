# Roadmap: the twelve (approved by Chris 2026-10-18, "get all this done")

Build order is by payoff and by what can run in parallel without two sessions editing the same file.

## Shared plumbing first (main session)

- `web/features/` plugin hook: each feature is one JS module that registers tabs, panels and command-view widgets through `window.CC.register(...)`. `app.js` loads `web/features/index.js` once and never needs editing for a new feature.
- `server/plugins/` server hook: each feature exports `routes(app)` and optional `onEvent(bus)`; `server/index.js` mounts `server/plugins/index.js` once.
- `server/steps.js`: mission step types beyond "llm": `media.generate`, `publish.post`, `file.save`, so pipelines can call media and posting actions.

## Workstreams

| # | Feature | Files (owner) | Done looks like |
|---|---|---|---|
| 1 | Saved pipelines | `server/plugins/pipelines.js`, `web/features/pipelines.js`, seeds in `data/pipelines.json` | Templates: Instagram week, music video from a Suno track, client site launch. One click runs a mission with pre-assigned steps; results filed under the project |
| 4 | Rate the result | `server/plugins/ratings.js` (feeds `router.recordOutcome`), `web/features/ratings.js` | Thumbs up/down on every deliverable; the skills matrix shows learned deltas from human ratings separately from council votes |
| 5 | Memory per project | `server/plugins/memory.js`, `web/features/memory.js`; projects gain `memory` field | Brand voice, offers, never-say list, past winners per project, injected into every prompt for that project; HQ importer reads `company/clients/*.md` |
| 7 | Savings receipt | `server/plugins/receipt.js`, `web/features/receipt.js` | Every run shows "flagship-only would have cost X, this cost Y"; Credits tab totals it; one-click PNG export for Reels |
| 2 | Media actions | `server/plugins/media.js` (+ `server/media/{kling,runway,elevenlabs,fal}.js`), `web/features/media.js` | A mission step can generate video/image/voice through the APIs, estimate credits first, log them in the ledger, save outputs into the project folder |
| 3 | Posting hooks | `server/plugins/publish.js` (+ `server/publish/{meta,ghl,drive}.js`), `web/features/publish.js` | Deliverable gets "Post to Instagram", "Schedule in GHL", "Save to Drive"; Meta Graph API for IG, GHL social planner API, Drive upload. Each post needs an explicit click |
| 6 | Weekly report | `server/plugins/reports.js`, `web/features/reports.js` | Monday 7 am mission: spend by AI, low credits, renewals, what shipped, cancel suggestions; delivered in-app and by email (Resend) and push |
| 10 | Spend caps + alerts | `server/plugins/alerts.js`, `web/features/alerts.js`, `web/sw.js` push handler | Per-AI monthly cap; strip amber at 80%, hard stop at 100% (router excludes); web push (VAPID) and email on amber, red, renewal in 3 days |
| 8 | Live-share link | `server/plugins/share.js`, `web/share.html`, `web/features/share.js` | Read-only token URL that mirrors graph, tasks and feed of one mission in real time; expires; no keys or costs exposed unless toggled |
| 9 | Voice orders | `web/features/voice.js` | Mic button on Marching Orders using the Web Speech API (Chrome/Edge), fallback to Wispr Flow dictation; push-to-talk and auto-send option |
| 11 | Shared workspaces (Studio) | hosted-hub session: `server/hosted.js`, `server/store.js`, `supabase/workspaces.sql`, `web/features/workspaces.js` | Owner invites members by email; members see only shared projects; owner sees members' usage; tier gate on Studio |
| 12 | Pipeline marketplace | `server/plugins/marketplace.js`, `web/features/marketplace.js`, `docs/marketplace.md` | Local and demo catalog, signed template file, install, moderation, placeholder revenue share. Payments are not built |

## Rules for every session

- New files only, except the one-line mounts in the hooks above. If a change to a shared file is unavoidable, message the main session with the exact diff.
- Every feature works in local mode and hosted mode (use `ctx()` from `server/store.js` for data; never read `data/` directly).
- Nothing posts, sends, spends or publishes without an explicit click; dry-run estimates come first.
- Each session ends with: what works, how it was verified (demo mode is fine), what is not verified, files touched.

## After app control (planned, not built)

Chris, 2026-10-20. These six run after desktop and app control (build-plan phases 45 to 51). They are plan only. Do not build them yet. They are not part of the 0.4.8 release. The same safety rules apply: nothing posts, sends, buys, or spends without a click, and Square stays untouched.

| # | Phase | Feature | Done looks like |
|---|---|---|---|
| 13 | 57 | Recipes | Record one desktop-control task and replay it on a schedule. Per-app Allow, a second click before send, buy, or delete, a banner with Stop, and no stored passwords. A replay that would send, buy, or delete waits. This does not replace pipelines or the existing schedules. |
| 14 | 58 | Second-opinion mode | Two AIs cross-check an important answer and flag disagreements. The person still decides. Council stays as it is. |
| 15 | 59 | Cost guard | A monthly budget cap, plus the live counter "you saved $X by smart routing". The existing You saved estimate and the per-AI spend caps stay. At 100% a new paid run waits. |
| 16 | 60 | Phone approvals | A push to the paired phone approves a send or a buy. That tap is the second click. Declining sends nothing. Pairing stays off until it is turned on. |
| 17 | 61 | Team spaces | Shared projects, keys, and recipes for a small business, as a paid tier above Pro. Phase 8 workspaces stay. Do not rebuild them. The price is a placeholder until Chris sets it. |
| 18 | 62 | Industry starter packs | Real estate, insurance, credit repair, and other packs live in Prompts, grouped by industry. Picking one drops it into Marching orders, prefilled and editable. Nothing runs until it is sent. Outbound text stays a draft. |
