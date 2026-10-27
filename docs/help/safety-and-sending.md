---
id: safety-and-sending
title: Check before you send
summary: Try the send guard on a message, see the send log, test your monthly budget, and check your connections. Nothing is sent by these.
lastUpdatedVersion: 0.4.21
---

# Check before you send

Open Settings and find Try the send guard. Paste a text, email or post, pick where it would go, and press Check it. Meldmind tells you what it would warn about, in plain words. Nothing is sent or saved.

Texts also warn when the time you pick is before 8 am or from 9 pm on.

Every message, invoice, workflow start and post that Meldmind sends for you goes into the Send log on the Publish page. It shows when, where, the words, and whether you pressed Send anyway on a warning. Social Security and card numbers are hidden in it.

Test my budget (next to your monthly cap in Settings) is a practice check. It says your cap, what you have spent, what the next paid call needs, and whether it would be stopped. It spends nothing.

Check my connections (Settings, Publishing) lists each place you are signed in to and any permission it is missing, with the one button that fixes it.

When something stops, a small label says whose limit it is: your limit, their credit, busy, or your key.

## Safety check for what you built

Before you publish or download a website, app, game mod or script that you made with Meldmind, it runs a Safety check. It runs on your computer, it is free, and no code leaves your PC.

It shows a traffic light. Green means all clear. Amber means a few things are worth a look, and you can still publish. Red means a live secret, like a real key or password, is written in your files. Then Publish asks you to press Publish anyway, so it is never a surprise.

Many alike hits are shown as one issue with a short TL;DR. Keys that sit in test files are marked low, and made-up example keys are left out with the reason shown. A key is only ever shown as its first 3 characters and ****. For code patterns the exact line is shown, and it may be a false alarm.

Press Fix it to patch what can be patched safely, such as moving a key into a setting and adding a Content-Security-Policy tag. Meldmind then scans again and tells you how many are left. If a key was ever shared or published, change it at its website, because it may already be seen.

Turn it off in Settings, Safety check before publish. It is on by default.
