# Provider API and architecture research (2026-10-17)

Sources: official docs and pricing pages fetched on the date above unless marked (3rd-party) or (unverified). Prices in USD per 1M tokens (in/out) unless noted. Several 2026 pricing pages carry scheduled increases (Gemini doubles Dec 1 2026 / Jan 1 2027; Mistral Large 4 is on a sale price), so the app keeps prices in an editable JSON (`data/pricing.json`), not in code.

## Provider table

| Provider | Base URL / auth | OpenAI-compatible | Flagship (price) | Cheap (price) | Balance / usage API | Status JSON |
|---|---|---|---|---|---|---|
| Anthropic | `api.anthropic.com/v1/messages`; `x-api-key`, `anthropic-version: 2023-06-01` | No (native) | `claude-opus-5-5` $4/$20; `claude-fable-5-1` $10/$50 | `claude-haiku-5-5` $0.10/$0.50 | No balance endpoint. Usage/cost only through the Admin API (admin key; not for individual accounts). Spend-cap 429 carries `enforced_spend_limit_reached`. | `status.claude.com/api/v2/status.json` |
| OpenAI | `api.openai.com/v1`; Bearer | Yes | `gpt-6-astra` $10/$50; `gpt-6.1-sol` $2/$10 | `gpt-6-luna` $0.10/$0.50 | No balance endpoint; org usage/costs need an admin key. | `status.openai.com/api/v2/status.json` |
| Google Gemini | native `generativelanguage.googleapis.com/v1beta`; OpenAI-compat at `/v1beta/openai/` with Bearer | Yes (compat layer) | `gemini-4-argon` $2/$10 | `gemini-3.1-flash-lite` $0.25/$1.50; `gemini-3.8-flash` $0.75/$3.75 | None (dashboard only) | `status.cloud.google.com/incidents.json` |
| xAI | `api.x.ai/v1`; Bearer | Yes | `grok-4.7` $2/$6 | `grok-4.3` $1.25/$2.50; `grok-build-0.1` $1/$2 | Yes, Management API (`management-api.x.ai`, management key): prepaid balance, usage, invoice preview | status.x.ai (unverified) |
| Perplexity | `api.perplexity.ai`; Bearer | Partly. Sonar `/chat/completions` retired 2026-09-27; use Agent API `POST /v1/agent` or Orchestrator `POST /router/v1/chat/completions` | `sonar-pro` $3/$15 + per-request fee | `sonar` $1/$1 + per-request fee | None | `status.perplexity.com/api/v2/status.json` |
| OpenRouter | `openrouter.ai/api/v1`; Bearer | Yes | passthrough, 5.5% fee on credit purchase | `openrouter/free` | Best in class: `GET /api/v1/key` (limit, limit_remaining, usage, usage_monthly), `GET /api/v1/credits` (management key), `GET /api/v1/generation?id=` (exact cost). Every response carries `usage.cost`. | unverified |
| Mistral | `api.mistral.ai/v1`; Bearer | Yes | Large 4 $0.68/$2.09 (sale) | Small 4 $0.15/$0.60 | None | unverified |
| DeepSeek | `api.deepseek.com`; Bearer | Yes | `deepseek-v4-pro` $1.32/$3.96 | `deepseek-flash` $0.30/$1.20; off-peak 50% off | Yes: `GET /user/balance` | unverified |
| Groq | `api.groq.com/openai/v1`; Bearer | Yes | `openai/gpt-oss-120b` $0.15/$0.60 | `openai/gpt-oss-20b` $0.075/$0.30 | None; rate-limit headers `x-ratelimit-*` | `groqstatus.com/api/v2/status.json` |
| ElevenLabs | `api.elevenlabs.io`; `xi-api-key` | No | v3 $0.08/1K chars | Flash $0.04/1K chars | Yes: `GET /v1/user/subscription` (character_count, character_limit, reset) | `status.elevenlabs.io/api/v2/status.json` |
| Suno | none | | | | No official API (partner intake announced Jul 2026). Wrappers are reverse-engineered: ToS risk. | |
| Kling | Kling Open Platform: JWT from AccessKey/SecretKey, `Authorization: Bearer <jwt>`; host api-singapore.klingai.com / api.klingai.com (unverified) | No | Kling 3.0 Pro about $0.11–0.17/s via fal | | `GET /v1/account/costs` resource packs (3rd-party, unverified). Simpler: route through fal.ai or Runway and read their balance. | |
| Runway | `api.dev.runwayml.com/v1`; Bearer; `X-Runway-Version: 2024-11-06` | No | gen4.5 12 cr/s; veo3.1 40 cr/s; 1 credit = $0.01 | gen4_turbo 5 cr/s | Yes: `GET /v1/organization` (creditBalance), `POST /v1/organization/usage` | `status.runwayml.com/api/v2/status.json` |
| Luma | `api.lumalabs.ai/dream-machine/v1`; Bearer | No | Ray3.2 5s 720p $0.30 | image $0.04 | Yes: `GET /credits` (cents) | HTML only |
| fal.ai | `queue.fal.run/{model}`; `Authorization: Key` | No | per model | | Yes: `GET api.fal.ai/v1/account/billing?expand=credits` | unverified |
| Replicate | `api.replicate.com/v1`; Bearer | No | per second | | No balance endpoint | redirects to cloudflarestatus |
| Midjourney | none | | | | No official API; ToS bars automation. Alternatives: Ideogram, FLUX via fal/Replicate, gpt-image-2, Gemini image, Runway gen4_image. | |
| Stability | `api.stability.ai`; Bearer | No | Ultra $0.08/img | Core $0.03 | `GET /v1/user/balance` (from memory) | |
| Sync.so | `api.sync.so` (unverified); `x-api-key` (unverified); `POST /v2/generate`, `GET /v2/generate/{id}` | No | sync-3 $0.133/s | lipsync-1.9 $0.02/s | No balance endpoint; cost-estimate endpoint exists | |
| HeyGen | `api.heygen.com`; `X-Api-Key` | No | Avatar IV about $0.05–0.10/s (3rd-party) | | Yes: `GET /v2/user/remaining_quota` | `status.heygen.com/api/v2/status.json` |
| Ideogram | `api.ideogram.ai`; `Api-Key` | No | 3.0 Quality about $0.09/img | Turbo $0.03 | None | |
| Udio | none | | | | No public API (Sep 2026) | |

Rate-limit headers: Anthropic `anthropic-ratelimit-*` + `retry-after`; OpenAI/Groq `x-ratelimit-*`; OpenRouter only on 429. Nobody else documents them.

Batch / cached / cheap modes: Anthropic Batches 50%, cache reads about 90% off; OpenAI Batch and Flex 50%; Gemini Batch 50% + context cache; Mistral Batch 50%; Groq Batch 50% (3rd-party); DeepSeek prefix cache + off-peak 50%; xAI cached input 75% off; OpenRouter `:floor` and `provider.max_price`.

## Key storage on Windows (recommendation)

Electron `safeStorage` (DPAPI on Windows, Keychain on macOS) in the main process with the ciphertext in userData. For a plain Node app (what v1 is), DPAPI through PowerShell's `ProtectedData` gives the same protection with zero native modules. `keytar` is archived; `@napi-rs/keyring` only if entries should appear in Windows Credential Manager. Caveat for any desktop app: this protects against other users, not other apps in the same session. Keys stay in the server process; the UI only ever sees a masked key.

## Multi-provider abstraction (recommendation)

Direct adapters to each vendor (true BYOK), OpenAI-compatible adapter for everything OpenAI-shaped, Anthropic SDK for Claude, plain fetch for media APIs. Vercel AI SDK 7 is a good option when the product moves to TypeScript/Electron. OpenRouter as an optional provider, not the spine. LiteLLM (Python proxy) and Portkey (hosted gateway) rejected.

## Routing recipe (fewer credits)

1. Classify first with heuristics, then a nano model. 2. Tier table (nano / mid / frontier), editable. 3. Escalate on failure instead of pre-paying for the big model. 4. Lower effort before changing model. 5. Route per conversation to keep prompt caches. 6. Batch anything non-interactive (50%). 7. Time-shift DeepSeek to off-peak. 8. Measure every call and show "credits saved vs frontier".

Evidence: RouteLLM reaches about 95% of GPT-4 quality sending only 14–26% of prompts to the big model; RouterArena (ICLR 2026) found Not Diamond overspends. Simple classification plus tiering beats learned routers for a product you control.

## Streaming and event schema

WebSocket (in-band interrupts) or SSE both work for a local server. The app's events: provider.status, agent.start, agent.delta, agent.done, agent.error, agent.msg (AI to AI), task.update, mission.update, council.update, ledger.entry, log. These map one-to-one onto AG-UI 1.0 names (RUN_STARTED, TEXT_MESSAGE_CONTENT, SUBAGENT_*, CUSTOM) if an AG-UI client is ever needed.

## Council pattern and frameworks

Karpathy's llm-council (Nov 2025): same prompt to N models, anonymized peer ranking, chairman synthesis. Cost = 2N + 1 calls; use mid-tier reviewers at low effort and a frontier chairman. Weaknesses: verbosity bias and chairman ceiling. Frameworks for JS in 2026: Vercel AI SDK 7 (best fit for BYOK desktop), Mastra (heavier, workflows/memory), OpenAI Agents SDK (OpenAI-first), LangGraph.js (verbose, durable), Claude Agent SDK (Claude-only coding harness).

## Could not confirm

Kling official host/endpoint fields; Stability balance shape; Sync.so host and header; ElevenLabs/Gemini header names (from memory); xAI/OpenRouter/Mistral/DeepSeek/fal status JSON; Mistral alias IDs; Ideogram/HeyGen per-image prices; Groq batch discount; Perplexity post-retirement behaviour of `sonar-pro` on the old endpoint.
