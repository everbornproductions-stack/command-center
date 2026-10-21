# Meldmind user guide

*Meldmind, an Everborn product by Everborn Productions.*

Meldmind is one window for every AI you pay for. You type what you want once; it picks the right AI for each part, lets them check each other's work, shows who is working in real time, and keeps track of what everything costs. Your keys stay on your computer and you pay the AI companies directly.

This guide is for people using the app. Developers: see README.md and docs/plugin-api.md.

## 1. Install and first start

1. Run **Meldmind-Setup-<version>.exe**. Windows SmartScreen may warn once because the build is not code-signed yet: choose "More info", then "Run anyway".
2. The app opens in its own window and keeps running in the tray when you close the window. Quit from the tray icon.
3. On the very first start the app shows **Setup**. The first choice is **I am willing to share anonymous track records**. A new setup checks it. Meldmind learns from every job you run. Anonymous track records help it pick the best AI for everyone. What we share is only anonymous track records: the task type, which AI, and the score. We never share prompts, content, or keys. You can change this any time in Settings. If you clear the box, this note appears: Meldmind learns from the community. With this off, your jobs won't help make it smarter for everyone, but you'll still benefit from what others share. Then every other step is optional and runs on your computer only:
   - look through your browser history for the AI tools you already use,
   - check for API keys already on this PC (OpenRouter is the recommended first key: one key reaches Claude, GPT, Gemini, Grok, DeepSeek, Llama and more, and free models are available),
   - make an "AI" bookmark folder.
   Setup appears only once. Later starts open the hub. You can run it again from **Settings > Run setup again**.
   After that first setup, a new install shows **Get everything connected**. Each integration (Gmail, Google Drive, Google Calendar, HighLevel, CapCut, Kling, ElevenLabs, Suno, Google Flow, Cursor, and the others) shows Connected, Not connected, or Handoff, plus a short list of steps for that service. Gmail and Outlook list each account. Add another asks for a label, then uses the same sign-in. Skip any row, or finish later. **Run setup again** is in Settings and in the Help menu. **Your apps** (Settings) is where a HighLevel account, an MCP server by address, and a custom webhook are connected. A change waits until you click Send.
   The same first screen includes **Let Meldmind use your desktop**. It explains that you allow each app, that a send, a buy, or a delete waits for a second click, that a banner says Meldmind is using that app and has Stop, and that passwords are not stored. **Allow Antigravity** and **Install and connect** are on that screen. Install and connect runs Google's installer, then opens sign-in in your browser. You can skip it and change it later in Settings.

Your settings, keys and history live in `%APPDATA%\Everborn Command\data` and survive updates and reinstalls.

## 2. Try it without keys (demo mode)

**Settings > Demo mode** brings three pretend AIs online (Nova, Atlas and Sage). Everything works with them and nothing is spent. When you save your first real key, the demo AIs leave on their own and a message tells you so. Past demo runs stay in your history, marked "demo". You can turn demo mode back on in Settings at any time.

**Settings > Appearance** sets dark, light, or match the system, an accent colour, and a background colour. Theme presets, gradients, and built-in pictures are there too. Your photo is chosen from a file on this computer. A web address is not accepted. Built-in puts the original background back. A dim, blurred layer keeps text readable over a picture. The choice is saved on this PC.

## 3. Add your API keys

**Settings > Guided API-key setup** walks you through one provider at a time: where to get the key, paste it, a test call, then it is locked in the vault. A key that the provider refuses is never kept.

You can also paste a key into the box at the top of Settings. The app recognizes Gemini (AQ. and AIza), Claude (sk-ant-), ChatGPT (sk- and sk-proj-), Grok (xai-), OpenRouter (sk-or-), and Groq (gsk_). If it cannot tell, pick the provider from the list. The key is tested and is never written to the log.

- Paste a key anywhere and the app suggests which provider it belongs to.
- The light on the provider's tile turns green when the key works.
- "Key rejected (401)" means the provider refused the key. "Could not reach <provider>" means a network problem, not a bad key.
- **Add custom provider** connects any OpenAI-compatible or Anthropic-compatible service (OpenRouter, Groq, DeepSeek, Mistral, a local Ollama, LM Studio, Aider, OpenCode, or another OpenAI-compatible endpoint on this PC). Freebuff is not used. Aider starts at Ollama's address. Change it if Aider uses another server. OpenCode is only for when it serves an OpenAI-compatible /v1. The default port is 4096. Change the address if yours is different. Meldmind learns what that app or AI is good at from its name, or from the task types you tick. Matching tasks go to it. Scores from your jobs make the pick sharper.

Keys are never shown again after saving and never written to a log.

## 4. Give orders (the Command tab)

1. Type what you want in **Marching orders**. One line is enough. Press **Send orders** (or Ctrl+Enter).

**Upload** adds a file, a screenshot, or a document to the box. **Voice** writes what you say into the box. Edit the words, then send. Nothing is sent until that click. In Simple, the same buttons sit under the chat box. Tap to talk is separate: its auto-send box can still send when you turn that on.

A picture or a video can go further. Choose Retouch, Variation, Describe, Trim, or Caption. Those only fill the box. **Show the plan** names the connected AI and the price, or says "Demo, nothing spent." **Run** is a second click. You can preview the result, download it, or save it in a project. Nothing is posted. Pictures can be 8 MB, videos 12 MB, and other files 4 MB. A picture over 3.5 MB can stay attached, and the page says it is too big to retouch.

**Suggest a connection or idea** is in Settings. Upload and Voice work there too. You read the exact note, then click Send. After that you can edit, delete, or re-prioritize the idea, add a comment, and set a status: new, planned, building, or shipped. Those later changes stay on this computer.

### Simple and Expert

New installs open in Simple. The first setup step asks which mode you want to start in. You can change this later.

Simple is one chat box. You say what you want, and the council picks the AI. The top bar shows Chat, Projects, Create, Help, and Settings. The chips under the box list only AIs you have connected (a saved key the provider accepted, or an MCP server). Demo shows there only while none are connected.

Help searches the guides. Ask Meldmind answers from those guides with a connected AI. With no AI connected, it searches and does not invent steps. Take the tour again and Check for updates are on that page.

Expert is the full console: the council debate, router scores, spend caps, the live map, marketplace, MCP, webhooks, and every menu.

The Simple / Expert switch is in the top bar on every screen. One click changes it. Chats, projects, and keys stay where they are. You can switch back the same way. Hidden tools are still there in Expert, and the keyboard shortcuts keep working in both.

**Phone pairing** (Settings > Phone and other devices) is off until you turn it on. Then the QR code and the address under it use this PC's Wi-Fi address, with a pairing code. The QR opens a short address. The address under the code also works. A Wi-Fi address is preferred over a virtual adapter. Copy the address if the camera cannot scan. The phone and the PC need the same Wi-Fi. On Windows, install and the first time you turn pairing on add an allow rule for Meldmind on private networks only. Turn it off and the PC answers only on this computer again.
2. Pick how to run it:
   - **Single**: the best AI for the job answers.
   - **Council**: several AIs answer, review each other without knowing who wrote what, and a chair writes the verdict.
   - **Mission**: the job is split into tasks, each goes to the best-fit AI, a different AI checks every result, and the parts are put together at the end.
3. **Priority** (Max quality, Quality, Balanced, Max savings, and Speed) applies to Single, Council and Mission. Max quality is part of Extreme. It uses the best model each connected AI offers, with more reasoning and a longer context, inside the budget cap. Quality favours the stronger model, Balanced splits the difference, Max savings picks the cheaper model, and Speed picks the faster one. A connected free model on this PC (Ollama, LM Studio, Aider, OpenCode, or another local OpenAI-compatible endpoint) is tried first on Max savings, and on Balanced when it is close in quality. Quality still keeps the stronger paid model when the gap is large. Speed tries a local model when it is close. **When > Off-peak** waits for a discount window. The route preview can mention a batch price (about half) for work that can wait. A run you send now pays the live price. An off-peak discount is already in the estimate when one is open.
4. **Preview route** shows, before anything is spent, who would get the job and roughly what it costs.
5. The cap (Cap $) stops a mission from spending more than you allow.

While it runs, **Live ops** shows each AI as it works, and the **Live feed** on the right lists every step. The live map has **Start a project** tutorials. Watch on the map plays an example and does not call an AI. Start this project opens the real walk. Sending still needs a click. Under the finished deliverable you can copy it, rate each AI (thumbs up or down, which teaches the router), see the savings receipt, open it in the Artifacts panel, share a read-only link, or send it on (see section 8).

## 5. Projects

Projects group links, runs, files and memory for one client or campaign. Pick a project in Command and everything you run is filed under it.

- **Project memory** (Settings): brand voice, offers, a never-say list and facts, added to every prompt for that project.
- **Files in this project**: drop PDFs, Word files, text or images, see what it costs to read them, then click Add to project. Answers cite them as [L1], [L2].

## 6. Money: Credits, Subscriptions and caps

- **Credits**: spend by day and by AI, recent calls (a check mark means the exact billed amount), and "Who's best at what".
- **Subscriptions**: every paid AI service on one page, with price, renewal date, credits left and a plain signal (ok, renewing, low, attention). Prices you have not confirmed show as unknown.
- **Spend caps and alerts** (Settings): a monthly cap per AI. The tile turns amber at 80 percent; at 100 percent that AI is skipped and the next best one does the work.
- **Smart fallback**: when an AI is out of credits, rate limited or refusing its key, the job moves to the next-best AI and the deliverable says who stood in and why.

## 7. More tabs

| Tab | What it is for |
|---|---|
| Compare | One prompt to 2 to 6 models side by side, with cost and speed per column |
| Libraries | Your own documents as a searchable knowledge library for chats, councils and missions |
| Agents | Your own named agents with instructions, tools and libraries, plus saved prompts |
| Schedules | Run an agent, chat or mission on a timer, from a webhook or when a file arrives |
| Media | Video, image and voice through Kling, ElevenLabs, Runway and fal.ai, estimate first |
| Pipelines | Saved missions with the steps already decided (Instagram week, music video, site launch) |
| Marketplace | Share or install pipelines as signed files (local and demo catalog) |
| Who's best | What the router has learned about which model is best at what, for your work. Add community track records there if you have a file of anonymous totals from people who opted in. Quality, Balanced, Max savings, and Speed all use it. Nothing is uploaded. |
| Workspaces | Teams: invite links, roles and shared projects (Studio plan) |

## 7a. Apps on your desktop

Meldmind can use an app on this PC that has no API, after you allow that app.

**Settings > Google Antigravity** is the first one.

- Tick **Allow Meldmind to hand coding tasks to Antigravity**. Clear it any time. The manual handoff stays available.
- **Install and connect** runs Google's installer, then opens sign-in in your browser. You sign in once. Meldmind does not see the password.
- **Check** sends one short test task. **Send task** hands over the words you typed. **Stop** ends the task that is running.
- **Add to Antigravity** writes the Meldmind server into Antigravity's MCP config on this PC, and only after you confirm. Other servers in that file stay. The bridge token stays in Meldmind's data folder. It is not copied into the config.

You confirm before a send, a buy, or a delete. While an app is in use, a banner says Meldmind is using that app, and Stop ends it. Passwords are not stored. If a control in an app moves, Meldmind tries the other ways it knows to find it, then stops and offers the manual handoff.

After you update to 0.4.9, the first launch shows **New: let Meldmind use your desktop**, with the same choices. **Not now** reminds you once. **Never** hides the card.

Help has the same steps under Apps on your desktop. Take the tour again includes that stop.

## Programs on this PC

Program scan is part of Pro. On Free the list stays off.

Turn on desktop control in Setup or in Settings. Meldmind lists installed programs. On Windows that list comes from the uninstall list and the Start menu, plus command-line tools on PATH. It reads names only. File contents are not read.

Allow the apps you want. Allowed apps are scored and join the router's choices, the same as a tool you add. They do not replace the AIs that write.

While you plan a mission or client work, a card may suggest a program that would speed the job up. It shows a short reason, Free or Paid, and the official link. Dismiss hides that card. Meldmind will not install or buy anything. Turn suggestions off under Settings, Programs on this PC.

## 8. Sending things out: always your click

Nothing posts, sends, emails or spends without a click from you.

- **Post to Instagram, Schedule in HighLevel, Send to Slack, Save to Drive** sit under every deliverable. Each one shows a preview first and sends exactly what you previewed only after you confirm.
- Connect each service in **Settings > Publishing** with your own sign-in. Until a service is connected, the button is a dry run that sends nothing.
- The **Grok Bot** and the **browser helper** ask for your OK before any send, post, delete, purchase or form submit.

## Plain requests

On Chat, the box titled Try saying... takes a sentence such as "email this client and put it on my calendar". A cheap fast AI drafts the email and the event. The cost is shown, usually a fraction of a cent. Click Approve once and Meldmind sends the email through connected Gmail and creates the event on connected Google Calendar. Nothing is sent before that click. The drafting AI does not touch those accounts. Grok Bot's calendar handoff is unchanged.

## Google Calendar

Settings, Google Calendar, lists events after you connect with your own Google sign-in. Create event and Update run only when you click. Free includes 1 connected service. Pro includes every connected service. Grok Bot can still take calendar work. That handoff is unchanged.

## 9. Updates

When a new version is out, the app shows "Meldmind vX.Y.Z is ready" with **Install now** and **Later**. Nothing downloads until you click Install now. The tray also has Check for updates, Install update and Restart app. Your data stays where it is.

## 10. When something goes wrong

| What you see | What it means and what to do |
|---|---|
| A red message "Could not reach Meldmind's engine" | The local engine stopped. Use **Restart engine** in the panel that appears, or Restart app in the tray. Your settings, keys and history are kept. |
| "Meldmind's engine is not responding" panel | Shown after about 15 seconds without an answer. Restart engine, Check for updates, or Keep waiting. |
| "Key rejected (401)" | The provider refused the key. Make a new key on the provider's site and paste it again. |
| "Could not reach <provider>: <reason>" | A network or provider problem. Smart fallback moves the work to another AI meanwhile. |
| "Request failed (HTTP 500)" or a tab says it "could not open" | Something broke inside the app. Click **Try again**; if it repeats, restart the app and tell Everborn what you clicked. |
| A tile is red or amber in the status strip | Click the tile to open that AI's settings and see why. |
| "This phone cannot reach the PC" or "The phone cannot reach this PC" | The phone and the PC are not on the same Wi-Fi, phone pairing is off, or Windows Firewall is blocking Meldmind. Turn phone pairing on in Settings, under Phone and other devices, and allow Meldmind on private networks. |
| "This pairing link is not valid" | The code in the link does not match. On the PC, open Settings, Phone and other devices, and scan the code that is on screen. |

## 11. Keyboard and accessibility

- **Tab** moves through every control. A clear ring shows where you are.
- **Skip to content** is the first stop after the page loads, so you can jump past the tabs.
- Project cards, recent runs and the status tiles open with **Enter** or **Space**.
- **Ctrl+Enter** in Marching orders sends the orders.
- Screen readers hear which tab is open, which run mode is chosen, the connection state, and every message (errors right away).
- If your system asks for reduced motion, the app's blinking and pulsing stop and the live flow map switches to its calmer view.

## 12. Privacy in one paragraph

Your API keys are sealed on your computer (Windows DPAPI) and only sent to the AI company they belong to. The app keeps your history, ledger and settings in your own data folder. Meldmind learns from every job you run. If you opt in, the anonymous scores from each job (task type, cost, speed) also help it pick the best AI for everyone. The learning router keeps scores, costs and the type of each task, never your prompts, answers or keys. You can turn that off any time in Settings. Nothing is shared with Everborn unless you turn on a feature that says so.
