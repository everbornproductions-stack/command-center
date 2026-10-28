---
id: safety-and-sending
title: Check before you send
summary: Try the send guard on a message, see the send log, test your monthly budget, and check your connections. Nothing is sent by these.
lastUpdatedVersion: 0.4.24
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

Many alike hits are shown as one issue with a short TL;DR. Keys that sit in test files are marked low, unless they are a real live key such as a Stripe sk_live key, which counts as live anywhere, and made-up example keys are left out with the reason shown. A key is only ever shown as its first 3 characters and ****. For code patterns the exact line is shown, and it may be a false alarm.

Press Fix it to patch what can be patched safely, such as moving a key into a setting and adding a Content-Security-Policy tag. Meldmind then scans again and tells you how many are left. If a key was ever shared or published, change it at its website, because it may already be seen.

Turn it off in Settings, Safety check before publish. It is on by default.

## What changed in 0.4.23

The Safety check now catches Stripe, SendGrid, Twilio and Supabase secret keys, checks built files (dist, build, .min.js) for keys, treats a real live key in a test folder as live, and turns red for a Social Security or card number in the words you send.

Publish and Remix publish scan your project folder again on this computer right before anything goes out, instead of trusting an earlier check, and the result says what was checked.

Opening web pages for research is safer: every redirect is checked again, pages on this computer or a private network are refused, and very large pages are cut off.

Code an AI wrote for a mission test now runs fenced in to your project folder: it cannot write or read other files or start other programs. If your computer cannot fence it in, it does not run.

A busy free AI (rate limit) is rested for about 15 minutes instead of until midnight, and the budget message names what is left when both amounts would look the same.

The start screen never stays longer than 12 seconds and fades out on every path, links that open a new window only open inside the app for its own pages, and Freebuff only works in Meldmind project folders.

Small fixes: the sign-in email box is required again, titles keep their spaces and plain numbers, the last "Practice" labels now say Sample or Test only, and the test run on Windows reports every failing file instead of stopping at the first.

## What changed in 0.4.22

Safety check before you publish or download: Meldmind scans the words and files for leaked keys, passwords and old risky packages, shows plain fixes with a Fix it button, and blocks a live secret unless you choose Publish anyway.

Answers that contain code keep it exactly as written, and plain requests like a cheat sheet or a week of posts no longer start a picture.

Publish previews now show their warnings, and private numbers (SSN, card) are hidden in titles and file names.

Safer sending and files: the send check and log use the final drafted message, the no-send switch covers more tools, MindMedia folders are checked for symlink tricks, links open only as http, https or mail, and the never-list no longer blocks unrelated apps.

The app's own spending stop is no longer blamed on an AI, and the message now says whether a job would go over your limit or you have used it up.

Small fixes: the open page is marked in the sidebar, closing the Finish drawer returns you to the button you used, and Instagram previews are accurate for text-only items.
