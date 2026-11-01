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

// 0.4.33: OpenCode (free models, no account) is a free route: the router row and the local route live in
// server/opencode-agent.js; here it joins the last-resort list, the credit check and the free bids, and the binary is
// looked for once at start (and every few minutes after, while the router asks).
import { routeModels as ocRouteModels, refreshOpenCode, opencodeReady } from "./opencode-agent.js";
setAppHooks({ ocRouteModels });
refreshOpenCode();
import("./free-bids.js").then((m) => { if (typeof m.setOpenCodeHooks === "function") m.setOpenCodeHooks({ ready: opencodeReady }); }).catch(() => {});
