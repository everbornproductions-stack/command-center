---
id: privacy
title: Privacy
summary: What leaves this computer, where it goes, the three learning levels, and how to turn each one off.
lastUpdatedVersion: 0.4.19
---

# Privacy

Your API keys stay sealed on this computer. Each key goes only to the company it belongs to. Meldmind does not post, email, send, or spend anything unless you click to confirm that action.

## Three levels of learning and sharing

Meldmind splits learning and sharing into three levels so you always know what stays on your PC and what is shared:

1. **Level 1: On-device learning (default ON, no ask).** The router on your computer learns from your own jobs locally. Nothing leaves this PC. You can turn it off in Settings > Privacy or on Who's best.
2. **Level 2: Anonymous quality signals and usage counts (default ON with an up-front notice; default OFF and ask in consent-first regions such as the EU and the UK).** The welcome screen and Settings show the notice: *Helping Meldmind get smarter: anonymous results only, never your text.* It sends counts only: provider, task type, thumbs up/down or retry/accept, cost and latency bucket, app version, and a random install id. No prompts, answers, file names, emails, keys, or identifying ids. Existing installs see the notice once and keep their current choice unless they never made one. In this version nothing is sent yet: the choice is saved, and counts stay on this computer until a later update turns sending on.
3. **Level 3: Content sharing for our own-AI program (explicit opt-in, never pre-checked).** Sharing real prompts and answers for our own-AI program (source-tagged, with closed-AI outputs excluded) is always off by default in every region and is never pre-checked. Nothing collects prompts or answers without your clear yes.

Both Level 2 switches can be changed any time in Settings:

- Share anonymous usage counts to help improve Meldmind
- I am willing to share anonymous track records

## What leaves this computer

Settings has a page called Privacy: what leaves this computer. The welcome screen links to it too. It lists every item below, with what is sent, where it goes, when, whether it is on, and how to turn it off.

- **AI companies you connect.** Your prompt, the chat so far, files you attach, and your key go to that one company (for example OpenAI, Anthropic, Google, xAI, OpenRouter). Model lists, health checks, model watch, and credit balances use the same key at the same company. Remove the key to stop it.
- **Licence check.** Only after you add a licence key: the key, a random device id, the computer name, the operating system, and the version go to Everborn's licence server, about every 12 hours.
- **Update checks.** The desktop app asks GitHub for the newest version on launch and about every hour. Nothing about you is sent, and nothing downloads until you click Install now.
- **Anonymous usage counts.** Only while the switch is on: once a day, a random install id, the app version, the operating system, your plan, and how many times each feature was used go to Everborn's hub. No prompts, answers, file names, emails, keys, or identifying ids.
- **Anonymous quality signals and track records.** Counts only: provider, task type, thumbs up/down or retry/accept, cost and latency bucket, app version, and a random install id (the task type, which AI, and the score). No prompts, answers, file names, emails, keys, or identifying ids. Show what would be shared lists them.
- **Content sharing for our own-AI program.** Real prompts and answers you explicitly choose to share, source-tagged, with closed-AI outputs excluded. Always off by default and never pre-checked.
- **Model price list and status pages.** Plain requests for public price lists (OpenRouter) and AI status pages. Nothing about you.
- **Apps you sign in to.** Google, Microsoft, HighLevel, Meta, Notion, search engines, media tools, and the like get only what a job needs, only after you sign in, and a send or post waits for your click.
- **Community chat and AI News.** What you post, your public username, and your email only if you join the AI News list.
- **Chat sync.** Off until you turn it on. Chats are sealed with a key from your passphrase, so the server sees only scrambled data.
- **Handoffs, alerts, share links, phone pairing.** Only when you set them up or click them.

## Anonymous usage counts

Settings includes Share anonymous usage counts to help improve Meldmind. Clear it and the daily ping stops. Counts are not kept or sent while it is off.

## Shared learning

On Who's best, tick or clear I am willing to share anonymous track records. Meldmind learns from every job you run on this computer either way. Anonymous track records help it pick the best AI for everyone.

## What we share

For Level 2 quality signals, we share only anonymous track records: the task type, which AI, and the score (counts only: provider, task type, thumbs up/down or retry/accept, cost and latency bucket, app version, and a random install id). We never share prompts, content, or keys (no prompts, answers, file names, emails, keys, or identifying ids). Level 3 content sharing for our own-AI program is separate, explicit opt-in only, and never pre-checked.
