// The account's public username. One name, used wherever this account is shown to other people.
import * as Account from "../account-name.js";

export const id = "account";

function reply(h, res, result) {
  const payload = { error: result.error };
  if (result.cooldownUntil) payload.cooldownUntil = result.cooldownUntil;
  return h.json(res, result.status || 400, payload);
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/account/, "") || "/";
  if (req.method === "GET" && (p === "" || p === "/")) {
    return h.json(res, 200, Account.publicAccount());
  }
  if (req.method === "POST" && p === "/username") {
    const saved = await Account.saveAccountUsername(body?.username || body?.displayName, { requireLicence: false });
    if (!saved.ok) return reply(h, res, saved);
    return h.json(res, 200, { ok: true, username: saved.username, cooldownUntil: saved.cooldownUntil || 0 });
  }
  return false;
}
