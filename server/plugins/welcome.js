// Welcome email triggers. Signup covers a website download and an in-app account.
// A Pro licence is handled in server/license.js (Square is not called here).
// The config body never accepts an API key.
import { publicWelcome, saveMailConfig, queueWelcome, cleanEmail } from "../welcome-mail.js";

export const id = "welcome";

const SOURCES = new Set(["download", "account"]);

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/welcome/, "") || "/";
  const m = req.method;
  try {
    if (m === "GET" && (p === "/" || p === "")) return h.json(res, 200, publicWelcome());
    if (m === "POST" && p === "/config") return h.json(res, 200, saveMailConfig(body || {}));
    if (m === "POST" && p === "/signup") {
      const source = String(body?.source || "");
      if (!SOURCES.has(source)) return h.json(res, 400, { error: "source must be download or account" });
      const email = cleanEmail(body?.email);
      if (!email) return h.json(res, 400, { error: "email required" });
      const result = await queueWelcome({ email, firstName: body?.firstName, source });
      return h.json(res, 200, result);
    }
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code });
  }
  return false;
}
