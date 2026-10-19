# Command Center build plan (Chris, 2026-10-18: "a full working product that nobody else has")

Each phase is sized for one Claude Code session (about 1–2 hours). Run order: 1, 12, 13, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 (12 and 13 were added on 2026-10-18 as high priority). A phase starts only after the phase before it in that order shows PHASE N DONE in BUILD-LOG.md; phases already marked DONE (e.g. Phase 8, built early by Grok Bot) are skipped.
This plan includes the twelve items in `docs/roadmap.md` (marked R1–R12) and follows its plugin rules (`web/features/*`, `server/plugins/*`, data through `ctx()` from `server/store.js`).

## Rules for every phase (non-negotiable)
1. Read `README.md`, `docs/roadmap.md`, this file and the end of `docs/BUILD-LOG.md` first.
2. One commit per feature (`git add <your files>` only, never `git add -A`). Do NOT commit files you did not write in this phase. Other sessions may have uncommitted work here (e.g. workspaces files); leave it alone.
3. Write tests for every feature in `test/*.test.js` (node --test). Before each commit, run `npm test` and `npm run smoke`; both must pass.
4. Everything must keep working in demo mode (no keys). Use a throwaway data dir (`CC_DATA_DIR` set to a temp folder) for tests.
5. Never deploy, never push (Chris pushes), never touch Square, real API keys, `data/`, `.env`, password files, or billing. Nothing posts, sends, emails or spends without an explicit user click; outbound integrations need user OAuth.
6. Paid things (managed plan, trial credits, marketplace pricing) go behind a feature flag with PLACEHOLDER prices. Chris decides real pricing.
7. At the end, append to `docs/BUILD-LOG.md`: date/time, features done, commits (hash + message), test counts (npm test pass/fail, smoke pass/fail), what is not verified, and a final line exactly `PHASE N DONE` or `PHASE N BLOCKED: <reason>`.

## Phases

### Phase 1: First impression
- Color themes: light, dark, and accent colors, saved per user, applied across the app.
- Brand kit: upload a logo and pick brand colors; applied to the app header and to client share pages.
- Onboarding tour: first-run walkthrough that runs a demo sample mission (demo mode, no keys).
- Guided API-key setup: step-by-step per provider (where to get the key, paste, test call, store in the vault). Keys never logged or shown again.

### Phase 2: Proof of value
- Starter pipelines (R1): Instagram week, client proposal, music video plan; one click runs a mission, results filed under the project.
- Savings receipt per job (R7): "flagship-only would have cost X, this cost Y", Credits tab total, PNG export.
- Spend caps and alerts (R10): per-AI monthly cap, amber at 80%, router excludes at 100%, in-app alert.

### Phase 3: Quality loop
- Rate the result (R4): thumbs up/down feeding the router; the skills matrix shows human ratings separately.
- Project memory and brand voice (R5): voice, offers, never-say list, past winners injected per project; HQ client-file importer.

### Phase 4: Client-facing
- Live-share links (R8): read-only, expiring token URL mirroring one mission in real time, with the brand kit applied. No keys or costs shown unless toggled.
- Weekly report (R6): generated in-app every Monday (spend, low credits, renewals, what shipped, cancel suggestions); an email draft/export button only, nothing sent automatically.

### Phase 5: Hands-free and mobile
- Voice commands (R9): mic button using the Web Speech API, push-to-talk and an auto-send option.
- PWA and push notifications: installable app, service worker, web push (VAPID) for alerts and job done, opt-in only.

### Phase 6: Work with files and media
- Chat with files: drop PDFs, docs or images into a project and ask questions; chunks stored per project; works in demo mode with the mock provider.
- Media actions (R2): mission steps for video, image and voice through provider adapters, credit estimate first, ledger logging, outputs saved to the project. Stubbed in demo mode.

### Phase 7: Integrations (OAuth, post only on click)
- Connectors for Google Drive, Instagram (Meta Graph), HighLevel and Slack (R3): user OAuth flow scaffolding, tokens kept in the vault, "Save to Drive", "Post to Instagram", "Schedule in HighLevel" and "Send to Slack" buttons, each needing an explicit click. Mock adapters for tests; no real calls in tests.

### Phase 8: Teams
- Team seats and roles (R11): owner, admin, member and viewer; invite by email (invite link generated, not sent); per-role permissions; usage per member; Studio tier gate.

### Phase 9: Growth (feature-flagged, placeholder pricing)
- Free trial with credits: trial counter, gating and an upgrade prompt.
- "No keys needed" managed plan: the app routes through an Everborn-managed key pool when the flag is on; usage metering only; no billing integration.
- Referral rewards: referral codes and links, a credit ledger, and a rewards view.
- No real charges, no Square changes, all prices are placeholders.

### Phase 10: Marketplace
- Template sharing (R12): export or import a pipeline or template as a signed JSON file; a share link.
- Marketplace: listing page, install flow, moderation queue and revenue-share fields (placeholder); local and demo catalog only.

### Phase 11: Hardening and polish
- Full regression pass, accessibility, performance, error states, empty states, README and user guide, release notes. Fix anything flaky found in phases 1–10.

### Phase 12 (HIGH PRIORITY, added 2026-10-18): Grok Bot agent inside the Command Center
Chris wants the app to be the hub where all his AIs talk and decide who does what best; when Grok Bot (his assistant with its own computer, signed-in browser, Gmail, Drive, Calendar) is the best fit, the app hands it the job.
- Grok Bot appears as an agent/provider in council, router and mission modes, with capability tags: `signed-in-browsing`, `gmail`, `drive`, `calendar`, `teammate-bots`. The router prefers it for tasks that need those; it is never picked for plain text work another AI does as well.
- Settings > Integrations > Grok Bot: two fields, webhook URL and sender key, stored in the vault like other secrets (never in git, never logged, never sent to the browser after saving). A third optional field: header name, default `Authorization` with value `Bearer <key>`.
- Dispatch: POST to the webhook URL with the sender key header and JSON body `{job_id, task, context, workspace, callback_url}`. Only on an explicit mission/council step or user click; never in demo mode unless the mock is selected.
- Results come back to `POST /api/grokbot/callback/<job_id>?t=<per-job random token>` on the local server (the token is generated per job, stored hashed, compared with timingSafeEqual, single use for `done`). Payload `{status, text, artifacts}`; status is one of `queued`, `working`, `needs_approval`, `done` (plus `failed`). The result lands in that job's thread and graph node; the node shows the status. The UI says results are async and can take minutes.
- The callback endpoint must be exempt from the local session token (it uses the per-job token instead) and must reject everything else.
- Tests: a local mock webhook server only (random port); never hit a real URL in tests.
- Do not build a tunnel and do not deploy anything. Document that `callback_url` only works once Grok Bot can reach it: after the hosted hub exists or a tunnel is set up by Chris. Until then the job stays `queued`/`working` and the user can paste the result in by hand.

### Phase 13 (added 2026-10-18): Organize my existing browser bookmarks
The first-run step that makes AI bookmarks also offers to organize the user's EXISTING bookmarks into smart, auto-named folders by topic (e.g. their business name, insurance, banking, tools, social), using the user's own API key to categorize.
- Read bookmarks from Chrome, Edge and Brave `Bookmarks` JSON files (per profile) and Firefox `places.sqlite` if practical (read-only copy). Only after the user picks the browser and clicks allow.
- Show a preview of the proposed folders; the user can rename folders, move items between folders, and uncheck items before applying.
- Back up the original bookmarks file first (timestamped copy next to it and in the app data folder) and offer one-click undo that restores the backup.
- Never delete bookmarks; only reorganize. Exact duplicates (same URL) are merged only after the user confirms the list.
- Before applying: warn the user to close the browser (Chrome/Edge/Brave overwrite the file while running); detect a running browser process and refuse to apply until it is closed. Remove the `checksum` field so Chromium accepts the edited file.
- Privacy: bookmark titles and URLs go only to the AI provider the user picked for categorizing, nowhere else; say so in the UI. Demo mode categorizes with the mock provider and a fixture file.
- Tests with fixture bookmark files in a temp folder; never touch a real browser profile in tests.

### Phase 14 (low priority, added 2026-10-18): Mac build
- `docs/ci/mac-build.yml` (added by Grok Bot; move it to `.github/workflows/` after `gh auth refresh -s workflow`) builds an unsigned `.dmg` and `.zip` (x64 and arm64) on macos-latest, on manual dispatch or a `v*` tag, and uploads them to the same public releases repo. It needs the repo secret `RELEASES_TOKEN` (fine-grained token, Contents read/write on command-center-releases only).
- Check that the app runs on a Mac: server start, Keychain vault (`safeStorage`), tray, window, data folder `~/Library/Application Support/Everborn Command`.
- TODO, needs an Apple Developer account ($99/year, Chris decides): Developer ID signing and notarization (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` as repo secrets, `notarize: true`). Until then Gatekeeper warns on first open and in-app updates do not work on Mac.
- Never block the Windows installer on this. Not in the chain run order: it needs a real Mac to verify.
