---
id: zapier-make
title: Connect Zapier and Make
summary: Paste a Zapier or Make address, use their actions in a chat or a mission, and let a Meldmind webhook start work and return the result.
lastUpdatedVersion: 0.4.9
---

# Connect Zapier and Make

Connect Zapier from the Simple chat card, or connect Zapier and Make in Expert. Their actions can run in a chat or a mission after you click Allow. A Meldmind webhook can start a chat, a council, or a mission and return the result.

## Simple

On the chat page, the Connect Zapier card has the usual Zapier address filled in. Paste a token if Zapier gave you one, then click Connect Zapier. Meldmind lists the actions you turned on. Switch to Expert for Make, any MCP server, webhook tools, and the Meldmind webhook.

## Expert

Settings has the plain-word setup.

1. Zapier. Paste the MCP address. It is usually `https://mcp.zapier.com/api/v1/connect`. If a token is in the address, Meldmind stores it in the vault and takes it out of the address.
2. Make. Paste `https://mcp.make.com` and sign in, or paste the address Make gave you. A token in `/mcp/u/` is stored in the vault. Or paste a scenario webhook, the hook.make.com address Make shows you.
3. Any MCP server. Paste its address. Meldmind lists its tools.
4. Webhook tool. Paste an address, an optional header, and the JSON fields to send. The header value stays in the vault.

Free includes 1 app connection. Pro includes several (5). Extreme is unlimited.

## Allow before a send

A read can run when you have allowed read-only tools. Anything that sends, posts, or charges waits until you click Allow. Deny skips that action and the run continues. A click on Try in settings is the Allow for that one call.

## Meldmind webhook

Create the Meldmind webhook in Expert. The token is shown once. Zapier or Make sends:

`POST /api/hooks/meldmind`

Header: `Authorization: Bearer <token>`

Body examples:

- `{ "kind": "chat", "prompt": "Summarise this" }`
- `{ "kind": "council", "prompt": "Which headline is stronger?", "lite": true }`
- `{ "kind": "mission", "goal": "Draft a one-page plan" }`

The reply is the result. If the run is still going, the reply includes a poll address. Show the Meldmind template in settings for the ready request. The template file is `docs/integrations/meldmind-webhook.json`. It has no token in it.

On this computer the address is local. A cloud Zapier or Make can reach it only if you have made this computer reachable. Meldmind does not open a tunnel. Nothing is sent out until you click Allow.

## What stays out

HighLevel as its own connector under Connect is still planned. This page does not charge anything and does not change billing.
