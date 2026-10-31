// Cloudflare Worker that fronts the hosted hub container (see docs/hosted-hub.md).
// Every request to the hub address (CC_HUB_URL and the route in wrangler.jsonc; HTTP and WebSocket) is proxied
// to one container instance ("hub") running the same Node server as the desktop app in hosted mode.
// Secrets are set with `wrangler secret put` (tools/deploy-hub.ps1) and handed to the container as environment variables.
import { Container, getContainer } from "@cloudflare/containers";
import { CLOCK_CALLBACK, NEXT_DUE_HEADER, onCron, onHint, runTick, tickRequest } from "./hub-clock.js";

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

  // Storage, the one pending wake-up (a Durable Object alarm, which does not start the container) and the tick.
  clockHost() {
    return {
      get: (key) => this.ctx.storage.get(key),
      put: (key, value) => this.ctx.storage.put(key, value),
      armedAt: async () => { const [s] = await this.listSchedules(CLOCK_CALLBACK); return s ? s.time * 1000 : null; },
      arm: async (at) => { this.deleteSchedules(CLOCK_CALLBACK); await this.schedule(new Date(at), CLOCK_CALLBACK, "tick"); },
      disarm: async () => { this.deleteSchedules(CLOCK_CALLBACK); },
      tick: () => this.containerFetch(tickRequest(this.env)),
    };
  }

  // Proxy as before. A response that carries the next-due hint (a schedule was changed) sets the wake-up
  // time; the header is removed before the response leaves Cloudflare.
  async fetch(request) {
    const res = await super.fetch(request);
    const hint = res.headers.get(NEXT_DUE_HEADER);
    if (hint === null) return res;
    try { await onHint(this.clockHost(), hint, Date.now()); }
    catch (e) { console.error(`[hub-clock] hint: ${e && e.message ? e.message : e}`); }
    const headers = new Headers(res.headers);
    headers.delete(NEXT_DUE_HEADER);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }

  // Called by the 15-minute cron. Starts the container only when a schedule is due (worker/hub-clock.js).
  async cronCheck(now) { return onCron(this.clockHost(), Number(now) || Date.now()); }

  // The alarm callback set by arm(): a schedule is due now.
  async runScheduleTick() { return runTick(this.clockHost(), Date.now()); }
}

export default {
  async fetch(request, env) {
    // one hub for everyone (users are separated inside the server by their Supabase session)
    const hub = getContainer(env.HUB, "hub");
    return hub.fetch(request);
  },
  // Cloudflare cron (wrangler.jsonc triggers, every 15 minutes). Reads one stored time; it wakes the container
  // only if a schedule is due, so the container can sleep between schedules. CC_TICK_SECRET stays a secret.
  async scheduled(_event, env, ctx) {
    const hub = getContainer(env.HUB, "hub");
    ctx.waitUntil(hub.cronCheck(Date.now()));
  },
};
