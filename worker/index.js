// Cloudflare Worker that fronts the hosted hub container (see docs/hosted-hub.md).
// Every request to hub.meldmind.ai (HTTP and WebSocket) is proxied to one
// container instance ("hub") running the same Node server as the desktop app in hosted mode.
// Secrets are set with `wrangler secret put` and handed to the container as environment variables.
import { Container, getContainer } from "@cloudflare/containers";

export class Hub extends Container {
  defaultPort = 8080;     // the server listens on PORT=8080 inside the image (Dockerfile)
  sleepAfter = "15m";     // stop the container after 15 minutes without a request; next request restarts it
  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = {
      CC_MODE: "hosted",
      PORT: "8080",
      CC_SUPABASE_URL: env.CC_SUPABASE_URL || "",
      CC_SUPABASE_ANON_KEY: env.CC_SUPABASE_ANON_KEY || "",
      CC_MASTER_KEY: env.CC_MASTER_KEY || "",
      CC_OWNER_EMAILS: env.CC_OWNER_EMAILS || "",
      CC_HUB_URL: env.CC_HUB_URL || "",
      CC_SUPABASE_SERVICE_KEY: env.CC_SUPABASE_SERVICE_KEY || "",
      CC_UPDATE_FEED: env.CC_UPDATE_FEED || "",
      CC_TICK_SECRET: env.CC_TICK_SECRET || "",
      CC_METRICS_SECRET: env.CC_METRICS_SECRET || "",
      CC_IDLE_EVICT_MIN: env.CC_IDLE_EVICT_MIN || "",
    };
  }
}

export default {
  async fetch(request, env) {
    // one hub for everyone (users are separated inside the server by their Supabase session)
    const hub = getContainer(env.HUB, "hub");
    return hub.fetch(request);
  },
  // Cloudflare cron (wrangler.jsonc triggers). Wakes the container and runs due schedules.
  // CC_TICK_SECRET is a wrangler secret. It is never written into wrangler.jsonc.
  async scheduled(_event, env, ctx) {
    const hub = getContainer(env.HUB, "hub");
    const req = new Request("https://hub.meldmind.ai/api/internal/schedules/tick", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cc-tick-secret": env.CC_TICK_SECRET || "",
      },
    });
    ctx.waitUntil(hub.fetch(req));
  },
};
