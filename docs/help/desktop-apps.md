---
id: desktop-apps
title: Apps on your desktop
summary: Let Meldmind use an app on this PC, starting with Google Antigravity. You allow each app, and passwords are not stored.
lastUpdatedVersion: 0.4.9
---

# Apps on your desktop

Meldmind can use apps on this computer that have no API. You allow each app. Nothing is used until you do.

Google Antigravity is the first app. It runs on this PC through its agy command. Open Settings and find Google Antigravity.

## Allow, install, and sign in

1. Tick Allow Meldmind to hand coding tasks to Antigravity. You can clear it any time. The manual handoff stays available.
2. Install and connect runs Google's installer, then opens sign-in in your browser. You sign in once. Meldmind does not see the password.
3. Check sends one short test task.
4. Type a task and click Send task. Stop ends the task that is running.

If agy is missing, or you are not signed in, the card says what to do next. You do not need a terminal.

The first setup screen has the same choice: Let Meldmind use your desktop. Skip it there and change it later in Settings.

## Add to Antigravity

Add to Antigravity writes the Meldmind server into Antigravity's MCP config on this PC. Other servers in that file stay. The bridge token stays in Meldmind's data folder. It is not copied into the config, and it is never put on a command line. Nothing is written until you confirm.

From Antigravity, the Meldmind tools can list agents, queue a task, and read a result that is already stored. A queued task does not send email, buy, or delete.

## Safety

- You allow each app before Meldmind uses it.
- Send, buy, and delete wait for a second click. The first click only prepares the step.
- A banner says Meldmind is using that app, and Stop ends it.
- Passwords are not stored.
- If a button in an app moves, Meldmind tries the other ways it knows to find that control. If it still cannot, it stops and the manual handoff is there. You paste the reply back yourself.

## After an update

After you update to 0.4.9, the first launch shows New: let Meldmind use your desktop. It has the same Allow, Install and connect, and the safety summary. Not now reminds you once. Never hides the card. You can still turn an app on later in Settings.
