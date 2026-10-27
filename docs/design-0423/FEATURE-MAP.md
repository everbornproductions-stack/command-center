# Meldmind 0.4.21: every feature, and where it lives in the Mac-style Simple vs Expert (Oct 26, 2026)

Timing: Chris moved the Mac-style GUI to **0.4.23**, after 0.4.21 and 0.4.22 finish. This file and mockup-v2.html are planning material only; no build branch was touched.

Source: /workspace/build/command-center, branch integration/0.4.21 (read only). Main files: web/nav.js (LABELS, HOME groups,
simpleModel, EXPERT_PROMOTE, helpItems, CONNECT_LINKS, VIEW_LOCKS), web/mode.js (CREATE_VIEWS), web/app.js (Command screen,
run modes, priority, Live ops panel), web/live-ops.js, web/features/*.js, web/features/layout.js (0.4.21 Simple sidebar).

Key: **Dock** = magnifying app dock. **Cards** = Simple swipe cards. **Sidebar** = Expert slide-out sidebar (group shown).
**All tools** = Expert Launchpad grid (page shown). **Panel** = advanced settings panel sliding in from the right.
"Pro"/"Extreme" = plan lock from VIEW_LOCKS (page still opens and explains the plan).

## 1. Make things (Create)
| Feature (code id) | What it does | Simple | Expert |
|---|---|---|---|
| Chat / Command (`command`) | One box: type what you want | Dock: Chat; result inline | Sidebar Work; dock |
| Start a project (`start`) | Guided new project | Cards (first card on Home) | Sidebar Work; All tools p1 |
| Website (`webbuilders`, Build panel) | Builds a site, shows it in the Build panel | Dock + 3-step flow | Sidebar Create; All tools p1 |
| Image (`images`) | Make / edit images (OpenAI, Gemini, xAI, Replicate, fal) | Dock + 3-step flow | Sidebar Create |
| Video (`media`, media-jobs) | Kling, fal, Runway; failover between makers | Dock + 3-step flow | Sidebar Create |
| Campaign (chip `campaign`) | A week of posts | Dock + 3-step flow | Sidebar Create |
| Game mod / Remix (`remix`) | What to make, start point, preview, Build, Test, Publish | Dock: Game mod | Sidebar Create |
| Builders (`builders`) | Other builders (apps, docs) | More… | Sidebar Create |
| Pro prompts / prompt library (`prompts`, packs) | Ready prompts with [placeholders] | Style cards are prompts underneath | Sidebar Create; All tools p1 |
| Publish (`publish`) | Preview then post (Slack, socials); practice if not connected | Single finish button | Sidebar Create |
| Finish drawer | Copy, Print, PDF, Word, Save to MindMedia, Publish | Result screen: one button + "More ways" | Result screen, full drawer |
| Marketplace (`marketplace`) | Get / list agents and prompts | More… | Sidebar Create |
| Artifacts (`artifacts`) | Mini apps, SVG, charts from an answer, sandboxed | Not shown | Sidebar Library |

## 2. How the AIs run (modes)
| Feature | Simple | Expert |
|---|---|---|
| Single / Council / Mission / Research / Second opinion (`#run-mode`) | Hidden: "Auto team" picks | Run bar above the box (segmented); Missions, Councils, Research also in Sidebar Work |
| Priority: Max quality, Quality, Balanced, Max savings, Speed (`#cost-mode`) | Hidden (Balanced) | Run bar + Panel "Cost and speed" |
| When: Now / Off-peak | Hidden | Run bar |
| Free only / Use my plan first (free-first routing) | One switch in Settings basics | Panel "Cost and speed" |
| Backup when credits run out (`fallback`) | Automatic | Panel "Cost and speed" |
| Get it done / auto-approve rules (`getdone`) | Hidden (asks each time) | Panel "Safety and approvals" |
| Voice orders / wake word (`voice`, `voice-mode`) | Mic in the box | Mic + Panel "Voice" |

## 3. Watching work: Live Ops
| Feature | Simple | Expert |
|---|---|---|
| Live ops panel (app.js `#ops-panel`, live-ops.js) | Step 2 "AIs working": 3 progress bars + one line | Full Live Ops screen: AI map (graph.js), step list newest 3 + See all, status chip per step (planning / running / review / done / failed / waiting), QA score chip, re-assigned / revised chips, capability chip, cost per step, Pause / Resume / Stop, pause-and-edit goal + unfinished steps, Reply to this AI, Deliverable panel |
| Live view (`liveview`) | "See live" link | Sidebar Work: who works, current step, ledger cost, Open in service links, outside-agent handoffs |
| Live feed (`#feed`) | Hidden | Live Ops right column |
| Status strip (AIs online, `#strip`) | Dot in title bar | Live Ops header + title bar |

## 4. Work and agents
| Feature | Simple | Expert |
|---|---|---|
| Projects (`projects`) + project files/media | Dock: Projects | Sidebar Work |
| Agents + custom agents (`agents`) | Not shown | Sidebar Agents; All tools p2 |
| Pipelines (`pipelines`, Pro) | Not shown | Sidebar Agents |
| Schedules / triggers / webhooks (`schedules`, Pro) | Not shown | Sidebar Agents |
| Compare side by side (`compare`) | Not shown | Sidebar Work |
| Who's best (`brain`, learning router) | Not shown | Sidebar Library |
| Refocus (`refocus`) | Not shown | Sidebar Work |
| My day: Inbox and tasks, Day plan, Docs and follow-up (`everyday-*`) | More… | Sidebar My day |
| Grok Bot / outside agents handoff | Not shown | Sidebar Agents |

## 5. Library and memory
| Feature | Simple | Expert |
|---|---|---|
| MindMedia (`mindmedia`) | Dock | Dock + Sidebar Library |
| History (`history`, search is Pro) | Dock: History sidebar | Sidebar Library |
| Libraries (`libraries`) | Not shown | Sidebar Library |
| Memories (0.4.21 K-mem store) | Settings basics card | Sidebar Library + Panel "Memories" |
| Project memory (brand voice, offers, never say) | Not shown | Panel "Project memory" |

## 6. People and business
| Feature | Simple | Expert |
|---|---|---|
| Community, AI News (`community`, `ai-news`) | Profile menu | Sidebar People |
| People chat (`userchat`), Together (`together`) | More… | Sidebar People |
| Teams (`workspaces`, Extreme) | Not shown | Sidebar Business |
| Credits, Subscriptions (Pro), Reports, Usage / budget pill | Month pill only | Sidebar Business |

## 7. Connections and settings
| Feature | Simple | Expert |
|---|---|---|
| Find my AIs (`setup`), Get everything connected | Profile menu | Sidebar Settings; Panel "Connections" |
| Keys and providers, Your apps (BYO), Tools (MCP), Integrations (Grok Bot), Browser extension, HighLevel, Zapier and Make | "Keys and connections" | Panel "Connections" (each a row) |
| Look and theme (`look`), light/dark | Title bar sun/moon | Same + Panel "Look" |
| Privacy, masking, compliance, send-check | Defaults | Panel "Safety and approvals" |
| Alerts (email from own domain), phone approvals | Not shown | Panel "Alerts" |
| Updates, licence key, Simple/Expert | Title bar toggle | Title bar toggle + Panel "Account" |

## 8. Help
Search help, Take the tour, Check for updates, What's new, Try demo mode, User guide, Contact and feedback, About:
Simple = "?" in the title bar. Expert = Sidebar Help + All tools p3.

## What did not fit cleanly
- **Two docks:** 0.4.21 calls the bottom chat box "the dock". The mockup keeps the chat box inside the window, app dock below.
- **Live feed vs Live Ops:** the raw feed is noisy; it is a collapsible column in Live Ops, not its own screen.
- **Artifacts, Compare, Who's best** have no natural Simple home; they are Expert only.
- **Plan locks (Pro/Extreme)** show as a small tag; the real page still explains the plan.
- The 3-step flow does not suit Agents, Pipelines, Schedules (they are setup, not one-shot), so they live in Expert only.

## Planned in 0.4.21 / 0.4.22 (CHRIS-NOTES-0421.md, CHRIS-NOTES-0422.md) and where each lands in the Mac layout (0.4.23)
| Planned item (release) | Simple (Mac) | Expert (Mac) |
|---|---|---|
| Chat history: auto-save, searchable sidebar list, reopen, "Do this again" / "Change and redo", quick picks in the start box (0.4.21) | Dock: History slides in from the left; quick picks as chips under the box | Sidebar Library > History; same chips |
| Memories: About me / This project / Knowledge, importance 1-5, "Remembered: ..." + Undo, see/edit/delete/off (0.4.21) | "Remembered" pill in the chat; Settings basics card | Sidebar Library > Memories + Panel "Memories" |
| Big result card + ONE finish button (Publish site, Download image/video/mod, Post campaign) (0.4.21 diffui) | Step 3 "Done" screen | Same card, plus Finish drawer "More ways" |
| 2-4 quick image options to tap (0.4.21) | Step 3 shows 4 thumbs | Same |
| Try again / Change this part, Version 1 / 2 / 3 kept (0.4.21 Melius) | Version pills on the result card | Same + versions in History |
| "Free" or rough cost line before each run; every result shows cost (0.4.21) | One line above Go | Run bar + Live Ops cost per step |
| "Show steps" view, hidden by default (0.4.21) | "Show steps" link on step 2 opens Live Ops | Live Ops screen |
| Incomplete instead of Done, QA scores, retry on another AI, "Is this usable?" thumb, thumbs per step (0.4.21 dogfood) | Result card: Incomplete badge + Retry; one thumb | Live Ops step chips (QA, retried) + thumbs per step |
| Swipeable upload strip, tap for full screen (0.4.21) | Step 2 photo strip | Same, in chat |
| Free first / Free only / Get free AIs card / "3 ready, 2 out of credits" (0.4.21) | One line at send + Settings basics | Panel "Cost and speed" + Live Ops header |
| Voice: push-to-talk, Heard/Doing/Done strip; wake word "Hey Meld" (0.4.22) | Mic in box; strip above the dock | Same + Panel "Voice" |
| AI News in one place (0.4.21) | Profile menu > AI News | Sidebar People > AI News |
| Remix free sampler, Site Builder v2, Free listing builder (0.4.22) | Dock: Game mod / Website paths | Sidebar Create |
| Teams "make this computer the hub" (0.4.22) | Not shown | Sidebar Business > Teams |
| Open in Claude/ChatGPT/Gemini, MCP setup (0.4.22) | Not shown | Panel "Connections" |
| Send guard + masking recheck (0.4.22) | Invisible | Panel "Safety and approvals" |
