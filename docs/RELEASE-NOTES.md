# Meldmind release notes

Plain-words notes for each release, newest first. Paste the top section into `gh release create --notes` when publishing (see docs/RELEASING.md).

## 0.4.23

- The Safety check now catches Stripe, SendGrid, Twilio and Supabase secret keys, checks built files (dist, build, .min.js) for keys, treats a real live key in a test folder as live, and turns red for a Social Security or card number in the words you send.
- Publish and Remix publish scan your project folder again on this computer right before anything goes out, instead of trusting an earlier check, and the result says what was checked.
- Opening web pages for research is safer: every redirect is checked again, pages on this computer or a private network are refused, and very large pages are cut off.
- Code an AI wrote for a mission test now runs fenced in to your project folder: it cannot write or read other files or start other programs. If your computer cannot fence it in, it does not run.
- A busy free AI (rate limit) is rested for about 15 minutes instead of until midnight, and the budget message names what is left when both amounts would look the same.
- The start screen never stays longer than 12 seconds and fades out on every path, links that open a new window only open inside the app for its own pages, and Freebuff only works in Meldmind project folders.
- Small fixes: the sign-in email box is required again, titles keep their spaces and plain numbers, the last "Practice" labels now say Sample or Test only, and the test run on Windows reports every failing file instead of stopping at the first.

## 0.4.22

- Safety check before you publish or download: Meldmind scans the words and files for leaked keys, passwords and old risky packages, shows plain fixes with a Fix it button, and blocks a live secret unless you choose Publish anyway.
- Free AIs first: free AIs bid for each job, the best fair bid wins, big jobs are split across several free AIs, and the result shows what you saved versus paid AIs. Freebuff can work as a free coder (one-time sign in).
- Clearer words everywhere: one cost line (Free or the price), Sample picture/video/voice instead of Practice, Not finished yet instead of Needs an ending, Save to MindMedia from voice, and a help article for Auto team.
- Prompt ideas hide when you send, and Free users only see prompts that fit their plan.
- Answers that contain code keep it exactly as written, and plain requests like a cheat sheet or a week of posts no longer start a picture.
- Publish previews now show their warnings, and private numbers (SSN, card) are hidden in titles and file names.
- Safer sending and files: the send check and log use the final drafted message, the no-send switch covers more tools, MindMedia folders are checked for symlink tricks, links open only as http, https or mail, and the never-list no longer blocks unrelated apps.
- The app's own spending stop is no longer blamed on an AI, and the message now says whether a job would go over your limit or you have used it up.
- Small fixes: the open page is marked in the sidebar, closing the Finish drawer returns you to the button you used, and Instagram previews are accurate for text-only items.

## 0.4.21

- Type what you want and get the finished thing right in the chat: "a woman on a beach" shows the picture under your message and saves it to MindMedia. Videos and voices work the same way.
- A new layout that uses the whole window: a slim left sidebar (New, Projects, MindMedia, recent chats), the chat in the middle, and a Build panel on the right with versions, Preview, Download and one Publish button.
- The first screen is one box with Image, Video, Website and Campaign buttons. AI choices, modes and budget sit behind "Auto team" on the box, and Live Ops is one line with See live.
- The bottom AI bar shows only the AIs you have connected, and an AI lights up while it works.
- Real see-through glass look, and a start screen that shows from the first moment.
- If an AI is out of credits you see it before you send, with one click to use another. A job that comes back empty now says so and offers Try again, and coding jobs are split across several AIs.
- MindMedia has smart views, a Trash with Restore, working-on-it tiles and a public link box. Finish is one step, and Publish shows one plain fix for each problem.
- Safer sending: texts need a way to opt out, the worst fair housing wording is blocked, budget caps cannot be bypassed, and private files stay inside the data folder.
- Pictures use the current xAI and Gemini picture models, and the privacy page matches what the app does.

## 0.4.20

- Approvals that hold: a phone yes cannot be faked, app doors must be public https addresses, and Select All has a never-list.
- Teams: invite messages carry a code instead of a local link, there is a Join card, and Pro and Extreme get teams. Set up hub saves what the server reads and never locks the page.
- A send check warns in plain words before risky messages go out (guarantees, fair housing, rates, missing consent) and blocks the clearly illegal.
- MindMedia: one place for everything you make, with an Unfiled shelf, a Needs an ending shelf, and Save to MindMedia after every result.
- Finish now opens a drawer with Copy, Print, Save as PDF or Word, Save to MindMedia and Publish. Results end in a card that says where they went.
- Spending limits can continue (free or +$1 more), errors say the real cause, and practice runs always show $0.
- Remix writes what you asked for into its own project folder, runs a real test, and ends with Open folder and a zip.
- Simple menu is shorter: Chat, Projects, Create, Community, More. Nothing was removed. Start a project shows three plain steps.
- Community works for free accounts, shows when it last updated, counts unread messages, and the News panel docks in its own column.
- Simple chat Send is never clipped, the light theme and phone layouts are fixed, and the opening screen stays up longer with bigger text.

## 0.4.19

- Safer links: the app now accepts only its own address, so a look-alike website cannot talk to it.
- A hand-edited license file no longer unlocks a paid plan. Real licenses keep working.
- Spending limits really stop a run, and Stop on Build it all for me really stops the project.
- Community chat updates on its own, tells you honestly when a message did not send, and works for anyone signed in.
- A News panel on the left or right edge, with links, that you can shrink out of the way.
- Finished projects stay editable and download as a zip. Asking the chat for a website or project starts the project steps.
- A Stop button in normal chats keeps what was written so far. Use my plan first now really puts your signed-in plans ahead of paid API models.
- The light theme shows every card title, and notices sit above dialogs.
- Every pop-up that asks you to type a name is now a proper box inside the app.
- The new look, the project bar, the phone companion, agents and Take Over are on by default.

## 0.4.18

- Pay on the website with Stripe and unlock in the app: sign in with the same email and your plan turns on. Upgrade in the app opens checkout with your email filled in.
- Get everything connected now has a Run the whole setup again button, so you can redo setup from one place.
- Helping Meldmind get smarter: anonymous results (counts only, never your text) are on by default with a note on the welcome screen, and off by default in the EU and UK. Sharing your own prompts and answers stays opt-in. Settings, Privacy lists everything that leaves this computer.
- New helper persona Rin tests how the menus and buttons feel, and the Missions, Councils and Research menus now open correctly on large screens.

## 0.4.17

- One welcome screen replaces the first-run pop-ups: pick Simple or Expert, text size, try it now or add a key, and sign in with Google or Microsoft in one click. Skip setup any time.
- In Simple, the answer shows right under the chat box. Under each answer you get Copy, Double-check and Test with personas; the rest is under More actions.
- Prompt suggestions show only while you type, match what you are doing, and keep the words you typed.
- Clearer menus: People is under Connect, and the two setups are now Find my AIs and Get everything connected. Typing boxes are easy to read everywhere.
- Anonymous usage counts are off on new installs unless you turn them on. Settings shows what leaves this computer.

## v0.4.16 (2026-10-22)

**New**
- Backup when API credits run out. Meldmind keeps answering through your own plan for that AI: first the official app on this PC (Claude Code, Codex, Gemini CLI, or Antigravity), then a copy-over hand-off where the other AI is asked to send its answer back and Meldmind checks for it. The answer fills that AI's box in Command. A Setup step and Settings let you pick the apps or turn it off.
- Test with personas adds Max, a senior developer, for code, apps, and technical pages.

**Safer**
- Desktop control shows the exact list of buttons it will press in a desktop app and waits for Press these. Get it done cannot skip that confirm. Stop works between steps.

**Still here**
- Home, Private mode, and Backup and restore stay in this build.
- Background runs, Together, People, Remix, Zapier and Make, and hosted runs are in this build. A send still waits for a click.
- The Mac build is unsigned. On macOS 15 or later, open System Settings, then Privacy and Security, then Open Anyway.

## v0.4.15 (2026-10-21)

**Improved**
- Page buttons switch pages right away. The top bar, the menus, and the phone bar no longer show Working... or Done.
- Other buttons keep their own name while they work. A small spinner shows only when something takes longer than half a second. No Done flash afterwards.

**Still here**
- Home, Private mode, and Backup and restore stay in this build.
- Background runs, Together, People, Remix, Zapier and Make, and hosted runs are in this build. A send still waits for a click.
- The Mac build is unsigned. On macOS 15 or later, open System Settings, then Privacy and Security, then Open Anyway.

## v0.4.14 (2026-10-21)

**New**
- AI employees: twenty ready-made helpers with a job script, in Agents, missions, project setup (a suggested team), and Simple chat (the best helper for what you typed). + Add more employees opens a library of thirty more.
- Test with personas: the Meldmind persona panel reads an answer, a draft, a post, a page, or a design idea, scores it out of 5, and suggests fixes. Apply one fix or Apply all fixes, then Use this version, Copy, or Undo. Reactions are simulated by an AI. Nothing is sent or posted.

**Improved**
- Expert Command: the orders box is bigger, a one-line placeholder holds the Deliverable spot until it shows, and council answers in Live ops show at full height instead of scrolling.

**Still here**
- Home, Private mode, and Backup and restore stay in this build.
- Background runs, Together, People, Remix, Zapier and Make, and hosted runs are in this build. A send still waits for a click.
- The Mac build is unsigned. On macOS 15 or later, open System Settings, then Privacy and Security, then Open Anyway.

## v0.4.13 (2026-10-21)

**New**
- Second opinion: two AIs answer the same question, and Meldmind shows where they differ. Both answers stay.
- Industry packs for real estate, insurance, and credit repair (Pro). Picking one fills the chat box. Nothing runs until you send it.
- HighLevel contacts, invoices, and workflows from a chat. A send, a charge, or a change waits for your click.
- Use your own Supabase: an optional advanced setting, off by default.
- Remix is one simple path: what to make, a starting point, preview, Build, Test, Publish. Extra choices are under More options.
- Builders for HighLevel, receipts, invoices, booking, meeting notes, contracts, and review replies. Web and marketing builders for websites, posts, reels, and ads. Nothing is sent until you click Publish.
- Thumbs up or thumbs down on prompts, weekly prompt packs, and popular prompts under the chat box.
- A handed-off AI can report back when it is finished. If it cannot, use Paste result.
- Get it done lets one job run its ordinary steps without asking. Spending money and a permanent delete still ask. Sending a message stays off unless you turn it on.
- A sign-in tip suggests a password manager. Meldmind never stores your passwords.
- Share anonymous usage counts (on unless you turn it off in Settings). No prompts, chats, emails, or files are sent.
- Community chat and a weekly AI News feed, with one public username per account.
- Easier to use: Help search answers plain questions, bigger text grows buttons and headings too, Simple Settings starts with five cards, and the Simple tour is five short steps.
- Reply, forward, share, and similar actions wait for a second click.
- Download the guide (PDF) from Help. It lists only what is in this app.
- Credits left shows for every AI. Live where the AI has a balance API (OpenRouter, DeepSeek, xAI with a management key, OpenAI and Anthropic spend with an admin key). Everywhere else it says "estimated" and names the key that would give live numbers.
- Update balance: for an AI with no balance API, type the credits you have now and the day you saw them. Meldmind subtracts each job and shows "tracked since" that day. Each row says where that AI shows your usage history.
- Agents keep balances right: Claude Code, Antigravity, Grok Bot, and other agents that can run tools report what they spent outside Meldmind, through the Meldmind report_usage tool or their report back. Show agent setup gives the standing instruction to copy.
- Receipt, top-up, and usage emails update the balance on their own, with "updated from email" and the date, a history line, and Undo. A soft "possibly off" note shows only when something does not match.
- Subscriptions: clear receipts from a known AI service are added on their own as "auto-detected" rows with Edit, Undo, and Remove. A daily rescan keeps them current and keeps what you edited.
- Refocus Find searches this PC (Videos, Downloads, Desktop, Documents, Music, Pictures, OneDrive, Google Drive), Claude folders and sessions, Grok Bot results, and other agents. Nothing found says where it looked.
- Settings, Plan has one box for a licence key or a promo code, with plain messages when a code is used up or typed wrong.
- In demo mode a banner on every screen says you are using pretend AIs, with Exit demo mode. Demo AIs leave once any real AI, app, or tool connection is saved.
- Every button shows Working... while it runs, then Done.
- Simple starts with Chat. Connections (Zapier and Make, keys, your apps, the browser extension, HighLevel) are under More. Start a project sits right before Projects.
- Menus: Settings holds settings only, Help holds help, and every page has a menu item. Wider windows show the most used pages right on the top bar.
- The desktop card (Allow Antigravity and similar) closes on the first click and stays closed for the session.
- The header shows Cloud while a job runs in the cloud. Point at it for the full text.

**Fixed**
- Demo jobs run again when only a tools server is connected and demo mode was turned back on. This was the failing Windows check.

**Still here**
- Home, Private mode, and Backup and restore stay in this build.
- Background runs, Together, People, Remix, Zapier and Make, and hosted runs are in this build. A send still waits for a click.
- The Mac build is unsigned. On macOS 15 or later, open System Settings, then Privacy and Security, then Open Anyway.

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
