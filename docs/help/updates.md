---
id: updates
title: Updates
summary: Check for updates from Help. Nothing downloads until you click.
lastUpdatedVersion: 0.4.25
---

# Updates

This note shows once after an update. Take the tour any time from the Help menu.

After an update, the first launch shows What's new. It lists every version between the one you had and this one, newest first. The notes are saved in the app, so they work with no internet. Open What's new again from this Help page, or from Settings, Onboarding tour. Got it closes it. Take the tour starts the tour.

Check for updates is in the Help menu and under About Meldmind on the Help page. The tray menu has it too. When a newer version is ready, the app says Update ready, restart. On the desktop, Install now at startup (or Update ready, restart) downloads it. Nothing downloads until you click.

If the check cannot reach the releases page, the app says Couldn't check for updates and offers Download. Download opens the releases page so you can get the installer yourself. Nothing is downloaded until you click. That notice is a slim row above the page, never on top of it. Hide closes it until the next launch.

The startup prompt says Install now and Later. Later at startup waits until the next time you open the app. The app checks on launch and again every hour, including when you open it from the shortcut while it is still in the tray. That prompt says Restart and update and Later. Restart and update downloads and restarts now. Later downloads the update and installs it when you quit.

Your settings, keys, and projects stay in place across an update. The portable build does not update itself. Use Check for updates in the installed app.

After you update to 0.4.9, the first launch shows New: let Meldmind use your desktop. From 0.4.17 a new install does not get this card on its own: desktop control is in Settings. It explains Allow for each app, the second click before a send, a buy, or a delete, the banner with Stop, and that passwords are not stored. Install and connect is there for Google Antigravity. Not now reminds you once. Never hides the card. You can still change it in Settings. The What's new note for that version says the same thing.

A packaged install includes what the engine needs to start. If the app did not open, install this update.

## Mac

The Mac build is unsigned. On macOS 15 or later, open System Settings, then Privacy and Security, then Open Anyway. Automatic updates for Mac are coming soon. Until then, Install now opens the download page. Drag the app to Applications and choose Replace. Your settings, keys, and projects stay in `~/Library/Application Support/Everborn Command`.

## Starting up and update checks (0.4.25)

While Meldmind starts up, a calm line says "Meldmind is starting up. This can take up to a minute." The engine warning only appears if the engine still does not answer after about 45 seconds. Couldn't check for updates now only shows when the update check really failed, not when it worked but the app was busy starting.
