# Roadmap: the twelve (approved by Chris 2026-10-18, "get all this done")

The twelve below shipped with Phases 2, 3, 4, 5, 6, 7, 8, and 10. They are DONE. Do not rebuild them.

The current plan (2026-10-21) is in docs/BUILD-PLAN.md:

- **0.4.9:** onboarding with the mode choice and extra Expert setup, the few-facts fix, safety / sharing / plain words, desktop control with Antigravity first, the program scan, everyday and Calendar actions, save in place, the welcome email, the graduate notice.
- **0.4.10:** the unsigned Mac build (right-click Open; Apple signing is Later), private mode, see who reads the prompt, backup and restore, Do this again, home screen, delete with receipt, Double-check, tone buttons, AI credits, My chats, answers name their AI, first council explained, share links (Phase 4, already done), PDF and DOCX export, industry packs, accessibility (Phase 11, already done), imported chats (Phase 23, already done).
- **0.4.11:** background runs, learned from ratings, mission pause.
- **Then:** research (citations already shipped in Phase 15; add Pro Search, Deep Research with a second-AI check, academic and news filters), Zapier and Make both ways, with MCP by URL and webhooks moved earlier (Phase 90), Remix any app (Phase 96, a Pro mission, unlimited on Extreme, right after Zapier and Make), and the three tiers (Free, Pro $18.99/month or $189/year, Extreme $29.99/month or $299/year; monthly prices rise to $24.99 and $39.99 in about 6 months; lifetime founders $299 for the first 100, then $499 for the next 400, closed at 500, counter hidden under 40 buyers).
- **Later:** AI group chat, user chat, live builds, a newsletter and a monthly savings email, Spanish, phone apps, store listings, signed apps.

Build order for the twelve was by payoff and by what could run in parallel without two sessions editing the same file.

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
