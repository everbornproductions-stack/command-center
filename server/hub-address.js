// The hosted hub's public address, in one place for the desktop app.
// The hub itself reads CC_HUB_URL (wrangler.jsonc "vars"); this default is only used when that is not set
// (for example the desktop app's anonymous usage ping).
// hub.everbornproductions.com works today because everbornproductions.com is a zone in Chris's Cloudflare account.
// To move to hub.meldmind.ai once meldmind.ai is a Cloudflare zone: change this line, the route and CC_HUB_URL
// in wrangler.jsonc, and CC_HUB_URL in fly.toml (docs/hosted-hub.md, "Hub address").
export const DEFAULT_HUB_URL = "https://hub.everbornproductions.com";
export const DEFAULT_HUB_HOST = new URL(DEFAULT_HUB_URL).host;
