---
id: desktop-apps
title: Apps on your desktop
summary: Let Meldmind use an app on this PC, starting with Google Antigravity. You allow each app, and passwords are not stored.
lastUpdatedVersion: 0.4.9
---

# Apps on your desktop

Desktop control is part of Pro. On Free the allow and install buttons stay off.

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

## Programs on this PC

Program scan is part of Pro. On Free the list stays off. Add a licence key in Settings.

Desktop control lists programs on this PC. On Windows it reads the uninstall list and the Start menu, plus command-line tools on PATH. File contents are not read. The same PATH list is used on other computers. Turn it on in Setup, or later in Settings under Programs on this PC. It stays off until you opt in.

Each program is matched to a capability list you can update. Allow each app. Allowed apps are scored and join the router's choices, the same as a tool you add. They do not replace the AIs that write. A text job still goes to a text model.

While you plan a mission or client work, a card suggests a program with a short reason, Free or Paid, and the official link. Dismiss hides that card. Nothing is installed or bought. Meldmind will not install or buy a program for you.

Turn suggestions off in Settings. The switch is Suggest a program while I plan a mission or client work. Update the app list only when you click the button, and only from an https address. That update changes the capability list. It does not install or buy anything.

This note shows once after an update. Take the tour again any time from Settings. The tour step is Programs on this PC.

## Doors after Antigravity

Settings, Desktop doors, is the list after Google Antigravity. Add a website, a Windows program, or an MCP server, then tick Allow. The app stays a draft until you do. Revoke hides it from the planner.

Send, buy, and delete wait for a second click. A banner says Meldmind is using that app, and Stop ends the step. Passwords are not stored. A password field is refused. Square and billing screens are refused.

A signed-in Edge or Chrome profile stays off until you opt in, and it does not start while that browser is open. The screenshot fallback stays off until you turn it on for that app, and it stops at its spend cap.

This build practices those doors with stand-in pages and stand-in windows. It does not open Edge, read a browser profile, or call UI Automation.
