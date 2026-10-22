---
id: credits-left
title: Credits left for each AI
summary: Live balances where the AI has a balance API. Everywhere else, type your balance once and Meldmind keeps it up to date.
lastUpdatedVersion: 0.4.16
---

# Credits left for each AI

Open Subscriptions. The AI providers table shows the credits left for every AI you use.

Live numbers come straight from OpenRouter and DeepSeek, and from xAI with a management key. OpenAI and Anthropic show live spend with an admin key. Balances refresh when the page opens and every 15 minutes while the app is in use.

## Update balance

Some AIs have no balance API. For those, click Update balance, type the credits that AI shows now, and pick the day you saw it. From then on Meldmind subtracts the cost of each job and shows "tracked since" that day. The latest change has Undo.

Each row also says where that AI shows your usage and credit history, with an Open link, in case you want to compare.

## Use outside Meldmind

Agents that can run tools, such as Claude Code, Antigravity, and Grok Bot, can tell Meldmind what they spent. Click Show agent setup, then copy the standing instruction into the agent. Claude Code also gets a one-line setup command. The agent then calls the Meldmind tool report_usage, or adds usage to its report back, and the balance goes down by that amount. A report sent twice is counted once.

Plain chat apps cannot report. When your mailbox is connected, a receipt, top-up, or usage email from that AI updates the balance on its own. The row says "updated from email" with the date, the change is in the history, and Undo puts it back.

## Possibly off

Meldmind does not ask you to re-enter an old balance. It shows a soft "possibly off" note only when something does not match: a live spend report shows more than Meldmind tracked, or a usage email did not say how much is left. Type the balance in Update balance to clear it.

## When the credits run out

When an AI's API credits run out, Meldmind tries another way first, then can answer through your own plan for that AI: the official app on this PC (Claude Code, Codex, Gemini CLI, Antigravity), or a question you copy into that AI's page that asks it to send the answer back. Those answers cost no API credits. See Two-click handoff for how it works, and Settings, Backup when API credits run out, to turn it off.
