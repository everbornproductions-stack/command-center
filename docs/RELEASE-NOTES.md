# Meldmind release notes

Plain-words notes for each release, newest first. Paste the top section into `gh release create --notes` when publishing (see docs/RELEASING.md).

## v0.4.3 (2026-10-20)

**New**
- Simple and Expert. A new install starts in Simple: one chat box, and the council picks the AI.
- The first time you open Meldmind it asks: Keep it simple or show me everything?
- A Simple / Expert switch sits in the top bar on every screen. One click changes it. Your chats, projects, and keys stay put.
- Simple shows Chat, Projects, Create, and Settings. Expert keeps the debate, the scores, spend caps, the live map, marketplace, MCP, webhooks, and every menu.
- Help is a tab in Simple and in Expert. Search the guides, or click Ask Meldmind. Take the tour again and Check for updates are both there.
- Phone pairing uses this PC's Wi-Fi address when you turn it on in Settings, under Phone and other devices. The QR code and the link both include the pairing code. It stays off until you turn it on.
- A fresh install shows Get everything connected after the AI setup: Gmail, Drive, Calendar, HighLevel, CapCut, Kling, and the rest. Each row is Connected, Not connected, or Handoff. Gmail and Outlook list each account. Add another asks for a label, then uses the same sign-in. Run setup again is in Settings and in the Help menu.
- The AI keys step leads with one OpenRouter key. It reaches Claude, GPT, Gemini, Grok, DeepSeek, Llama and more, and free models are available. Other keys stay optional.
- Tap to talk works in the desktop app. It transcribes with an OpenAI, Groq, ElevenLabs, or Gemini key, and it names the key to add when none is saved.

**Better**
- The chips under the chat box list only AIs you have connected. Demo stays there only until a real AI is connected.
- Pasting a key recognizes Gemini auth keys (AQ.) and older AIza keys, plus Claude, ChatGPT, Grok, OpenRouter, and Groq. Gemini is checked on Google's own models list.
- CapCut connects with its MCP sign-in, not an API key. The strip says Not connected until you Connect, then Connected. If it cannot connect, the card says US access is coming soon.
- Each provider shows how it connects: No key, Not connected, Handoff, or Local app.
- Set a provider to Free, Paid, or Unknown. Simple mode can prefer free AIs when quality is similar.
- After a run, one upgrade tip can name an AI that usually does that task better, with a link to add credits or a key. Tips stay off during a run.
- Out of credits, a spending limit, or a rate limit pauses that AI. The strip says Paused: no credits, with a billing link. Auto-picks skip it until a health check clears it or you save the key again.
- Out of credits is no longer shown as Key rejected. A spending limit or an empty balance says to top up, and the key stays saved.
- A new setup checks I am willing to share anonymous track records. What we share is only the task type, which AI, and the score. We never share prompts, content, or keys. You can change this any time in Settings.
- On a Single run, Quality, Balanced, or Economy on the Command bar is the priority for that run. If you do not pick one, Meldmind uses your saved Default priority.

## v0.4.2 (2026-10-19)

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
