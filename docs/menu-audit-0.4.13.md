# Menu, page, and link audit: 0.4.13

Branch `integration/0.4.13`. Covers the top menus (Simple and Expert, compact and wide rows, desktop and web), the phone bar, the Help page, the Settings page, tour steps, and in-app links. Checked by `test/menu-audit.test.js`.

## 0.4.17 changes (Chris, 2026-10-21)

- **People moved to Connect.** Connect now has two sections. **Apps and AIs**: Keys and providers, Your apps, Tools (MCP), Integrations, Browser extension, HighLevel. **People**: People, Together, Community. Business keeps money and team pages: Credits, Subscriptions, Reports, Teams. In Simple, People stays in My day, and Together and Community sit in a People section of More, above Connections. On the phone bar they are listed under Connect.
- **Two setups, two names.** Settings > **Find my AIs** (page `setup`, id `tab-setup` kept) is the longer setup page: AI keys on this PC, browser history, bookmarks, track records. The Settings page link keeps decision 20's words: **Run setup again (Find my AIs)** (`#s-setup`). Help > **Get everything connected** (action `connect-setup`) is the integrations checklist, the same name as its screen title. The Help page button and the tray item use that name too. The checklist's Settings card button is now **Open the checklist**. No menu item is called just Setup any more.
- Still unsure, not changed: Connect > **Integrations** opens the Grok Bot handoff panel, so "Agent handoffs" might say it better. Simple keeps **Find my AIs** in More (Simple's Settings is one button). Simple keeps **People** in My day rather than a Connect menu, because Simple has no Connect menu.

## What changed (0.4.13)

- **Settings is settings only.** The Settings menu now holds Settings and Setup. Help, Take the tour, Run setup again, and Check for updates left it.
- **Help is one menu, the same everywhere:** Search help, Take the tour, Run setup again, Check for updates, What's new, Try demo mode, User guide, Contact and feedback, About Meldmind. The web app hides Run setup again and Check for updates (no setup scan, no updater there).
- **One name per action.** "Replay the tour", "Take the tour again", and "Take the tour" were one action with three names. It is now **Take the tour** in menus, the Help page, the tour invite, the skip toast, and the help articles. The Help view item is **Search help**. The Teams page tab now says Teams, matching the menu (it said Workspaces).
- **Duplicates removed.** Narrow Expert used to show Run setup again, Take the tour, and Check for updates in both Settings and Help. The Settings page "Get help" card had Take the tour, Check for updates, and See what else. Those are gone; the card now points to the Help menu. Version and Check for updates moved from the Settings page to Help > About Meldmind. The second "Download the guide (PDF)" button on the Help page is gone.
- **Simple reaches every page.** Simple adds a **More** menu with every page not on its row (Compare, Pipelines, Agents, Live, Schedules, Libraries, Artifacts, History, Docs and follow-up, Refocus, Who's best, Marketplace, Subscriptions, Credits, Teams, Together, Reports, Community, Setup). Community moved from Help to More. Start a project now always shows in Simple, not only after its module loads. The Simple Settings dropdown was never openable (the trigger jumped straight to the Settings page), so its three items were dead; Settings is now a plain button.
- **Simple chat page is chat first.** Chat is the first item in the Simple row and the top of the page. Under the chat box the page shows only My day (Inbox and tasks, Day plan, People), three starters (Reply to a customer, Fix my email, Write a post), and recent chats, then the answer. Other Command widgets (Zapier card, popular prompts, the Start a project bar, private mode and tones, uploads, app suggestions, and the rest) are Expert only. `SIMPLE_COMMAND` in web/mode.js lists the two that still draw: voice (the Mic button) and desk (recent chats). Start a project stays in the top row.
- **Connectors moved to More > Connections in Simple.** The Connect Zapier card left the chat page. Simple More now ends with a Connections section: Zapier and Make, Keys and providers, Your apps, Browser extension, HighLevel. Each opens Settings past the basics, scrolled to that panel. In Simple the Zapier and Make panel shows Zapier and Make. MCP servers, webhook tools, and the Meldmind webhook stay in Expert, so Simple does not link Tools (MCP) or Integrations. A page that loads later is added above Connections.
- **Start a project sits right before Projects** in Simple and in every Expert layout. Checked by `test/menu-audit.test.js`.
- **Orphan page fixed.** Marketplace had no menu item (reachable only from a Pro prompts button). It is now Create > Marketplace.
- **Panels that never loaded on Settings.** "What your ratings taught" (`ratings`) and the public share link base URL (`share`) register Settings panels, but the registry did not load them with Settings. They now do.
- **Pro-locked items show a lock note.** Pipelines, Schedules, History, and Subscriptions (Pro) and Teams (Extreme) get a lock label and a tooltip when the licence does not include them. The item still opens the page, which explains the plan. Nothing is charged.
- **Menu focus links work on every page.** A menu item with a panel target (User guide, Contact and feedback, About Meldmind) now scrolls to it. Before, only Settings honoured it.
- **Removed menu actions:** `replay-tour` and `examples` (Watch example projects). Watch example projects stays on the Start a project page and the Help page. `news` (What's new) is new.

## Not changed (locked or out of scope)

- **Decision 20: Settings keeps a manual "Run setup again".** That link on the Settings page (`#s-setup`) opens the first-run setup page (browser history, key import, bookmarks). The Help menu, the Help page, the tray, and the "Get everything connected" Settings card use the same words for the connections checklist (`connectSetup.open`). Two actions share one name. Renaming either changes decision 20 or the tray. Logged as BLOCKED in docs/BUILD-LOG.md for Chris. Resolved in 0.4.17 at Chris's request: the checklist is now Get everything connected everywhere, and the Settings link keeps Run setup again with the page name Find my AIs.
- **Decision 4:** the tray keeps Check for updates, Install update, and Restart app.
- **Mode names:** the Command page is "Chat" in Simple and "Command" in Expert, on purpose. The phone bar says "Subs" for Subscriptions for space.

## Menu items

### Expert, compact row (narrow window), desktop

| Menu | Item | Target | Status |
|---|---|---|---|
| Work | Command | page `command` | OK |
| Work | Start a project | page `start` | OK |
| Work | Projects | page `projects` | OK |
| Work | Compare | page `compare` | OK |
| Work | Pipelines | page `pipelines` | OK, lock note "Pro" on lower plans |
| Work | Agents | page `agents` | OK |
| Work | Live | page `liveview` | OK |
| Work | Schedules | page `schedules` | OK, lock note "Pro" on lower plans |
| Work | Libraries | page `libraries` | OK |
| Work | Artifacts | page `artifacts` | OK |
| Work | History | page `history` | OK, lock note "Pro" on lower plans |
| Work | Inbox and tasks | page `everyday-inbox` | OK |
| Work | Day plan | page `everyday-plan` | OK |
| Work | Docs and follow-up | page `everyday-work` | OK |
| Work | Refocus | page `refocus` | OK |
| Work | Who's best | page `brain` | OK |
| Create | Pro prompts | page `prompts` | OK |
| Create | Marketplace | page `marketplace` | OK |
| Create | Images | page `images` | OK |
| Create | Media | page `media` | OK |
| Create | Publish | page `publish` | OK |
| Create | Remix | page `remix` | OK |
| Create | Builders | page `builders` | OK |
| Create | Web and marketing | page `webbuilders` | OK |
| Business | Subscriptions | page `subscriptions` | OK, lock note "Pro" on lower plans |
| Business | Credits | page `credits` | OK |
| Business | Teams | page `workspaces` | OK, lock note "Extreme" on lower plans |
| Business | Reports | page `reports` | OK |
| Connect | Keys and providers | page `settings`, scrolled to `#settings-keys` | OK |
| Connect | Your apps | page `settings`, scrolled to `[data-feature='byo']` | OK |
| Connect | Tools (MCP) | page `settings`, scrolled to `[data-feature='mcp']` | OK |
| Connect | Integrations | page `settings`, scrolled to `[data-feature='grokbot']` | OK |
| Connect | Browser extension | page `settings`, scrolled to `[data-feature='extension']` | OK |
| Connect | HighLevel | page `settings`, scrolled to `[data-feature='highlevel']` | OK |
| Connect | People | page `userchat` | OK (People section, 0.4.17) |
| Connect | Together | page `together` | OK (People section, 0.4.17) |
| Connect | Community | page `community` | OK (People section, 0.4.17) |
| Settings | Settings | page `settings` | OK |
| Settings | Find my AIs | page `setup` | OK (named Setup before 0.4.17) |
| Help | Search help | page `help` | OK |
| Help | Take the tour | action `tour` (window.CC.tour.start (web/app.js menu click)) | OK |
| Help | Get everything connected | action `connect-setup` (window.CC.connectSetup.open (web/app.js menu click)) | OK |
| Help | Check for updates | action `updates` (manualCheck (web/features/updates.js document click)) | OK |
| Help | What's new | action `news` (window.CC.tour.openNews (web/app.js menu click)) | OK |
| Help | Try demo mode | action `demo-on` (setDemo(true) (web/app.js menu click)) | OK |
| Help | User guide | page `help`, scrolled to `#can-do` | OK |
| Help | Contact and feedback | page `help`, scrolled to `#help-contact` | OK |
| Help | About Meldmind | page `help`, scrolled to `#help-about` | OK |

### Expert, eight menus (wide window), desktop

| Menu | Item | Target | Status |
|---|---|---|---|
| Work | Command | page `command` | OK |
| Work | Start a project | page `start` | OK |
| Work | Projects | page `projects` | OK |
| Work | Compare | page `compare` | OK |
| Work | Pipelines | page `pipelines` | OK, lock note "Pro" on lower plans |
| Work | Live | page `liveview` | OK |
| Work | Inbox and tasks | page `everyday-inbox` | OK |
| Work | Day plan | page `everyday-plan` | OK |
| Work | Docs and follow-up | page `everyday-work` | OK |
| Work | Refocus | page `refocus` | OK |
| Agents | Agents | page `agents` | OK |
| Agents | Schedules | page `schedules` | OK, lock note "Pro" on lower plans |
| Library | Libraries | page `libraries` | OK |
| Library | Artifacts | page `artifacts` | OK |
| Library | History | page `history` | OK, lock note "Pro" on lower plans |
| Library | Who's best | page `brain` | OK |
| Create | Pro prompts | page `prompts` | OK |
| Create | Marketplace | page `marketplace` | OK |
| Create | Images | page `images` | OK |
| Create | Media | page `media` | OK |
| Create | Publish | page `publish` | OK |
| Create | Remix | page `remix` | OK |
| Create | Builders | page `builders` | OK |
| Create | Web and marketing | page `webbuilders` | OK |
| Business | Subscriptions | page `subscriptions` | OK, lock note "Pro" on lower plans |
| Business | Credits | page `credits` | OK |
| Business | Teams | page `workspaces` | OK, lock note "Extreme" on lower plans |
| Business | Reports | page `reports` | OK |
| Connect | Keys and providers | page `settings`, scrolled to `#settings-keys` | OK |
| Connect | Your apps | page `settings`, scrolled to `[data-feature='byo']` | OK |
| Connect | Tools (MCP) | page `settings`, scrolled to `[data-feature='mcp']` | OK |
| Connect | Integrations | page `settings`, scrolled to `[data-feature='grokbot']` | OK |
| Connect | Browser extension | page `settings`, scrolled to `[data-feature='extension']` | OK |
| Connect | HighLevel | page `settings`, scrolled to `[data-feature='highlevel']` | OK |
| Connect | People | page `userchat` | OK (People section, 0.4.17) |
| Connect | Together | page `together` | OK (People section, 0.4.17) |
| Connect | Community | page `community` | OK (People section, 0.4.17) |
| Settings | Settings | page `settings` | OK |
| Settings | Find my AIs | page `setup` | OK (named Setup before 0.4.17) |
| Help | Search help | page `help` | OK |
| Help | Take the tour | action `tour` (window.CC.tour.start (web/app.js menu click)) | OK |
| Help | Get everything connected | action `connect-setup` (window.CC.connectSetup.open (web/app.js menu click)) | OK |
| Help | Check for updates | action `updates` (manualCheck (web/features/updates.js document click)) | OK |
| Help | What's new | action `news` (window.CC.tour.openNews (web/app.js menu click)) | OK |
| Help | Try demo mode | action `demo-on` (setDemo(true) (web/app.js menu click)) | OK |
| Help | User guide | page `help`, scrolled to `#can-do` | OK |
| Help | Contact and feedback | page `help`, scrolled to `#help-contact` | OK |
| Help | About Meldmind | page `help`, scrolled to `#help-about` | OK |

### Simple, desktop

| Menu | Item | Target | Status |
|---|---|---|---|
| Chat | Chat | page `command` | OK |
| Start a project | Start a project | page `start` | OK |
| Projects | Projects | page `projects` | OK |
| My day | Inbox and tasks | page `everyday-inbox` | OK |
| My day | Day plan | page `everyday-plan` | OK |
| My day | People | page `userchat` | OK |
| Create | Pro prompts | page `prompts` | OK |
| Create | Images | page `images` | OK |
| Create | Media | page `media` | OK |
| Create | Publish | page `publish` | OK |
| Create | Remix | page `remix` | OK |
| Create | Builders | page `builders` | OK |
| Create | Web and marketing | page `webbuilders` | OK |
| More | Compare | page `compare` | OK |
| More | Pipelines | page `pipelines` | OK, lock note "Pro" on lower plans |
| More | Agents | page `agents` | OK |
| More | Live | page `liveview` | OK |
| More | Schedules | page `schedules` | OK, lock note "Pro" on lower plans |
| More | Libraries | page `libraries` | OK |
| More | Artifacts | page `artifacts` | OK |
| More | History | page `history` | OK, lock note "Pro" on lower plans |
| More | Docs and follow-up | page `everyday-work` | OK |
| More | Refocus | page `refocus` | OK |
| More | Who's best | page `brain` | OK |
| More | Marketplace | page `marketplace` | OK |
| More | Subscriptions | page `subscriptions` | OK, lock note "Pro" on lower plans |
| More | Credits | page `credits` | OK |
| More | Teams | page `workspaces` | OK, lock note "Extreme" on lower plans |
| More | Together | page `together` | OK |
| More | Reports | page `reports` | OK |
| More | Community | page `community` | OK |
| More | Find my AIs | page `setup` | OK |
| More > Connections | Zapier and Make | page `settings`, scrolled to `[data-feature='zapier']` | OK |
| More > Connections | Keys and providers | page `settings`, scrolled to `#settings-keys` | OK |
| More > Connections | Your apps | page `settings`, scrolled to `[data-feature='byo']` | OK |
| More > Connections | Browser extension | page `settings`, scrolled to `[data-feature='extension']` | OK |
| More > Connections | HighLevel | page `settings`, scrolled to `[data-feature='highlevel']` | OK |
| Help | Search help | page `help` | OK |
| Help | Take the tour | action `tour` (window.CC.tour.start (web/app.js menu click)) | OK |
| Help | Get everything connected | action `connect-setup` (window.CC.connectSetup.open (web/app.js menu click)) | OK |
| Help | Check for updates | action `updates` (manualCheck (web/features/updates.js document click)) | OK |
| Help | What's new | action `news` (window.CC.tour.openNews (web/app.js menu click)) | OK |
| Help | User guide | page `help`, scrolled to `#can-do` | OK |
| Help | Contact and feedback | page `help`, scrolled to `#help-contact` | OK |
| Help | About Meldmind | page `help`, scrolled to `#help-about` | OK |
| Settings | Settings | page `settings` | OK |

Web app (hosted) hides these desktop-only items: Libraries, Find my AIs, Get everything connected, Check for updates.

## Other links checked

| Where | Item | Target | Status |
|---|---|---|---|
| Phone bar | Command / Chat, Projects, Create (Simple), Credits, Subs, Feed (Expert), Help, Settings, More | pages of the same name, live feed, More sheet | OK |
| Help page | Search help, Ask Meldmind, Security summary (PDF) | `/api/help`, `/api/help/ask`, `/api/help/security.pdf` | OK |
| Help page | Take the tour, See what else it can do, Get everything connected, What's new, Start a project, Watch example projects | tour.start, tour.startFull, connectSetup.open, tour.openNews, page `start`, startProject.examples | OK |
| Help page | Download the guide (PDF) | `/what-meldmind-can-do.pdf` (shipped in web/) | OK |
| Help page | Contact and feedback | mailto link (opens the mail app, nothing sent from Meldmind), Open the idea box (Settings, `everyday-news` panel) | OK |
| Help page | About Meldmind | version, Check for updates, Update ready, restart | OK |
| Settings page | Search help (Get help card), What leaves this PC | page `help`, article `security` | OK |
| Settings page | Run setup again (Find my AIs) (`#s-setup`) | the longer setup page | Decision 20 words kept, see 0.4.17 changes |
| Connect menu | Keys and providers, Your apps, Tools (MCP), Integrations, Browser extension, HighLevel | Settings scrolled to `#settings-keys` or `[data-feature=...]` | OK |
| Simple More > Connections | Zapier and Make, Keys and providers, Your apps, Browser extension, HighLevel | Settings (past the basics) scrolled to `#settings-keys` or `[data-feature=...]` | OK |
| Tour | every step `view:` | command, help, settings, builders, community | OK, all pages exist |
| In-app `go()` calls | builders, command, community, help, images, liveview, marketplace, media, pipelines, remix, settings, start, webbuilders | all exist | OK |
| guide.js | `research` view | guarded by `has(p.views, "research")`, so it is skipped | OK, no dead link shown |
| Command palette | none in this build | n/a | Nothing to check |

## Wide bar: pages promoted out of their menu

On a wide window the free space in the top bar promotes pages to direct buttons, in this order, as many as fit (web/nav.js `SIMPLE_PROMOTE`, `EXPERT_PROMOTE`). A promoted page leaves its menu, so it is never listed twice. Start a project comes up only together with Projects.

| Mode | Order | Leaves |
|---|---|---|
| Simple | Pro prompts, Builders, Community, Connections | Create (Pro prompts, Builders), More (Community, the Connections section becomes its own Connections menu) |
| Expert | Command, Start a project, Projects, Pro prompts, Builders, Community, Missions, Councils, Research, Remix | Work (Command, Start a project, Projects), Create (Pro prompts, Builders, Remix), Business (Community) |

Missions and Councils open Command with that run mode picked. Research opens Command at Search the web. These three are shortcuts, not menu items, so nothing leaves a menu for them.

## Features with no page (0.4.9 to 0.4.13)

| Version | Feature | Where it is | Status |
|---|---|---|---|
| 0.4.9 | Welcome email (decision 22) | Server only (`/api/welcome`). Sent on sign-up. | No page by design. Spec is locked. |
| 0.4.9 | Marketplace prompt packs | Was only behind a Pro prompts button | Fixed: Create > Marketplace |
| 0.4.9, 0.4.11 | What your ratings taught, Reset | Settings panel that did not load on Settings | Fixed: loads with Settings |
| 0.4.9 | Public share link base URL | Settings panel that did not load on Settings | Fixed: loads with Settings |
| 0.4.9 | Use a named imported chat (hint on Command) | `history` module loads only on the History page | Open: the hint shows on History only. Adding it to Command changes the Command load budget (PERFORMANCE.md). |
| 0.4.9 to 0.4.13 | Command widgets and answer sections (Home, Get it done, Zapier card, app suggestions, background runs, export, share, read aloud, Do this again) | Command page (Expert) | Light mode skips them by design (registry rule). Expert reaches them. Simple draws only recent chats; Zapier and Make are in More > Connections. |
| 0.4.9 to 0.4.13 | Settings-only panels: Antigravity, Programs on this PC, Zapier and Make, idea box, backup, usage counts, Use your own Supabase, cloud runs, plan prices, Get it done settings | Settings page (Simple: More options) | Reachable from Settings. Not separate pages. The idea box also has a link from Help > Contact and feedback. |
| 0.4.9 | Desktop control prompt, password manager tip | Launch card, runtime tip | Popups, no page needed |

