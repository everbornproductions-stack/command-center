# Command AI user guide

*Command AI, an Everborn product by Everborn Productions.*

Command AI is one window for every AI you pay for. You type what you want once; it picks the right AI for each part, lets them check each other's work, shows who is working in real time, and keeps track of what everything costs. Your keys stay on your computer and you pay the AI companies directly.

This guide is for people using the app. Developers: see README.md and docs/plugin-api.md.

## 1. Install and first start

1. Run **Command-AI-Setup-<version>.exe**. Windows SmartScreen may warn once because the build is not code-signed yet: choose "More info", then "Run anyway".
2. The app opens in its own window and keeps running in the tray when you close the window. Quit from the tray icon.
3. On the very first start the app shows **Setup**. The first choice is **I am willing to share anonymous track records**. A new setup checks it. Meldmind learns from every job you run. Anonymous track records help it pick the best AI for everyone. What we share is only anonymous track records: the task type, which AI, and the score. We never share prompts, content, or keys. You can change this any time in Settings. If you clear the box, this note appears: Meldmind learns from the community. With this off, your jobs won't help make it smarter for everyone, but you'll still benefit from what others share. Then every other step is optional and runs on your computer only:
   - look through your browser history for the AI tools you already use,
   - check for API keys already on this PC (OpenRouter is the recommended first key: one key reaches Claude, GPT, Gemini, Grok, DeepSeek, Llama and more, and free models are available),
   - make an "AI" bookmark folder.
   Setup appears only once. Later starts open the hub. You can run it again from **Settings > Run setup again**.
   After that first setup, a new install shows **Get everything connected**. Each integration (Gmail, Google Drive, Google Calendar, HighLevel, CapCut, Kling, ElevenLabs, Suno, Google Flow, Cursor, and the others) shows Connected, Not connected, or Handoff. Gmail and Outlook list each account. Add another asks for a label, then uses the same sign-in. Skip any row, or finish later. **Run setup again** is in Settings and in the Help menu.

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

### Simple and Expert

New installs open in Simple. The first time, Meldmind asks "Keep it simple or show me everything?"

Simple is one chat box. You say what you want, and the council picks the AI. The top bar shows Chat, Projects, Create, Help, and Settings. The chips under the box list only AIs you have connected (a saved key the provider accepted, or an MCP server). Demo shows there only while none are connected.

Help searches the guides. Ask Meldmind answers from those guides with a connected AI. With no AI connected, it searches and does not invent steps. Take the tour again and Check for updates are on that page.

Expert is the full console: the council debate, router scores, spend caps, the live map, marketplace, MCP, webhooks, and every menu.

The Simple / Expert switch is in the top bar on every screen. One click changes it. Chats, projects, and keys stay where they are. You can switch back the same way. Hidden tools are still there in Expert, and the keyboard shortcuts keep working in both.

**Phone pairing** (Settings > Phone and other devices) is off until you turn it on. Then the QR code and the address under it use this PC's Wi-Fi address, with a pairing code. Copy the address if the camera cannot scan. The phone and the PC need the same Wi-Fi. On Windows, install and the first time you turn pairing on add an allow rule for Meldmind on private networks only. Turn it off and the PC answers only on this computer again.
2. Pick how to run it:
   - **Single**: the best AI for the job answers.
   - **Council**: several AIs answer, review each other without knowing who wrote what, and a chair writes the verdict.
   - **Mission**: the job is split into tasks, each goes to the best-fit AI, a different AI checks every result, and the parts are put together at the end.
3. **Priority** (Quality, Balanced, Max savings, Speed) applies to Single, Council and Mission. Quality favours the stronger model, Balanced splits the difference, Max savings picks the cheaper model, and Speed picks the faster one. A connected free model on this PC (Ollama, LM Studio, Aider, OpenCode, or another local OpenAI-compatible endpoint) is tried first on Max savings, and on Balanced when it is close in quality. Quality still keeps the stronger paid model when the gap is large. Speed tries a local model when it is close. **When > Off-peak** waits for a discount window. The route preview can mention a batch price (about half) for work that can wait. A run you send now pays the live price. An off-peak discount is already in the estimate when one is open.
4. **Preview route** shows, before anything is spent, who would get the job and roughly what it costs.
5. The cap (Cap $) stops a mission from spending more than you allow.

While it runs, **Live ops** shows each AI as it works, and the **Live feed** on the right lists every step. Under the finished deliverable you can copy it, rate each AI (thumbs up or down, which teaches the router), see the savings receipt, open it in the Artifacts panel, share a read-only link, or send it on (see section 8).

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
| Remix | Rebuild an app or game you can see, from scratch, with your own characters and ideas. A Pro mission. Extreme has no monthly cap. |
| Marketplace | Share or install pipelines as signed files (local and demo catalog) |
| Who's best | What the router has learned about which model is best at what, for your work. Add community track records there if you have a file of anonymous totals from people who opted in. Quality, Balanced, Max savings, and Speed all use it. Nothing is uploaded. |
| Workspaces | Teams: invite links, roles and shared projects (Studio plan) |

## 8. Sending things out: always your click

Nothing posts, sends, emails or spends without a click from you.

- **Post to Instagram, Schedule in HighLevel, Send to Slack, Save to Drive** sit under every deliverable. Each one shows a preview first and sends exactly what you previewed only after you confirm.
- Connect each service in **Settings > Publishing** with your own sign-in. Until a service is connected, the button is a dry run that sends nothing.
- The **Grok Bot** and the **browser helper** ask for your OK before any send, post, delete, purchase or form submit.

## 9. Updates

When a new version is out, the app shows "Command AI vX.Y.Z is ready" with **Install now** and **Later**. Nothing downloads until you click Install now. The tray also has Check for updates, Install update and Restart app. Your data stays where it is.

## 10. When something goes wrong

| What you see | What it means and what to do |
|---|---|
| A red message "Could not reach Command AI's engine" | The local engine stopped. Use **Restart engine** in the panel that appears, or Restart app in the tray. Your settings, keys and history are kept. |
| "Command AI's engine is not responding" panel | Shown after about 15 seconds without an answer. Restart engine, Check for updates, or Keep waiting. |
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
