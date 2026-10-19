# Command AI release notes

Plain-words notes for each release, newest first. Paste the top section into `gh release create --notes` when publishing (see docs/RELEASING.md). The version number is set when Chris cuts the release.

## Next release (after v0.4.1, not released yet)

**New**
- Connect Google Drive, Instagram, HighLevel and Slack with your own sign-in. Send to Slack is new, and Save to Drive now uploads into a "Command AI" folder when Drive is connected. Every post still shows a preview and needs your click.
- Marketplace: share a pipeline as a signed file or link, install from a local and demo catalog, and a moderation queue. Paid listings are switched off and nothing is charged.
- Growth features, all off unless the host switches them on, with placeholder amounts and no charges: a free trial with a day counter, a "No keys needed" managed plan with usage metering, and referral codes with a credit ledger.

**Better**
- Keyboard and screen readers: a "Skip to content" link, a visible focus ring, the open tab and the chosen run mode are announced, status tiles, project cards and recent runs open with Enter or Space, form fields in Subscriptions have names, and error messages are read out right away.
- Reduced motion: when your system asks for it, the app's blinking and pulsing stop.
- Clearer errors: "Could not reach Command AI's engine" instead of "Failed to fetch", "Request failed (HTTP 500)" instead of an empty message, a button that forgot to report a problem now shows it, and a tab that fails to open says so with a Try again button.
- Empty screens explain themselves: no projects yet, nothing tracked in Subscriptions, a quiet Live feed.
- Faster reloads: the app's scripts and styles are only sent again when they changed.

**Fixed**
- The engine now says "port in use" and stops cleanly when its port is taken, instead of crashing with a stack trace.
- Demo mode still starts when its usual local port is taken by another program.
- Copy under the deliverable no longer says "Copied" when there was nothing to copy or the copy failed.
- For developers: the test suite no longer fails at random with "ECONNRESET" when test files run side by side.

## v0.4.1 (2026-10-19)

- Starter pipelines, savings receipt with PNG export, spend caps with amber and red alerts.
- Rate the result (thumbs up or down) and project memory (brand voice, offers, never-say list).
- Live-share links and the weekly report (export or draft only, nothing sent on its own).
- Voice orders, installable web app and opt-in push notifications.
- Chat with files in a project and media actions (video, image, voice) with an estimate first.
- The licence check works on fresh installs.

## v0.4.0 (2026-10-19)

- Colour themes, brand kit, onboarding tour and guided API-key setup.
- Live web search with cited sources, MCP tools, smart fallback, the learning router and the live project view with the animated flow map.
- Subscriptions and services page, Grok Bot agent, built-in browser helper, bookmark organizer.
- Side-by-side comparison, knowledge libraries, custom agents and saved prompts, artifacts panel, image generation, schedules, ChatGPT and Claude history import, quick launcher, browser extension, live model prices, team sign-in and workspace keys.
- Teams and shared workspaces.
