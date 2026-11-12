# App control: driving apps that have no API

Plan only. Nothing in this file is in the run order. Build it when Chris adds a phase. Locked decisions in docs/DECISIONS.md stay as written.

Chris wants Meldmind to use apps the person adds when those apps have no API: desktop programs and websites. Meldmind drives them. An app that already has an MCP server connects through that server instead. Each added app then joins the same capability and score system as a user-added AI, and a mission can hand it a step.

The recommendation is three doors, one score, and one safety gate.

- If the app has an MCP server, use the MCP client that is already shipped.
- If it is a website, drive the page through its buttons and fields, in a browser profile Meldmind owns.
- If it is a Windows desktop program, drive it through the accessibility tree of the one window the person allowed.
- Screenshot computer use (Anthropic's computer toolset, or OpenAI's computer tool) is the fallback for a window the tree cannot read, and it stays off until the person turns it on for that app.
- Grok Bot and the built-in browser helper keep the jobs they already take.

## What is already built

A later phase should extend these pieces. It should leave their current behavior in place.

**User-added AIs and the score.** `server/added-caps.js` turns a name, or task types the person picks, into starting scores. The eight task types are `reasoning`, `code`, `writing`, `research`, `creative`, `analysis`, `math`, and `fast` (`CAPABILITIES` in `server/registry.js`). A chosen type starts at 90. The others start at 46. No signal at all stays even (the general scores around 70 to 75). `rank()` in `server/router.js` blends that start with the learning router: council scores, thumbs, cost, latency, and success (`server/brain.js`). Who's best lists any id that has a record. A custom provider is registered as a text model, so `rank()` can pick it for a chat.

**Outside agents.** Grok Bot (`server/grokbot.js`) and the built-in browser helper (`server/browser.js`) are agents. They sit beside the text models and stay out of the text ranking. `server/agents.js` gives a council or a mission at most one of them. Grok Bot wins when it is set up and the step needs signed-in browsing, Gmail, Drive, Calendar, or teammate bots. The helper takes website, Gmail, and Drive steps when Grok Bot is not the one doing that job. Plain writing, research, and analysis stay with the text AIs. The helper reads the page as text plus a numbered list of controls, asks the cheapest capable model for one action, and stops at 12 steps or $0.25 unless the person raises those limits. Its window uses the session `persist:cc-browser-helper`.

**Missions.** `server/mission.js` plans steps, then assigns each step. A step marked `agent`, or a step whose wording matches the agent's tags, is dispatched to that one agent. The mission waits (15 minutes by default), then goes on. A late result is attached to the step and the deliverable when it arrives. The planner is told, in the same prompt, never to use `agent` for plain text work.

**Live Ops.** `server/liveview.js` builds the flow map from the events the rest of the app already emits: `agent.start`, `agent.done`, `agent.error`, `agent.msg`, `task.update`, `external.handoff`, and `ledger.entry`. `server/external-agents.js` knows Grok Bot, the browser helper, and Cursor. `registerExternalAgent()` adds a later agent. A handoff status of queued or sent shows as Sent, working or needs_approval shows as Working, and done or failed shows as Reported back. The map pulses from the hub to that node and back. An Open link is https only, and the page is never fetched. The node list already accepts an id it has not seen before.

**MCP.** Phase 16 (`server/mcp.js`) already adds local stdio servers and remote HTTP servers, keeps secrets in the vault, and lists tools per workspace. A tool that writes, sends, or deletes always asks. A read-only tool skips the prompt only when the person turned that on for the server. There is one MCP client. Decision 21 says a second client is not added.

**The API path is a different plan.** Phase 33 in docs/BUILD-PLAN.md is connectors, webhook tools, and MCP-by-URL for apps that have an API. This plan is the path for apps that do not. Where an app grows an MCP server later, it moves to the MCP door. The driving doors stay for everything else.

## Approach options

### MCP, when the app has a server

The person pastes a server URL or a local command, the same way Settings > Tools works today. The model calls named tools. It does not click the app.

| | |
|---|---|
| Fits | Zapier, Make, and any product that publishes an MCP server. Also a desktop app that ships one. |
| Cost | One tool-calling model turn, plus whatever that server's vendor charges. No screenshots. |
| Safety | The approval gate is already there. Secrets stay in the vault. |
| Limit | Useless for an app that has no server. A tool can still do the wrong thing if its description is vague, so the confirm step stays. |

This is the door to prefer whenever it exists. Driving a window covers the apps that have no server.

### Website, by reading the page

Playwright opens Microsoft Edge (it is already on Windows) and reads the same kind of list the browser helper reads today: title, text, links, buttons, fields, forms. The model returns one action: open, click, type, scroll, back, ask, done, or fail. Playwright talks to Edge. Meldmind does not have to ship a copy of Chromium.

A Meldmind-owned profile lives under the user-data folder (`%APPDATA%\Everborn Command\app-profiles\<app id>`). The person signs in once in that window. Cookies stay there. The built-in helper's session is a separate window and stays as it is.

| | |
|---|---|
| Fits | Web apps with real buttons and fields: a CRM in the browser, a webmail page, a form. |
| Cost | Text tokens only. The same order of cost as the browser helper, whose default cap is $0.25 and 12 steps. |
| Safety | The action names a control. The gate can show the button label and the field values before anything is sent. |
| Limit | A canvas, a custom-drawn control, or a site that blocks automation needs the screenshot fallback. Sign-in, a captcha, or a password is an `ask`: the person does it in the window. |

Element actions are the default. Pixel clicks are the fallback below.

### Website, using a signed-in Edge or Chrome profile

A later, opt-in phase can point Playwright at a profile the person already uses, so they do not sign in again.

On Windows the live profile is locked while Edge or Chrome is open. The bookmark organizer already refuses to edit bookmarks for that reason. This phase follows the same rule: the person closes that browser, Meldmind uses the profile for the job, and it tells them to keep the browser closed until Stop. Copying a profile copies signed-in cookies. The warning on the Allow screen says that in plain language. The profile is never uploaded and never written into git.

Attaching to a browser that is already open, through a remote-debugging port, shares the live session with no boundary. That option stays out of this plan until Chris asks for it.

Driving chatgpt.com or claude.ai this way is the relay idea in decision 27. It stays off unless the person turns relay on, and the live map shows a relay tag when it is on. Consumer sites can object to automation. The Allow screen says so.

| | |
|---|---|
| Fits | A site where signing in again is the whole pain. |
| Cost | Same as the page-reading door. |
| Safety | Higher. The profile holds the person's real sessions. One wrong click can send as them. The confirm gate and the allowlist are what keep that in bounds. |
| Limit | The browser must be closed. A copy goes stale. Some sites detect automation. |

### Desktop, Windows accessibility

Windows UI Automation walks the named controls of a window: buttons, edits, lists, menus. The model sees a tree, like the page list, and returns an action on a control id. The app then invokes that control. This covers a large share of Win32, WPF, WinUI, and Electron programs, which expose the tree even when they look custom.

The person names one program (an exe) when they add the app. Clicks go only to a window of that program, and only while it is in front. If focus leaves, input stops.

| | |
|---|---|
| Fits | QuickBooks, a mail client, Office, and most line-of-business programs that expose controls. |
| Cost | Text tokens. No screenshot. UI Automation is part of Windows and adds no license fee. |
| Safety | The gate can name the control ("Delete" on invoice 1042) before it runs. Password edits are visible as password edits and are refused. |
| Limit | Games, drawing canvases, and some older programs expose a blank tree. Those need the screenshot fallback. A program the person did not name is out of reach. |

Two ways to call UI Automation, to be picked in that phase by a Windows spike:

- A small PowerShell or .NET call, the same family as the DPAPI key storage. No extra file in the installer.
- A direct call to `UIAutomationCore.dll` through a maintained FFI. Faster, and it has to pass the Windows installer build.

Prefer the one that keeps the current installer layout. Decision 2 keeps `appId`, the user-data folder, and the update feed stable.

### Desktop and websites, by screenshot (computer use)

The model receives a picture and returns mouse and keyboard actions in pixels. Anthropic's current toolset is `computer_toolset_20260801` (Claude 5.5 and later on the Claude API). OpenAI's current path is the Responses API computer tool. The old `computer-use-preview` model was shut down on 23 July 2026.

Meldmind owns the loop. The provider's hosted browser (Browserbase, Operator, and similar) is out of this plan: the person's apps and sessions stay on their PC.

| | |
|---|---|
| Fits | A window whose tree is empty, and a page whose controls are drawn on screen with no names. |
| Cost | High. Every step sends a picture, and the picture stays in the prompt unless the app drops old ones. See Cost. |
| Safety | The model aims at pixels. A click can land on the wrong control. The gate still blocks send, buy, and delete, and the allowlist still limits which window can be touched. The banner and Stop stay up for the whole job. |
| Limit | Off until the person enables it on that app. A separate, tighter spend cap. Easy to burn a dollar on a long task. |

Anthropic also documents a browser-use toolset that acts on the page itself. If a later spike shows it is cheaper than screenshots for web apps, it can sit behind the same page-reading door. The safety gate still wraps it.

### Hand the job to Grok Bot

Grok Bot already has a computer, a signed-in browser, Gmail, Drive, and Calendar. When it is set up, those tags still go to it. A user-added app does not take them. This plan is for everyone else's apps, and for Chris's apps that are not those five tags.

## How an app joins the score

An added app is scored the way an added AI is scored. It is not inserted into `TEXT_PROVIDERS`, so a CRM cannot win a plain writing chat by accident.

Each app stores:

- A name the person typed, and a stable id (`app-` plus a short slug).
- A kind: `website`, `desktop`, or `mcp`.
- The task types the person says it is good at, from the same eight. `profileFor()` and `capsFor()` in `server/added-caps.js` produce the starting scores. A name hint is only a suggestion. The person can change the list, and a chosen list is kept (`capabilitiesSource: "chosen"`).
- An allowlist: one site origin, or one exe. An MCP app points at a server id that already exists.
- Allowed to be picked: off until the person clicks Allow. A second switch, off at first, lets the router hand it matching tasks on its own. Until that switch is on, a mission uses the app only when the step names it or the planner marks that step for it.

The score uses the same math as `adjust()`: starting quality, then the track record, then a penalty for the money and the time the job really took. Who's best already renders any id in the brain. The app registry supplies the display name, so the row reads QuickBooks. `learnedStrengths()` can show on the app's settings card after four jobs, the same rule as a custom provider.

What the record keeps: the app id, the task type, success or failure, a score when a council or a QA pass gives one, thumbs, cost, and seconds. It does not keep the prompt, the page text, the window tree, a screenshot, a key, or a password. That is the same boundary as decision 18.

One existing quirk has to be avoided. `cleanCap()` stores an unknown task type as `reasoning`. Mission steps for Grok Bot pass `capability: "agent"`, so those rows land on reasoning. An app job passes one of the eight types the person assigned. The word `agent` is not a task type.

Anonymous sharing, if it is ever sent, keeps counts and averages. A person-named app is shared as its kind (`website`, `desktop`, or `mcp`) plus the task type and the score. The custom name, the site, and the exe path stay on the PC.

Spend caps and smart fallback apply to every model call the driver makes. The app itself has a per-job cap. Hitting the cap stops the job the way the browser helper's $0.25 cap does.

## How a mission hands an app a step

Today one mission has one outside agent. This plan lets each step name its own app. Grok Bot and the browser helper keep first claim on their own tags.

1. The planner sees the approved apps: name, kind, task types, and whether the router may pick them. The prompt still says to keep plain text on a text model.
2. A step that needs Grok Bot's tags goes to Grok Bot when Grok Bot is ready. A website, Gmail, or Drive step goes to the built-in helper when that is who `missionAgent()` would pick today. A user app is chosen for a step when the step names it, or when the router switch is on and that app's score is the one to beat for a task type it is allowed to take.
3. The dispatch matches the Grok Bot shape: a task, the context from earlier steps, the mission id, and a job id. The driver runs locally. There is no webhook and no tunnel.
4. The mission waits up to the same 15 minutes, then continues. The step shows "still out" in the same words the agent steps use. When the result arrives it is stored on the step and added under that step's title in the deliverable.
5. The result is markdown text, plus up to 20 https links. A file the app exported is saved only after the confirm click, and only into a folder the person chose for that app. The path is recorded on the step. Nothing is written into the repo or into `data\`.
6. Stopping the mission cancels the app job: no further clicks, and the in-flight confirm is dropped.

A council still uses at most one outside helper for the whole question in the first scoring phase, which is how `pickAgent()` works today. A council seat for a user app waits until the mission path is solid. When it is added, the answer sits with the others, is scored, and can be credited in the brain, which is how Grok Bot's seat works.

A click can also send one task to an app from its card, the same as Send to Grok Bot. That click is the start. It is not permission to send, buy, or delete.

## Safety

These rules apply to every door, including MCP.

**Per-app approval.** Adding an app saves a draft. The router and the planner cannot see it. The Allow screen shows the name, the kind, the exact site or program, the task types, the per-job spend cap, and the list of actions that will always ask. Allow is a click. Revoke removes it from the router immediately and stops a job that is already running.

**Confirm before a send, a purchase, or a delete.** The same classes the browser helper already blocks on: send, reply, post, publish, share, delete, remove, unsubscribe, cancel a subscription, buy, pay, order, checkout, subscribe, transfer, and any form submit. Desktop adds the same words on a button, a menu item, or a dialog, plus saving over an existing file and pressing Delete on a row. The prompt shows what will happen, the control's name, and the field values. Passwords and card values are left blank in that prompt. The buttons are "OK, do it" and "No". No answer within the wait (10 minutes, the helper's default) stops the job and does nothing. A No is handed back to the model as "do not try that again".

**The visible banner and Stop.** Before the first click, the Electron main process opens a small always-on-top window: "Meldmind is using X", with a Stop button. X is the app name the person gave. If that window cannot be shown, the job does not start. The window stays above the app being driven and is raised again if something covers it. Stop is also on the tray icon and on the Live Ops run. Stop means no more keystrokes or clicks, release any held key, and mark the job stopped. A desktop program the person owns is left open, so a half-written invoice is not thrown away. A browser window Meldmind opened is closed. Closing that browser window is also Stop.

**Sandbox.** The job may touch only the origin or the exe on the Allow screen. Website work uses the Meldmind profile for that app. Desktop work stops when the allowed window is no longer in front. The driver refuses to type into a password field, a card field, or a Windows Security / credential dialog, and it refuses Square and billing pages, matching the helper. The model never receives OS admin rights. A full second desktop, and the Windows Sandbox feature, are out of the early phases: the person's real files and sign-ins are the point of the feature, and a fresh VM has neither.

**Passwords.** Meldmind never stores a site password, an app password, or a card number. It does not read those fields into the log, the prompt, the brain, the deliverable, or the vault. The vault keeps API keys and MCP headers only, as it does now. When a step needs a sign-in, the banner asks the person to type it. Those keystrokes are not recorded.

**Instructions on the page stay data.** Button labels and window text are shown to the model as the thing to act on. They are not orders to Meldmind. The gate is what decides whether an action runs. This is the same rule the browser helper already uses.

**Nothing goes out on its own.** A mission the person started may drive an allowed app. A schedule may not, until a later phase that uses the existing "needs approval" wait. Demo mode uses a pretend driver and a fixture window. It opens nothing.

**Screenshots and trees.** A picture or a control tree is sent only to the model the person picked for that job, with their own key. It is dropped when the job ends. It is not written to the brain and not committed.

## Windows first

The first drivers ship in the Windows desktop app. Mac stays where Phase 14 left it: anything that needs a Mac to verify is `PHASE 14 BLOCKED` with the reason, and the Windows installer is not held for it.

- Edge is the browser. Playwright uses the Edge already installed on the machine (`channel: 'msedge'`), so the installer does not gain a Chromium download.
- UI Automation is the desktop API. The spike chooses PowerShell/.NET or a direct library call based on which one the Windows build accepts.
- Tests fake the driver. They do not open Edge, do not read a real profile, and do not call UI Automation on the developer machine. Fixture trees and fixture pages only, on a temp directory.
- The hosted hub does not drive a desktop or a signed-in browser. Those jobs answer with a clear "this runs in the desktop app".
- The banner, Stop, and the Allow screen have keyboard focus and a text label. `prefers-reduced-motion` keeps the banner still. The flow map's reduced-motion behavior is unchanged.

## How results show in Live Ops

The driver emits the events Live Ops already understands. The map code stays the SVG and CSS view from decision 19.

| Moment | Event | What the person sees |
|---|---|---|
| Mission assigns the step | `task.update`, `agent.start` | The app's node lights up. The caption is the step title. A pulse moves from the hub to the app. |
| Driver accepts the job | `external.handoff` with status `working` | Status Working. The tooltip shows the step and the credits or cost so far. |
| Waiting for OK | `external.handoff` with status `needs_approval` | The map keeps Working (that is the existing mapping). The hub card turns amber, the same as the browser helper, and the banner asks the question. |
| Model call booked | `ledger.entry` | The running cost on the tooltip and the Live Ops panel includes it. |
| Result is in | `external.handoff` with status `done` or `failed`, then `agent.done` or `agent.error` | A pulse moves back to the hub. The handoff row shows the short result. The mission step and the deliverable get the full text. |
| Still running when the wait ends | the existing late-result listener | The step stays "still out". The node stays Working until the result or Stop. |

`registerExternalAgent()` adds the node: id, name, color, and `via` set to `website`, `desktop`, or `mcp`. An Open link appears only when the app has an https page the person saved. The page is not fetched.

The hub card uses the lights the other agents use: grey when the app is a draft or revoked, green when it is allowed, amber when it is waiting for an OK, red when the last job failed. The activity feed shows the latest action in one line ("Clicked Invoices"). Screenshots stay off this card.

Who's best updates when the job records its outcome, so the next mission can prefer the app that has been cheaper or more reliable at that task type.

## Cost

Prices below are the published API rates checked on 20 October 2026, and the prices already stored in `server/registry.js`. They will move. The ledger line is the number the product shows. Every call goes through the existing ledger and the existing spend caps.

**Page reading and the accessibility tree.** The model reads text. The browser helper's defaults are the right starting caps: 12 steps and $0.25 per job, both editable. The driver model is the cheapest capable model (`cheapest()`), overridable per app. Claude Haiku 5.5 is $0.10 per million input tokens and $0.50 per million output tokens in the registry. A short page-reading job fits inside the default cap. Playwright and UI Automation add no vendor fee.

**MCP.** The cost is the tool-calling turn on whatever model the council or mission already picked. The MCP server is not a second meter inside Meldmind.

**Screenshot computer use.** Anthropic's `computer_toolset_20260801` adds about 4,500 input tokens of tool definitions on every request before the picture (about 4,590 on Claude Sonnet 5, about 4,520 on the other models that support it). Each screenshot is on the order of 1,000 to 1,800 tokens, depending on size. Claude's own guidance is to downscale before upload (long edge within the model's limit) and to drop old screenshots so the bill does not grow with every step. Claude Sonnet 5.5 in the registry is $2 per million input tokens and $10 per million output tokens. At that rate a careful 15-step job, with old pictures removed, is often well under a dollar, and a long job that keeps every picture can run to several dollars. The Allow screen for this door says that, shows an estimate before the job starts, and defaults the cap to $1.00 with a hard settings ceiling the person can raise. OpenAI's computer tool bills the same way: input and output tokens, and screenshots count as image input. GPT-6.1 Sol is $2 and $10 per million tokens on the short-context standard rate, which matches the registry. There is no separate per-click fee in the current computer-use guide.

**Who pays.** The person's own key. A missing key stops the job with the usual "add a key" reason. Demo mode spends nothing and uses the pretend driver.

**What to put in the score.** The brain stores the observed dollars and seconds for the app id, so economy mode will start to avoid an app whose screenshot fallback is burning money, once it has a few jobs. Until those jobs exist, the starting score is only the task-type baseline, and the per-job cap is what protects the person.

## Phased build

Sizes match docs/BUILD-PLAN.md. M is about one working session. L is about two. The sizes describe which subsystems change. They are not a calendar promise.

Do phases 1 to 3 first if only part of this is funded. They put apps on the scoreboard and in missions with no mouse driver, using MCP that is already approved and already safe.

| Phase | Size | What it adds | Done when |
|---|---|---|---|
| 1. App cards | M | A settings list: name, kind, task types, origin or exe or existing MCP server, spend cap. Draft until Allow. Hub card, `registerExternalAgent()`, and a mock dispatch that emits `external.handoff`. | A mock app shows a node, a pulse, a cost of zero, and an activity line. Revoke hides it from the planner. No secrets in the view or the log. |
| 2. Score and missions | M | Starting scores from `added-caps.js`. Outcomes through `observe()` with a real task type. Mission steps can name an approved app. Grok Bot and the helper keep their tags. Late results follow the current listener. | A fixture mission hands one step to a mock app, waits, stores the text, and records a brain row under `analysis` (or whichever type the app claimed). A writing step still goes to a text model. Who's best shows the app name. |
| 3. MCP as an app | M | An existing MCP server can be marked as an app and given task types. Tool calls stay on the current client and the current approval gate. | A mock MCP tool runs from a mission step, asks on a write, and skips the ask on a read-only tool only when that server already allows it. No second MCP client. |
| 4. Websites | L | Playwright drives system Edge with a Meldmind-owned profile. Reuse the helper's action list, confirm gate, step cap, and spend cap. Banner and Stop. | A fixture page on a local port is filled in. The submit waits for OK. A password field is refused and is absent from the log. Stop halts the next action. The helper's own session is untouched. |
| 5. Signed-in profile | M | Opt-in Edge or Chrome profile, off by default. Refuses to start while that browser is running. Warning about cookies and site terms. Relay tag if the target is the ChatGPT or Claude site. | The running-browser check blocks the job. A closed-browser fixture profile is the only one tests touch. |
| 6. Windows desktop | L | UI Automation for one allowlisted exe. Same confirm gate and banner. Focus loss stops input. | A fixture tree clicks the allowed button, refuses a password edit and a Delete until OK, and does nothing when the foreground window is a different program. |
| 7. Screenshot fallback | L | Anthropic computer toolset and OpenAI computer tool, per app, off by default. Downscale, drop old pictures, estimate, $1.00 default cap. | A fixture image returns one click. The second step does not resend the first image. The job stops at the cap. Square and billing coordinates are refused before the click. |

Each phase lands with `npm test` and `npm run smoke` green, fixture drivers only, and no real site, key, or desktop session. User-facing strings have no em-dashes.

## Behavior this plan keeps

- The product name, appId, user-data folder, and updater stay as in decisions 1 to 4.
- Grok Bot's webhook, sender key, header, body, callback token, and statuses stay as in decision 15. Its five tags still prefer Grok Bot when Grok Bot is ready.
- The built-in browser helper keeps its own session, its OK gate, and its refusal of passwords, cards, Square, and billing (decision 17). Phase 4 adds a different driver beside it.
- Smart fallback, the ledger, and spend caps apply to every driver model call (decision 16).
- The learning router still stores task type, scores, cost, and latency, and still leaves out prompts and secrets (decision 18).
- Live Ops stays on the current events and the current map. New nodes register. Open links stay https and are never fetched (decision 19).
- MCP stays on the one client (decision 21). Phase 33 remains the plan for API connectors and custom webhooks.
- The app does not deploy anything, does not touch Square or billing, and does not post or send without a click.

## Sources for the cost figures

- Anthropic computer use tool and pricing, including the about 4,500 token toolset overhead: https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool and https://platform.claude.com/docs/en/about-claude/pricing
- Anthropic on screenshot size (about 1,000 to 1,800 tokens) and downscaling: https://claude.com/resources/articles/best-practices-for-computer-and-browser-use-with-claude
- OpenAI computer use guide (Responses computer tool, screenshots billed as image input) and the July 2026 shutdown of `computer-use-preview`: https://developers.openai.com/api/docs/guides/tools-computer-use and https://developers.openai.com/api/docs/deprecations
- OpenAI standard token rates, including GPT-6.1 Sol at $2 and $10 per million on the short context: https://developers.openai.com/api/docs/pricing
- In-repo prices for Haiku 5.5, Sonnet 5.5, and GPT-6.1 Sol: `server/registry.js`
