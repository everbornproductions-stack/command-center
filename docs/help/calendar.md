---
id: calendar
title: Google Calendar
summary: Connect Google Calendar, then list, create, or update events. Free includes 1 connected service. Pro includes every connected service.
lastUpdatedVersion: 0.4.5
---

# Google Calendar

Connect Google Calendar with your own Google sign-in. Meldmind can list your events, create an event, and update an event.

Free includes 1 connected service. Pro includes every connected service. Google Calendar counts as one connected service, the same way Gmail and Drive do.

Grok Bot can still take calendar work. That handoff is unchanged. A calendar job you send to Grok Bot still goes to Grok Bot. Meldmind's own Calendar connection is a separate sign-in.

The client secret and the sign-in token stay in the vault. They are not shown again.

## Connect

1. In Settings, open Browser helper and add a Google OAuth client (Desktop app). Enable the Google Calendar API in Google Cloud.
2. Tick Google Calendar, or open Get everything connected and choose Google Calendar.
3. Sign in and allow calendar events.

Signing in again keeps the access you already granted when you connect from the checklist.

## List, create, update

Settings, Google Calendar, lists upcoming events. Create event and Update run only when you click that button. Nothing is added or changed on its own. Meldmind does not delete events.

If the sign-in does not include Calendar, the page says it is not connected and does not call Google.
