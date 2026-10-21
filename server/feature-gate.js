// Pro checks for this workstream. Phone pairing and the older limits stay in
// server/license.js guard(). Bring-your-own MCP servers and custom webhook tools
// are Pro too, but they are not columns on the tier table: an unknown name in
// guard() is refused even on Pro. Trial resolves to tier "pro" and is allowed.
import { guard, licenseState } from "./license.js";

const BYO = {
  byoMcp: "An MCP server by URL",
  byoWebhook: "A custom webhook tool",
};

export function gate(feature, info = {}) {
  if (feature === "byoMcp" || feature === "byoWebhook") {
    const s = licenseState();
    if (s.tier === "free") {
      throw Object.assign(new Error(`${BYO[feature]} is part of Pro ($15.99/month). Add a licence key in Settings.`), { status: 402, code: "pro_required" });
    }
    return s;
  }
  return guard(feature, info);
}
