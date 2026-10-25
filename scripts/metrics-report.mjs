// Owner report. Prints JSON and nothing else on stdout.
// Prefer the hub (CC_HUB_URL + CC_METRICS_SECRET) so the service key stays on the server.
// Otherwise read Supabase directly with CC_SUPABASE_URL + CC_SUPABASE_SERVICE_KEY.
// Does not call Stripe. Does not print emails, licence keys, or install ids.
import { fetchReport, utcDay } from "../server/usage.js";

const asOf = process.env.CC_METRICS_AS_OF || utcDay();

async function fromHub() {
  const hub = String(process.env.CC_HUB_URL || "").replace(/\/$/, "");
  const secret = process.env.CC_METRICS_SECRET || "";
  if (!hub || !secret) return null;
  const res = await fetch(`${hub}/api/metrics/report?asOf=${encodeURIComponent(asOf)}`, {
    headers: { authorization: `Bearer ${secret}`, accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  return text.endsWith("\n") ? text : `${text}\n`;
}

async function main() {
  const viaHub = await fromHub();
  if (viaHub) {
    process.stdout.write(viaHub);
    process.exit(0);
  }
  if (process.env.CC_SUPABASE_URL && process.env.CC_SUPABASE_SERVICE_KEY) {
    const report = await fetchReport({ asOf });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(0);
  }
  process.stderr.write("Set CC_HUB_URL and CC_METRICS_SECRET, or CC_SUPABASE_URL and CC_SUPABASE_SERVICE_KEY.\n");
  process.exit(1);
}

main().catch((e) => {
  process.stderr.write(`${e.message || e}\n`);
  process.exit(1);
});
