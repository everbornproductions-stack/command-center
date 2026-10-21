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

## 0.4.9 App discovery and suggestions

0.4.8 is the hotfix. This app discovery slice is part of 0.4.9. 0.4.10 is the unsigned Mac .dmg and the new-version Download notice. Signing and notarization stay later.

When the person opts into desktop control, Meldmind lists installed programs. On Windows that is the uninstall registry keys and the Start menu, plus command-line tools on PATH. File contents are not read. Each name is matched to a curated capability list that can be updated from an https address when the person clicks Update the app list. The person allows each app. Allowed apps are scored and join the router's choices, the same as a tool you add. While planning a mission or client work, a dismissible card suggests a program with a short reason, Free or Paid, and the official link. Nothing is installed or bought. Suggestions can be turned off in Settings.

Phases 45 to 51 stay planned, not built. This slice does not drive apps. It does not add UI Automation, Playwright, screenshot computer use, hub cards, or registerExternalAgent.
