// Connects the subscription apps (Claude Code, Codex, Gemini CLI), Antigravity and Grok Bot to the free-first rules.
// Loaded once by the server. Kept apart from server/free-first.js so that file has no import cycle with the agents.
import { setAppHooks } from "./free-first.js";
import { readyPlanRoutes, outOfQuota, planId } from "./plan-first.js";
import { routeModels as agyRouteModels } from "./antigravity-cli.js";
import { grokbotReady } from "./grokbot-text.js";

setAppHooks({ readyPlanRoutes, outOfQuota, planId, agyRouteModels, grokbotReady });

// 0.4.22: Freebuff (free coder inside Meldmind) is offered to the free-first router. server/free-bids.js is built by
// another change; when it or its setFreeBuffHooks is missing, nothing happens.
import { registerFreeBuffHooks } from "./freebuff-agent.js";
import("./free-bids.js").then((m) => registerFreeBuffHooks(m)).catch(() => {});
