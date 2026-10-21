# Meldmind release notes

Plain-words notes for each release, newest first. Paste the top section into `gh release create --notes` when publishing (see docs/RELEASING.md).

## v0.4.12 (2026-10-21)

**New**
- Refocus is in the Work menu. Type a topic and click Find.
- Meldmind reads saved chats, imported chats, project files, saved outputs, and Google Drive when Drive is already connected.
- Private chats are left out. Nothing is sent when you click Find.
- The full rebuild is part of Extreme. Finding the timeline is part of Pro. Free shows an upgrade note and does not search.

## v0.4.11 (2026-10-21)

**New**
- Run in background is Pro. Leave this screen. You get an alert when the chat, council, or mission is done. Nothing is emailed.
- Settings shows what your ratings taught. Thumbs up and thumbs down change who gets the next job of that kind. Reset clears only the thumbs. Council scores stay.
- Pro can pause a mission, edit the steps that have not finished, and resume. Done steps stay as they are.

## v0.4.10 (2026-10-21)

**New**
- When you come back, Home shows your recent chats and projects.
- Private mode keeps a chat on this computer.
- Backup and restore uses one file and does not include AI keys.
- Do this again repeats a finished job and is part of Pro.
- Double-check this asks a second AI to review an answer.
- Tone buttons set the next answer only and do not send by themselves.
- AI credits shows what is left for each AI. Each answer says which AI wrote it.
- The Mac build is unsigned. The first time you open it, right-click the app, then Open.

## v0.4.9 (2026-10-21)

**New**
- A share link made on this PC says this link only works on this PC. Copy the text or export a file.
- Schedules use day buttons and a time. Presets include Weekdays at 5 pm and Fridays at 4 pm. Last run missed (app was closed) offers Run now.
- Words from your never-say list, and guarantee when credit repair is on, are flagged before you copy or send.
- Under the box, Meldmind says SSNs and account numbers are masked before sending.
- Help includes Security and your data, plus a one-page security summary PDF.

**Better**
- MCP, OAuth, webhook, sender key, Handoff, and SCF mode use plain words. Each Handoff row says what happens.
- The user guide says Meldmind. The installer is Meldmind-Setup.
- Hint text is easier to read. Real estate and mortgage modes are coming. Marketplace stays capitalized.
- Click Stop to cancel. Send says Still working while a run is going. Did not search the web when search is off. After 5 ratings, Meldmind says which AI it now prefers. A finished run can notify you in the background. You can type in any language. Nothing was charged on a failed run that cost $0.

## v0.4.8 (2026-10-21)

**Better**
- The top bar uses the width it has. A wide window shows about eight menus on one row. A narrower window shows about five. The row never wraps onto a second line.
- Nova, Atlas and Sage hide from every list and from the hub once a real AI is connected, including a saved key, a local model, OpenRouter, or agy. They come back only when every real AI is removed. You can turn demo mode back on in Settings.

## v0.4.7 (2026-10-20)

**Better**
- The top bar is one row of dropdown menus. A wider window splits them into more menus, and a narrower window merges them back. The row never wraps onto a second line. Resizing the window or moving it to another monitor updates the row right away.
- Start a project is in the Work menu, with Projects. The Settings menu keeps Settings, setup, the tour, and Check for updates.
- Nova, Atlas and Sage, the demo AIs, hide once a real AI is connected. They come back only when every real AI is removed. Real jobs are not sent to them while a real AI is connected.

## v0.4.5 (2026-10-20)

**New**
- Settings, Appearance, adds theme presets, gradients, built-in pictures, and a photo from a file on this computer. A web address is not accepted. Built-in restores the original background.
- The top bar shows You saved this month and all time. It is an estimate based on token counts and list prices.
- Add a custom provider and tick Good at for the task types it should take. Matching tasks go to it. Scores from your jobs make the pick sharper.

## v0.4.4 (2026-10-20)

**New**
- Quality, Balanced, Max savings, and Speed apply to Single, Council, and Mission. Max savings is the old Economy choice.
- A connected free model on this PC (Ollama, LM Studio, Aider, OpenCode) is tried first on Max savings. Freebuff is not used.
- The route preview can mention a batch price. A run you send now pays the live price.
- Add community track records from people who opted in. Quality, Balanced, Max savings, and Speed all learn from them. Nothing is uploaded.
- Settings, Appearance, sets a background colour next to the accent. Built-in restores the original background. Text stays readable.

**Better**
- Free includes 3 projects and 5 councils a month, 1 connected service, and 1 email account per provider. Pro includes every connected service and up to 8 email accounts.
- Phone pairing and full history search are Pro. The router stays free. Shared learning and the scores dashboard are Pro.
- A 14-day Pro trial can be started in the app. The trial is not started for you, and nothing is charged.

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
