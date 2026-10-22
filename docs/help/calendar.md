---
id: calendar
title: Google Calendar
summary: Sign in with Google once, then list, create, or update events. Free includes 1 connected service. Pro includes every connected service.
lastUpdatedVersion: 0.4.15
---

# Google Calendar

Connect Google Calendar with one click: **Sign in with Google**. Meldmind can list your events, create an event, and update an event.

Free includes 1 connected service. Pro includes every connected service. Google Calendar counts as one connected service, the same way Gmail and Drive do.

Grok Bot can still take calendar work. That handoff is unchanged. A calendar job you send to Grok Bot still goes to Grok Bot. Meldmind's own Calendar connection is a separate sign-in.

The sign-in token stays in the vault on this computer. It is not shown again.

## Connect

1. Press **Sign in with Google**. It is on the welcome screen, in Get everything connected, and in Settings under Browser helper.
2. Google opens in your normal browser. Pick your account and allow what Meldmind asks for.
3. The browser says you are signed in. Go back to Meldmind.

The first sign-in asks only for three things:

- Calendar events (list, create, and update)
- Drive files that Meldmind makes or that you pick, not your whole Drive
- Sending email, and every email still waits for your OK

Google also shows your name and email address to Meldmind, so it can show which account is signed in.

Reading your inbox is a separate sign-in, **Read my inbox**. Use it only if you want Meldmind to read mail.

If the button says one-click sign-in is coming soon, Everborn's sign-in app is not in this copy yet. You can use your own Google client for now (see Advanced below).

## List, create, update

Settings, Google Calendar, lists upcoming events. Create event and Update run only when you click that button. Nothing is added or changed on its own. Meldmind does not delete events.

If the sign-in does not include Calendar, the page says it is not connected and does not call Google.

## Advanced: use my own Google client

This is for developers. In Settings, open Browser helper, then **Advanced: use my own Google client**. Add a Google OAuth client of type Desktop app and turn on the Google Calendar API in Google Cloud. Tick Google Calendar and press Connect Google. The client secret stays in the vault.
