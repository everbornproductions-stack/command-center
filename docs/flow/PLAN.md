# Meldmind: game plan for the Flow build (from the Implementation Guide)

Prepared 2026-10-24 for Chris. Sources: `MindMeld_Implementation_Guide-3.pdf` (24 pages, in Downloads/ideasforguiandmore), the 13 Framer phone screenshots in the same folder, the persona reviews of 0.4.17 (Antigravity blind runs, including Rin; Gemini's run is still pending), and the release plan in memory. This is a plan, not a promise of dates.

## 1. The short answer

The guide is about eleven projects in one document. Putting all of it into one build would delay Sunday's test, delay Stripe, and bury us in bugs. The plan below keeps every item, in a firm order, and puts the whole guide ahead of every other planned release.

- **0.4.18 "Pay and Poise" (running now, for Sunday's test):** Stripe unlock, Square removed, Run the whole setup again button, anonymous learning signals on by default, Rin the interface persona, and the Missions / Councils / Research menu fix. Nothing else added.
- **0.4.19 "Look and Flow" (Chris, 2026-10-24: "I want everything done for 4.19"):** EVERYTHING in this plan, Phases A0, A, B, C and D, in one release. It is built slice by slice on one integration branch (`integration/0.4.19`), with internal test builds after each slice, and goes public only when the whole set passes the review gates in section 2 (tests, Rin's menu walk at three widths, persona panel, graphics check, performance check). Every slice sits behind a feature flag, so if one slice fails its gate late it is switched off for the release instead of delaying everything, and it ships in 0.4.20 when fixed. Work order inside the release follows the audit: A0 look and startup screen, A1 project continuity and delete, A2 prompt dropdown and video prompt pack, A3 smart next actions and Remix, A4 Live bubble and MCP badge, A5 Toggle All and navigation state, then B1 to B5 Flow Mode, then C finish and deploy (router and editors), then D agents, research, phone web page, takeover and Owner tools.
- **Cost and time (honest estimate):** this is the biggest release so far, many weeks of work and several weekly usage limits, even with free AIs drafting and Claude only verifying. Public users stay on 0.4.18 until it is done, so fixes from Sunday's test ship as 0.4.18.x patches.
- **After Flow (moved back, in this order):** Free first and Work while you wait (was 0.4.18), Developer mode (was 0.5.0/0.5.1), coding-agent face-off, MCP hub and Google Meet transcripts (0.6.0), hosted version and Mac builds resume (0.7.0).

If you want all of the guide inside 0.4.18 instead, say so, but expect Sunday's test to run on 0.4.17 and Stripe to wait.

## 2. Rules for every phase

1. **Never say no, always find a workaround** means finding another route, not bypassing safety. It never overrides: asking before send, pay, delete or sign; refusing billing and password screens; honoring the AI providers' terms; honest "I could not do that, here is the closest option" after real attempts.
2. **Privacy by design.** Scanning browser history, email and accounts (Find my AI, prompt sources) is on this PC, previewed before anything is used, and opt-in per source. Router learning stays on this PC. Anonymous quality signals follow the 0.4.18 rule (counts only). Sharing content with persona sections or the community is explicit, template-only, never keys or private data.
3. **Every phase ends with a review gate:** persona panel review including Rin (blind, no hints), Rin's automated menu walk in Simple and Expert at 1366x768, 1920x1080 and 3440x1440, screenshots at those widths, Windows CI, then release. Fix list rolls into the next phase.
4. **Build with free AIs where possible:** Antigravity and Gemini draft code in a separate worktree, Claude Sonnet verifies and runs tests, Claude only decides and reviews. Mac stays off until 0.7.0.
5. **Audit first.** Before building each item, check whether it already exists in the app (some of these may). The guide itself says many came from a live review of version 0.4.x, so the first task of 0.5.0 is a one-day audit: item by item, exists / partly / missing, written to `docs/FLOW-AUDIT.md`.

## 3. Where every item in the guide goes

### Phase A (0.5.0): everyday friction, the "UI Gap and Next Changes" list
Highest value, lowest risk, mostly UI. **Slice A0 first: the translucent-pane and rolling-light design system (section 4b).** Then, in the guide's order:
1. **Persistent "Working in: [Project]" bar** on Chat, Images, Remix, Media, Publish; **Continue this project** (one click from Projects or Live: project selected, last prompt restored, stage tools open).
2. **Prompt dropdown under every creation box** (Marching Orders, Images, Remix, builders): groups Recent / Saved / Stage / From sources; applies without overwriting typed text. (0.4.17 already keeps typed text for suggestions, extend that engine.)
3. **Smart next actions after every result** (Make 3 variations, Add to project, Send to Finish) and one consistent **Send to...** menu (Project, Remix, Finish, Copy prompt).
4. **Remix fixes:** Add to Project, open the saved location, status log beside the action, free-AI fallback when credits fail, show scope (one item or selection), prompt dropdown on the form, structured sources (game levels, scenes).
5. **Your apps / Programs on This PC:** Toggle All (Select All / Deselect All), AI tile opens that AI's setup directly, connected badge, no install prompts for anything already connected (connected-state awareness).
6. **Live:** Free AI bubble (health check every 15 to 30 s, 2 to 3 s timeout, cache 60 s, empty state with Refresh), out-of-credits state, MCP fallback with "via MCP" badge (reuses the 0.4.16 credit backup), Clear idle projects (they reappear when active).
7. **Projects:** Delete with confirmation, Recently Deleted undo, deleted projects vanish from Live and pickers.
8. **State that survives navigation:** back button restores forms and settings exactly; the persona/profile screen keeps its state; Simple/Expert remembered per project, less confirmation friction after first use.
9. **Never-say-no workaround behavior** at the planner level (try installed apps, then the browser, then smaller steps, then offer the closest option).
10. **Setup ends in a ready sample project;** setup leads with AIs already detected; one-click OpenRouter path; context-aware Help and "Do this next" cards; Settings regrouped (My AIs, Projects and Media, Privacy, Notifications, Advanced); shorter People hub message and simple invite roles.

### Phase B (0.5.0, completes the version): Flow Mode
11. Stages Creative, Planning, AI Movement, Build, Testing and Tweaks, Finish, with a clickable breadcrumb in Simple and a live horizontal flowchart in Expert; stacked steps auto-advance; add, remove, reorder, skip, or let the AI fill a stage; save, pause, resume, sub-projects, expandable projects.
12. **Always-visible Finish button;** "Looks good, Finish" / "Edit further" pair after every generation.
13. **Custom project templates:** Save as template; they appear in Start a project beside the presets; edit and delete own templates.
14. **Per-project Media folder** (tab inside the project: grid, drag and drop, upload, add from last generation, filters, Send to menu) plus the **asset tray** (drag into prompt or Remix), version stacks, tags, search, usage badges; links not copies across projects.
15. **Undo and Branch** on generation steps; inline progress pill; Finish preview card with one confirm.
16. **Momentum Mode** (action bar with 2 to 4 predicted next actions, background autosave, one-tap variations, resume), using the guide's local scoring formula, explainable, under 10 ms, all on this PC.

### Phase C (0.5.1): Finish and Deploy
17. **Thin router:** deterministic rules first (file types, assets, tags), then local embeddings (MiniLM-class ONNX, under 150 MB quantized), zero-shot LLM only as fallback; thresholds 0.85 direct, 0.60 to 0.84 confirmation chip, below goes to General; user override, "Why this editor?" panel, local override history, Re-classify button, test set with regression checks.
18. **Category editors:** Images (non-destructive sliders for light, exposure, contrast, ambient, color, skin tone, clarity; before/after; versions), Video (sound line, subtitle line, timing, export), Programs (review, edit, test before deploy), Games (item and asset editor), Social (post now or schedule, variations, content calendar), Websites (one-click publish to Cloudflare Pages, Vercel, Netlify; domain and env setup; preview and roll back), Accounting (editable table, export, approval), Documents, Automations (test run, schedule, activate), Music, Presentations, and a General workspace.
19. **Photography real enhancement** (Photoshop-style adjustments that preserve the original photo) and the prompt set for it.
20. **Personas menu and review step:** optional "Share to a persona section?" after Finish, a Personas menu to add, hide and choose sections, template-only sharing. Needs a server part (community) and moderation, so it ships last in this phase.

### Phase D (0.5.2): agents, phone and owner tools
21. **Browser agents** (Planner, Navigator, Researcher, Writer, Analyst) with the observe-reason-act-verify loop, DOM/accessibility tree first and screenshots as fallback, visible steps, local and cloud model choice, page chat and summaries, split view, notes, command palette.
22. **Deep Research** orchestrator: lead plans 2 to 5 facets, parallel sub-agents, external memory, citation pass, effort scaling rules, cost warning (about 15 times a normal chat), checkpoints and retries.
23. **Proactive behavior:** morning brief, background work, single thread with topic channels, approvals for sensitive actions.
24. **Phone companion:** dual control with queued input (latest explicit direction wins), live job status, quick actions, voice, image tools, posting, lightweight and responsive. (Decided: phone web page first, installable to the home screen; store apps only when there is money for the app stores, 0.8+.)
25. **Multi-AI coordination:** project mirrored inside other AIs, review and take over their scheduled tasks, "Review and Take Over Tasks" button in Scheduled.
26. **Owner Mode extras:** talk to Meldmind about itself, routing and Momentum controls, thresholds, logs, model management, in-app self-building as a project with approvals.
    - **Placement (Chris approved Oct 27, 2026):** split and moved earlier. Owner-only Meldmind-repo spike (read and propose in a worktree, no apply) in 0.4.24. Read-only "talk to Meldmind about itself" and the in-app AI worker pool in 0.4.25. Owner-only self-editing with branch previews, tests, explicit approval, a never-list, a kill switch and an audit log in 0.5. See design-ref/ROADMAP-SELF-BUILD.md and CHRIS-NOTES-0424.md.
27. **Optional performance work:** ONNX graph optimization and INT8, TensorRT on NVIDIA as an opt-in High Performance mode, Low Power mode. CPU stays the default.

### Not in 0.5.x
Automatic desktop scanning of email for prompts beyond the opt-in sources, anything that sends or posts without a click, Mac builds, hosted version.

## 4. What the Framer screenshots tell us (design ideas)
The 13 screenshots show Framer's phone page. Ideas worth borrowing, for both the Meldmind website and the app's home and welcome screens:
- **Bordered bento tiles** with one big number or word and an arrow (like "99.99% uptime / Hosting" and "Localization"). For us: real facts only, such as "0% markup on AI", "Never just stops", "AIs working as one team".
- **Looping product demo** inside a device frame with a progress timer and a play/close modal (the 0:36 video). We already have a film; add a looping silent demo of the live project view and the credit backup.
- **Scrolling logo marquee** of supported AIs (Claude, ChatGPT, Gemini, Grok, Perplexity...) with the trademark footer line kept.
- **Sticky slim header** with Log in / Download and a hamburger menu; one primary white button on dark.
- **Short, light cookie notice** with Reject and Accept equally prominent (we use Reject-first for privacy).
- **Large clean type, one idea per screen** on phone, which supports your request to shorten the phone site.
Apply to the website after the 0.4.18 release; apply to the app's welcome screen and Projects home in Phase A.

## 4b. The look Chris asked for (Chris, 2026-10-24): "translucent panes, gradient screens, rolling light around active pieces that are working"
This becomes **Phase A0, the first slice of 0.5.0**, so every later screen is built in the new style. Based on the Framer screenshots (dark gradient backdrops, frosted panels, a glowing blue outline that travels around the piece being worked on).
- **Translucent panes:** panels, menus, cards and dialogs use a frosted-glass surface (semi-transparent fill, `backdrop-filter: blur`, thin light border, soft shadow) over a slow dark gradient backdrop. Light and dark themes both, and the existing background image (concert wallpaper) shows through the panes.
- **Gradient screens:** a small set of named gradients (calm, working, success, attention) used for the app background, headers and the Finish stage; never behind long text without enough contrast.
- **Rolling light on anything that is working:** a light that travels around the border of the active piece while it runs (a Live node with an AI on it, the current step in Flow, the Marching Orders box while a job runs, a Remix step, the Finish button while producing). Built with CSS only (conic gradient border animation using `@property`, masked to the outline), no JavaScript animation loop, GPU friendly. Colors tell the state: blue-white for working, green flash on done, amber for waiting on you, red only for an error.
- **Rules so it stays fast and readable (the guide's performance section and Rin's job):** respects the system "reduce motion" setting (static glow instead of rolling), pauses when the window is hidden, never more than a few animated outlines at once (idle ones are static), disabled in Low Power mode and on weak graphics, text contrast checked at 4.5 to 1 on every pane over the busiest background, no blur on large full-screen areas on slow machines (falls back to a solid tinted fill), and works on the 1366x768, 1920x1080 and 3440x1440 widths.
- **Scope:** shared design tokens in one file (colors, blur, radius, glow speed) so the whole app and the website can use the same look; then apply to Welcome, Projects, Command, Live, Remix, Your apps, Finish. Simple mode gets calmer settings (slower, fewer glows); Expert shows the full flow.
- **Website:** the Meldmind page gets the same translucent cards and one rolling-light accent on the live project view demo, after the 0.4.18 release.
- **Review gate:** Rin judges contrast, motion and layout with screenshots at the three widths; the persona panel judges whether it feels calm for Dorothy and sharp for Max.

### Startup screen (Chris, 2026-10-24): "Need a Meldmind start up screen: Meldmind.ai, with a tagline. I love the animation we did for the website."
Part of slice A0 (the first slice of 0.5.0, after 0.4.18; Chris confirmed "I want all this implemented after 4.18"):
- **What it shows:** the name **Meldmind.ai** over the same moving backdrop and rolling light as the website hero (the city background loop and the glow), then a one-line tagline. The tagline is **Are you gAmIe?** (Chris, on purpose: the capital A and I hide "AI" inside the word "game"). Spell it exactly "Are you gAmIe?" in the text; draw the A and the I in the accent gold with the rolling light running around just those two letters; the rest in plain white. The screen reader label is "Are you game?" so it reads naturally. Keep the website's line "Meldmind never just stops." as the smaller second line only if there is room
- **How it behaves:** about 2 to 3 seconds, tap or key to skip, once per launch (not on every window focus), runs while the app loads so it never adds waiting time, a still frame when "reduce motion" is on or in Low Power mode, and it fades straight into the welcome screen on first run or into Projects after that.
- **Assets:** reuse the website's backdrop and film frame (under `site-deploy/meldmind`), compressed small (the guide wants a fast app); no new heavy video inside the installer.
- **Where it also appears:** the sign-in screen and the "Meldmind.ai" installer window can use the same artwork later.

### AI video prompt pack (Chris, 2026-10-24): "incorporate into building Meldmind"
Chris asked to study Skool (a community platform, not a video generator; many AI video prompt communities are on it) and put AI video prompts into Meldmind. Plan:
- **Slice A2 (with the prompt dropdowns):** add an original **AI video prompt pack** to the prompt library and to the video, reel and music-video builders: product and business reels, real estate, local service, music video shots, social hooks, first-frame image prompts, camera movement library, lighting and mood library, negative prompts, and Chris's realism checklist (mouths mostly closed, tiny natural beats, no exaggerated motion). Source: `meldmind-ai-video-prompt-pack-draft-2026-10-24.md` (original wording, written from public techniques only; research notes in `meldmind-ai-video-prompts-research-2026-10-24.md`).
- **Tool tips per video tool** shown beside the prompt (Kling, Runway, Veo, Luma, Pika, Hailuo, Seedance, Higgsfield and others), refreshed by the weekly scout so they do not go stale.
- **The prompt dropdown groups** gain "Video" and "From sources"; weekly packs can add new video prompts.
- **Licensed content:** we do NOT copy paid Skool course prompts. If a community's prompts are worth having, Claude drafts a short partnership or licensing note for Chris to review and send himself (Claude never sends it). Free public prompts are used only for technique, rewritten as originals.
- **Review gate:** persona panel (YouTuber, Influencer, Viral Marketer, Real Estate, Max, Rin) judges the pack; realism rule enforced in every video prompt.

### Graphics check and "Look" choice (Chris, 2026-10-24): "detect the graphics card and ask them if their card isn't up to par to run the new GUI, so they can keep the one we have now"
Part of slice A0. The new look (frosted panes, gradients, rolling light) must never make the app slow on weak graphics.
- **Easy toggle (Chris, 2026-10-24: "be able to toggle on the nicer looking GUI in settings"):** Settings, Look is near the top of Settings and has a plain switch, "Use the new glass look" (On / Off), with "Auto" as the starting choice; the same switch is in the quick settings menu. Turning it on works on any machine (a weak one gets a one-line speed warning, not a block) and takes effect at once without a restart, with an Undo toast for 10 seconds.
- **Three looks, one setting (Settings, Look):** **Auto** (default), **Full glass** (new look), **Classic** (today's look, solid panels, no blur, no moving light). Classic is kept as a fully supported look, not a leftover.
- **Detection on first run and after driver or hardware changes:** read the graphics info the app already has access to (Electron GPU feature status and info: hardware acceleration on or off, software rendering such as SwiftShader or WARP, vendor and device, integrated vs dedicated, video memory when reported, display size and count, refresh rate) and score it Good / Borderline / Weak. Software rendering or no acceleration is always Weak.
- **A short speed test, not only a lookup:** while the startup screen plays, measure real frame times for about 1 second with the glass and one rolling light enabled. If the average is under 40 frames a second (or any long stutter), treat the machine as Borderline or Weak whatever the card name says. Lookups can be wrong; the measurement decides.
- **Ask, do not force:** Good = Full glass quietly. Borderline = Full glass with a one-line offer ("Your graphics look a little slow for the new look. Use the classic look?" Yes keeps classic, No tries the new look). Weak = start in Classic and offer "Try the new look" in Settings. The choice is remembered per computer and can be changed any time.
- **Safety net while running:** if frame rate drops for several seconds with Full glass on, show a small, dismissible prompt to switch to Classic; never switch silently. Also honor the operating system "reduce motion" setting and Low Power mode (static glow, no blur).
- **Also feeds Free first:** the NVIDIA and memory info (already in the unreleased `server/gpu.js`) is reused for the local-model offer, so detection is written once.
- **Tests and review:** unit tests with sample graphics reports (good, integrated, software, missing info), a test that Classic renders with no blur and no animation, a test that the choice persists, and Rin reviews Classic and Full at the three screen widths. Test hardware: Chris's Intel Arc laptop is the "borderline" case, his NVIDIA PC the "good" case.
- **Website:** no graphics check; the page already honors reduce-motion and keeps animation light.

## 5. Order of work and who does what
1. Tonight and Sunday: 0.4.18 finishes and ships (Stripe first). Sunday's hands-on test and persona runs produce the fix list.
2. Next working day: audit (`docs/FLOW-AUDIT.md`), then Phase A in slices, one branch per slice (Antigravity or Gemini drafts, Sonnet verifies), each slice merged to an integration branch.
3. Rin's menu walk and screenshots run on each slice. Persona review at the end of A and of B.
4. Release 0.5.0 when A and B pass; C is 0.5.1, D is 0.5.2.
5. Update the website "Coming next" section and the investor roadmap sheet after each release.

## 6. Risks and open questions for Chris
- **Scope and usage:** this is large; free AIs cut the cost but Claude still has to verify and review. Weekly limits may stretch it across several weeks.
- **Personas section and peer review** needs a server, moderation and privacy rules; ask the attorney about user-generated content and sharing terms before we ship it.
- **Owner Mode self-editing** is powerful and risky; keep it behind approvals and Owner licence only.
- **Email and newsletter prompt scanning** needs mail permissions; opt-in per sender or label.
- **Question:** do you want the persona sections (peer review) in 0.5.1 as planned, or later behind Community?
- **Decided (Chris, 2026-10-24):** the phone companion is a phone web page first (installable to the home screen as a web app, no store listing). Store apps wait until there is money for the app store fees and review process.

## 7. The build queue is also a Meldmind feature (Chris, 2026-10-24)
"This is also to be built into Meldmind to help route projects and remember, so having it on my machine is a good test for when the program is running."
The 0.4.19 build queue (`tools/build-queue/`: job files with briefs and dependencies, `workers.json` registry of installed AIs, a runner that picks the first free worker that is not resting after a limit, per-job branches, a review gate) is the working prototype of Meldmind's **AI worker pool**: the app keeps a list of the AI programs on the PC, remembers which one is out of usage and until when, hands each step of a project to the best available one, keeps each step's result on its own branch or version, and asks the user to approve before anything merges. Keep the job format, worker registry format and cooldown memory plain JSON so the app can reuse them. Lessons from running it on Chris's PC (which AIs fail, limit messages, timings) feed the design. Product slice: part of Free first and Work while you wait, using the Live view and project stages from Flow. (Placement update, Chris approved Oct 27, 2026: the in-app worker pool lands in 0.4.25, after the 0.4.23 learning fixes and the 0.4.24 learning and spike work.)
