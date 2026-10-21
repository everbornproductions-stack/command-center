# Meldmind Everyday Actions Plan

Date: Oct 20, 2026. Author: Grok Bot research pass for Chris.

## 1. What people actually use AI assistants for (evidence)

- OpenAI "How People Use ChatGPT" (NBER w34255, 2025): about 80% of use is Practical Guidance (~29%), Seeking Information (~24%) and Writing (~24%). Writing is 40% of work use, and two thirds of writing is editing the user's own text. Over 70% of messages are non-work.
- Pew Research (June 2026): top uses are searching for information (42% of US adults) and work tasks (38% of employed adults), then fun, images/video, diet and fitness info.
- PYMNTS Consumer AI Benchmark (May 2026): top personal tasks are rewording writing (31%), drafting texts or emails (30%), finding products to buy (30%), health lookups (27%), meal and grocery planning (27%). Fastest growing: discount codes and deals, household logistics, meal planning.
- Menlo Ventures State of Consumer AI (Sept 2026): email drafting (47%) and editing (44%) lead. 50% of AI shoppers compare prices with AI, 26% let AI complete a purchase. 41% have tried an agent, 24% use one regularly. Access granted to agents: email 36%, browser 33%, messaging 31%, cloud storage 29%, calendar 27%, finance only 20%. 32% have let AI act without a final sign-off (Meldmind should not do this).
- Product patterns: ChatGPT agent/Operator (bookings, forms, shopping carts, research reports), Claude (writing, docs, research, MCP connectors), Gemini in Workspace (summarize inbox, draft replies, Docs/Sheets help, meeting notes in Meet), Copilot (Outlook triage, Teams recap, Excel), Lindy and Zapier AI (lead follow-up, inbox rules, CRM updates, meeting prep), Motion and Reclaim (auto time-blocking, task scheduling, habits), Superhuman (split inbox, auto drafts, follow-up reminders), Grok-style bots (news digests, X posting, quick research).

Takeaway: the everyday core is write, find, summarize, schedule, remind. Money, buying and travel are wanted but low trust, so they should stay "prepare and confirm".

## 2. Global safety rules (apply to every action)

1. Read and draft freely. Any send, post, buy, book, delete, pay, share or invite needs one approval click showing the exact content and recipient.
2. No stored passwords. Use OAuth or user-supplied API keys kept in Windows Credential Manager (DPAPI). Browser/UI automation uses the user's own signed-in session and never captures credentials.
3. No money moved without explicit confirmation of amount, payee and source. Payment fields are always filled by the user, never by the AI.
4. Integrations act only on click. Scheduled routines may read and prepare, but outgoing actions wait in an Approval queue.
5. Every executed action is logged in Live Ops with an undo where the API allows it (Gmail undo window, delete event, archive restore).
6. Bulk actions (more than 10 items) show a count and sample before approval.
7. Webhook (Grok Bot handoff) and MCP tool calls follow the same approval rules as native connections.

## 3. Full catalog by category

Effort: S = days, M = 1 to 2 weeks, L = 3+ weeks. Tier: Free or Pro (suggestion).

### Email and inbox triage (Gmail API, free; Outlook via Microsoft Graph, free)
| Action | Example plain request | Effort | Tier | Safety |
|---|---|---|---|---|
| Inbox summary across accounts | "What needs me today in all my inboxes?" | S | Free | Read only |
| Draft reply in my tone | "Reply to Dana, say yes to Thursday" | S | Free | Send needs click |
| Triage and label / archive | "Archive newsletters older than a week" | M | Free (Pro for bulk rules) | Bulk preview, undo |
| Follow-up nudge | "Remind me if Mark does not reply by Friday" | M | Pro | Nudge draft needs click |
| Unsubscribe helper | "Unsubscribe me from promo lists I never open" | M | Pro | Per-sender approval |
| Extract to task/calendar | "Turn this email into a task and a calendar hold" | S | Free | Click to create |

### Calendar and scheduling (Google Calendar API, free; Graph calendar, free)
| Action | Example | Effort | Tier | Safety |
|---|---|---|---|---|
| Day/week agenda brief | "What is my day look like?" | S | Free | Read only |
| Create event from text | "Lunch with Sam Tue 12:30 at Tacos Uno" | S | Free | Click to create; invites need click |
| Find a time and propose slots | "Find 3 open 30 min slots next week for Ana" | M | Free | Email to Ana needs click |
| Reschedule / decline | "Move my 3pm to tomorrow, same time" | S | Free | Click; attendees notified only on click |
| Focus time blocking (Motion/Reclaim style) | "Block 2 hours daily for deep work" | M | Pro | Preview blocks before writing |

### Meetings (Google Meet transcripts via Drive/Docs API; Zoom API free tier; local recording + Whisper)
| Action | Example | Effort | Tier | Safety |
|---|---|---|---|---|
| Meeting prep brief | "Prep me for my 2pm" (pulls emails, docs, past notes) | M | Free | Read only |
| Summarize transcript, action items | "Summarize yesterday's call and list to-dos" | M | Free | Read only |
| Local recording notes | "Take notes on this call" | L | Pro | Consent banner, local only by default |
| Send recap | "Email the recap to attendees" | S | Free | Send needs click |

### Contacts and CRM (Google People API free; HighLevel API v2 with OAuth/MCP; HubSpot free CRM API)
| Action | Example | Effort | Tier | Safety |
|---|---|---|---|---|
| Look up contact context | "What do I know about Priya?" | S | Free | Read only |
| Add/update contact from email | "Add this sender to HighLevel as a lead" | M | Pro | Click to write |
| Pipeline summary | "Which HighLevel deals went quiet this week?" | M | Pro | Read only |
| Tag / move stage | "Move Bob to Booked" | S | Pro | Click |

### Docs, Drive, Notion (Google Drive/Docs API free; Notion API and official MCP free)
| Action | Example | Effort | Tier | Safety |
|---|---|---|---|---|
| Find and summarize a doc | "Find the Q3 proposal and summarize it" | S | Free | Read only |
| Create doc from chat | "Save this plan as a Google Doc" | S | Free | Click to create |
| Edit/rewrite doc section | "Tighten the intro of my pitch doc" | M | Free | Shows diff, click to apply |
| Notion page/database entry | "Add this idea to my Notion ideas board" | S | Free | Click |
| Share file | "Share this with Lee as viewer" | S | Free | Click, shows who and permission |

### Tasks and to-dos (Google Tasks API free; Microsoft To Do via Graph free; Todoist API free; Notion)
| Action | Example | Effort | Tier | Safety |
|---|---|---|---|---|
| Add task by plain text | "Remind me to renew my license next month" | S | Free | Click (or auto for local list) |
| Daily plan from tasks + calendar | "Plan my day" | M | Free | Preview |
| Auto-schedule tasks into calendar | "Fit my tasks into open time" | L | Pro | Preview blocks |

### Messaging (Slack Web API free; Twilio SMS pay per use, BYO keys; WhatsApp Cloud API, Meta, template rules; Telegram Bot API free)
| Action | Example | Effort | Tier | Safety |
|---|---|---|---|---|
| Slack catch-up | "What did I miss in #sales?" | S | Free | Read only |
| Slack post/DM draft | "Tell the team the demo moved to 4" | S | Free | Send needs click |
| SMS via Twilio | "Text my 3pm client I'm running 10 min late" | S | Pro | Send needs click, shows cost per message |
| WhatsApp Business message | "Send the booking confirmation on WhatsApp" | M | Pro | Click; template opt-in rules |

### Social posting (X API, LinkedIn API, Meta Graph; or Zernio as aggregator; Buffer API)
| Action | Example | Effort | Tier | Safety |
|---|---|---|---|---|
| Draft post in my voice | "Write a post about our new feature" | S | Free | Draft only |
| Schedule/post multi-platform | "Post this to X and LinkedIn tomorrow 9am" | M | Pro | Post needs click per platform |
| Reply/mention digest | "Any mentions I should answer?" | M | Pro | Replies need click |

### Reminders and routines (local scheduler, Windows toast notifications, no API)
| Action | Example | Effort | Tier | Safety |
|---|---|---|---|---|
| One-off reminder | "Remind me at 5 to call Mom" | S | Free | Local only |
| Morning briefing routine | "Every weekday 8am: agenda, inbox, weather, news" | M | Free (1 routine), Pro (unlimited) | Read only; outputs wait for click |
| Weekly review | "Every Friday summarize what I did and what slipped" | M | Pro | Read only |

### Shopping and price watch (web search + page fetch; Keepa API paid for Amazon; browser automation for carts)
| Action | Example | Effort | Tier | Safety |
|---|---|---|---|---|
| Compare products | "Best 27 inch monitor under $300" | S | Free | Read only |
| Price watch alert | "Tell me if these AirPods drop below $150" | M | Pro | Alert only |
| Coupon/deal finder | "Any promo codes for this store?" | S | Free | Read only |
| Fill cart (browser) | "Add these groceries to my Instacart cart" | L | Pro | Stops before checkout; user pays |

### Travel (web search; Google Maps/Places API free credit; Amadeus self-service API free tier; Gmail for confirmations)
| Action | Example | Effort | Tier | Safety |
|---|---|---|---|---|
| Trip itinerary from confirmations | "Build my Denver trip itinerary from my emails" | M | Free | Read; calendar adds need click |
| Flight/hotel options | "Flights to Austin Nov 12 to 15 under $400" | M | Pro | Read only; booking is user's click on the site |
| Travel time / leave-by alert | "When should I leave for my 2pm?" | S | Free | Read only |

### Food ordering (no good free official APIs for DoorDash/Uber Eats consumer; use browser automation or deep links)
| Action | Example | Effort | Tier | Safety |
|---|---|---|---|---|
| Meal plan + grocery list | "Plan 5 dinners and make a grocery list" | S | Free | None |
| Reorder usual (browser) | "Reorder my usual from Chipotle" | L | Pro | Stops before payment |
| Restaurant reservation (OpenTable/Resy links) | "Table for 4 Friday 7pm near me" | M | Pro | Booking needs click |

### Finances and invoices (Square API free; QuickBooks Online API free dev; Stripe API; Plaid for read-only balances, paid)
| Action | Example | Effort | Tier | Safety |
|---|---|---|---|---|
| Find/organize receipts in email | "Pull all receipts from October into a sheet" | M | Free | Read; sheet create needs click |
| Create invoice draft | "Invoice Acme $1,200 for October design work" | M | Pro | Draft only; send needs click with amount shown |
| Unpaid invoice nudge | "Who owes me money?" then reminder drafts | M | Pro | Send needs click |
| Sales summary (Square) | "How did sales do this week?" | S | Pro | Read only |
| Bill reminders | "Remind me 3 days before each bill is due" | S | Free | Never pays |

### Files (local Windows file system, OneDrive/Drive)
| Action | Example | Effort | Tier | Safety |
|---|---|---|---|---|
| Find a file by description | "Find the PDF lease I signed last spring" | M | Free | Read only |
| Summarize/convert file | "Summarize this PDF / turn into a table" | S | Free | None |
| Tidy Downloads folder | "Sort my Downloads by type" | M | Pro | Preview moves; never delete without click; recycle bin only |

### Research and news digests (web search, RSS, X API, Hacker News API free)
| Action | Example | Effort | Tier | Safety |
|---|---|---|---|---|
| Quick researched answer with sources | "Compare Square vs Stripe fees" | S | Free | None |
| Deep research report (multi-model) | "Research best CRMs for a 3 person agency" | M | Pro | None |
| Daily topic digest | "Daily AI news digest at 7am" | M | Free (1), Pro (more) | None |

### Smart home (Home Assistant REST API free; SmartThings API; Google Home has limited public API)
| Action | Example | Effort | Tier | Safety |
|---|---|---|---|---|
| Device control | "Turn off the office lights" | M | Pro | Locks, garage, alarms always need click |
| Scenes/routines | "Movie mode at 8pm" | M | Pro | Same |

### Small-business automation (HighLevel, Gmail, Twilio, Calendar, Calendly API, web forms)
| Action | Example | Effort | Tier | Safety |
|---|---|---|---|---|
| New lead instant follow-up | "When a new HighLevel lead comes in, draft a text and email" | M | Pro | Drafts queue for one click (optional pre-approved template later) |
| Appointment booking | "Offer this lead 3 slots and book the one they pick" | L | Pro | Booking and confirmation need click |
| No-show / reminder texts | "Text tomorrow's appointments a reminder" | M | Pro | Bulk preview then one click |
| Review request | "Ask last week's customers for a Google review" | S | Pro | Bulk preview |
| Weekly business digest | "Leads, bookings, sales, unpaid invoices this week" | M | Pro | Read only |

### No-API app control (browser automation via Playwright/CDP; Windows UI Automation)
| Action | Example | Effort | Tier | Safety |
|---|---|---|---|---|
| Fill a web form | "Fill out this rebate form with my info" | L | Pro | Stops before Submit; user clicks Submit |
| Drive a desktop app | "Export last month's report from my accounting app" | L | Pro | Step preview, stop on login/payment screens |

## 4. Update experience and feedback (new)

### "What's new" setup prompt for existing users
- Trigger: first launch after an update that adds connections or actions. Compare the installed feature manifest with the user's last-seen manifest version.
- Shows a short card list: each new connection ("Google Calendar is now available: Connect") and each new action ("Try: 'Plan my day'" with a one-click sample run in read-only mode).
- Every item has Connect / Try it, Skip, and Remind me later (snooze 3 days, then once more at 7 days, then it moves to Settings > What's new and stops nagging).
- "Skip all" button. Never auto-connects; OAuth only starts on the user's click.
- Choices saved locally per item so skipped items never reappear as prompts.
- Effort: S to M. Tier: Free.

### "Suggest a connection or idea" box
- Location: Settings, the What's new card, and the empty state of the connections page.
- Fields: suggestion text, optional category (connection, action, bug, other), optional email for reply, checkbox "include app version and OS" (default on, no personal data, no chat content).
- Sending: posts to a feedback endpoint (for example the Grok Bot webhook or a small form backend) that forwards to Chris. Shows exactly what will be sent and needs a Send click.
- Works offline by queuing and sending later. Shows "Thanks, Chris reads these" confirmation.
- 0.4.8 additions, kept on this computer: Upload (images, screenshots, PDF, text, Word; up to 4 files, about 4 MB; names only in the note), Voice (local Whisper or a connected AI, edit before Send), then edit, delete, re-prioritize, comment, and a status of new, planned, building, or shipped. Later edits are not sent again. Marching orders has the same Upload and Voice buttons.
- Optional later: upvote list of popular suggestions.
- Effort: S. Tier: Free.

## 5. Top 10 to build first (everyday value vs effort)

1. Multi-account inbox summary plus "reply in my tone" drafts (Gmail, existing). S, Free. Highest usage category in every survey.
2. Calendar agenda brief and create/move events from plain text (Google Calendar). S, Free.
3. Morning briefing routine: agenda, inbox, tasks, weather, news digest. M, Free for one, Pro for more.
4. Plain-text reminders and tasks (local reminders + Google Tasks/Microsoft To Do). S, Free.
5. Email to task / calendar hold extraction (Gmail + Calendar + Tasks). S, Free.
6. "What's new" setup prompt plus "Suggest a connection or idea" box. S, Free. Drives adoption of every new connection.
7. Find a time and propose slots to someone (Calendar + Gmail send on click). M, Free.
8. Docs/Drive/Notion find, summarize and save-as-doc. S to M, Free.
9. Meeting prep brief and transcript summary with action items (Calendar + Gmail + Drive/Meet transcripts). M, Free basic, Pro local recording.
10. Small-business lead follow-up: new HighLevel lead triggers drafted email and Twilio SMS, sent on one click. M, Pro.

Next wave: Slack catch-up and drafts, follow-up nudges, price watch, invoice drafts (Square/QuickBooks), social posting via Zernio, appointment booking, browser form filling.
