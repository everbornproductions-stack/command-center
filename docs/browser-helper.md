# Built-in browser helper (Phase 27)

For people who do not have Grok Bot. An AI drives a browser one step at a time to finish a job, and the person watches and answers every risky step.

## How it works
- **Who drives.** The cheapest capable AI the person has a key for (`cheapest()` in server/router.js), or a model picked in Settings. It reads the page as text plus a numbered list of links, buttons, fields and forms (DOM reading; no screenshots), and answers with one JSON action per step: `open`, `click`, `type`, `submit`, `back`, `scroll`, `ask`, `gmail_search`, `gmail_read`, `gmail_send`, `drive_search`, `drive_read`, `done`, `fail`. Every call goes through smart fallback, is in the ledger (role `browse`) and is inside the spend caps. Each job also has its own step limit (12) and spend limit ($0.25), both in Settings.
- **Where it browses.**
  - Desktop app: a separate window (`electron/browser-helper.cjs`) with its own session (`persist:cc-browser-helper`), never the person's main browser profile. No permissions (camera, microphone, location, notifications) and no downloads. Pop-ups open in the same view. The page is read and driven from an isolated world, so the website's scripts cannot see or move the helper's element references. Clicks are real mouse events. A bar on top shows the task, the action log, the OK / No question and Stop. Closing the window stops the job.
  - Without the desktop app (`npm start`, tests): the text reader (`server/browser-reader.js`). It fetches pages, parses links, buttons, fields and forms, keeps a cookie jar per job, and runs no JavaScript.
  - Not on the hosted hub.
- **One-click Sign in with Google (0.4.17).** `server/oauth-signin.js` and `server/plugins/signin.js` (`/api/signin`) use Everborn's own Google sign-in app from `server/oauth-clients.json` (override `CC_GOOGLE_CLIENT_ID`, and `CC_GOOGLE_CLIENT_SECRET` for the desktop client secret, injected at build, never committed). Installed-app flow: PKCE (S256), a one-shot loopback listener on 127.0.0.1 with a random port, the sign-in page opened in the person's normal browser, the listener closed after the one callback or after 5 minutes. The first sign-in asks for `calendar.events`, `drive.file`, and `gmail.send`. **Read my inbox** is a separate later sign-in that adds `gmail.readonly` (`include_granted_scopes`). `gmail.compose` is defined but not asked for: it is a restricted scope and nothing writes Gmail drafts yet. Drive search and read accept `drive.file`. The doc records `via: "everborn"` so a refresh uses the same client. Microsoft is `server/microsoft.js` (`Mail.Send`, `Calendars.ReadWrite`, `offline_access`, public client, no secret, `CC_MS_CLIENT_ID`); its Read my Outlook inbox step is the Subscriptions mailbox flow (`Mail.Read`) with the same app. With no client id the button says one-click sign-in is coming soon and offers the own-client path below, which stays under Advanced.
- **Gmail, Drive, and Calendar (own client, Advanced).** These go through the person's own Google sign-in (`server/google.js`): OAuth with PKCE (S256) and an OAuth client the person registers (Google Cloud console: Desktop app, Gmail API, Drive API, and Calendar API enabled).
  - Scopes are `gmail.readonly` and `drive.readonly` by default. `gmail.send` is added only when the person ticks it. `calendar.events` is added only when the person ticks Google Calendar. It can list, create, and update events. It does not delete them. Calendar counts as its own connected service (Free 1, Pro all). Grok Bot's calendar handoff is unchanged.
  - A grant wider than what was asked for is refused, and nothing is kept.
  - The client secret and the tokens live in the vault (`google-helper`) and are never logged, written to a data file or sent to the browser.
  - More than one Google account: Settings has **Add another account**, a label on each account, and a default. Send to Browser helper has an account picker. Councils and missions use the default. The first account keeps `google-helper`. Each added account uses `mail-acct-<id>` in the same vault. The setup wizard calls `listAccounts`, `addAccount` and `removeAccount` (docs/mail-accounts.md). This change does not build that wizard.
  - Read calls use GET only. "Sign in again" answers 409, not 401.

## What needs an OK, and what is refused
Checked by `assess()` in server/browser.js before every action.
- **Asks first and shows exactly what will happen:**
  - Any form submit: the page, the button, the method and address it sends to, and every field with its value (hidden fields included; passwords never).
  - A click on anything that reads like send, reply, post, publish, share, delete, remove, unsubscribe, cancel a subscription, buy, pay, order, checkout, subscribe or transfer.
  - Opening an address that looks like one of those.
  - Every email: To, Subject and the full body.
  - `ask`: the helper needs the person, for example to sign in or solve a captcha. They do it in the window, then click OK.
- **Waiting for the answer.** A No is passed to the AI ("do not try it again"). With no answer within the wait (10 minutes), the job stops and nothing is done.
- **Refused outright:**
  - Typing into a password field. What was typed is never repeated in the log or to the AI.
  - Card or bank fields.
  - Stripe (stripe.com, buy.stripe.com, checkout.stripe.com, billing.stripe.com), other payment services (PayPal, Venmo, cash.app) and billing or payment-method pages.
  - Meldmind's own address (except the built-in demo page).
  - Anything that is not http(s).
  - Sending email without the send permission.

Page text is data, never instructions. The prompt tells the AI so, and the OK gate is the real protection. The OK shows what the page says about itself: a page that lies about a button's label can mislead the summary, but it cannot make anything happen without the click.

## Councils, missions and the hub
- **Who gets the job.** Councils and missions use at most one outside agent per job (`pickAgent()` and `missionAgent()` in server/agents.js).
  - Grok Bot gets it when it is set up and fits.
  - Otherwise the browser helper gets the parts that need a website, Gmail or Drive. Plain text work never goes to it.
  - Once Grok Bot is set up (connection saved or mock on), the helper joins only when the person picks "Browser helper: Always".
- **Its answer.** The answer sits in the council next to the others. It is peer-reviewed, scored, can win, and is credited in the learning router. In a mission, later steps get its result.
- **Late results.** A result that arrives after the wait (council 120 s, mission 15 min) is added afterwards, like Grok Bot's.
- **The hub card.** The card on the hub shows a light:
  - grey: off or not ready
  - green: ready or working
  - amber: waiting for an OK
  - red: the last job failed
  It also shows what the helper is doing now and an activity feed.
- **Events.** `browser.job`, `browser.step`, `external.handoff` (agent `browser-helper`, for the live project view) and `provider.status`.

## Trying it
- Settings > Integrations > Browser helper > **Try it on the demo page**. The demo page is `web/browser-demo.html`, a pretend bakery.
- What happens: the helper opens the page, fills in the contact form, then asks for an OK that shows every field. The form only reloads the page.
- Demo mode needs no keys: the pretend AI takes these steps (server/mock.js).

## Not verified
- The desktop window, its bar and the Settings / Command panels were syntax-checked only. They were not clicked through in Electron or a browser.
- Real Google sign-in and real websites were not used. All tests run against local mocks.
