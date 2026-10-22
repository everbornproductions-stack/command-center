---
id: council
title: Council
summary: Several AIs answer, review each other, and a chair writes the verdict. You need two AI companies, or one OpenRouter key.
lastUpdatedVersion: 0.4.3
---

# Council

A council asks AIs from different companies the same question. They answer, review each other without seeing names, and a chair writes the verdict with a short list of where they disagreed.

## What you need for a council

- One AI company (one key from Claude, ChatGPT, Gemini, or Grok) is one AI. It answers on its own. There is no peer review.
- Two AI companies (for example a Claude key and a ChatGPT key) give you a council.
- One OpenRouter key also gives you a council. OpenRouter sells models from several companies under one key, so Meldmind seats Claude, ChatGPT, Gemini, and Grok through it. Each seat says which family it is, for example "Gemini via OpenRouter". Every call is in the ledger at that model's price, and your spend caps still apply.
- Free includes 5 councils a month. Pro and Extreme have no monthly limit.

Practice mode (Try it now) uses three pretend AIs. They can show you a practice council. Nothing is spent.

## Simple and Expert

In Simple, Meldmind picks one AI for each chat. Under the answer it says "Answered by one AI" and names it. When a council is possible, the answer also shows Ask a council, which sends the same question to a council.

In Expert, the order box has three ways to run:

- Single: the best AI for the job answers.
- Council: several AIs answer, review each other, and a chair writes the verdict. Expert shows the debate and the scores.
- Mission: the job is split into parts. Specialists work, a different AI checks each piece, and the result is assembled.

Claude, ChatGPT, Grok, and Gemini need an API key, or an OpenRouter key, to take part. An MCP server does not take their place in the council. Spend caps in Expert can stop a provider that has hit its monthly cap.
