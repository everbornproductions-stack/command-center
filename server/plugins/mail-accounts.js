// HTTP for server/mail-accounts.js. The setup wizard calls these routes.
// GET    /api/mail-accounts                 listAccounts (optional ?provider=google|gmail|outlook)
// POST   /api/mail-accounts                 addAccount { provider, label }
// DELETE /api/mail-accounts/:id             removeAccount
// POST   /api/mail-accounts/:id/default     setDefaultAccount
// POST   /api/mail-accounts/:id/label       setAccountLabel { label }
// Tokens are not accepted or returned here. Connect with the existing Google or mail sign-in,
// passing accountId, after addAccount.
import { listAccounts, addAccount, removeAccount, setDefaultAccount, setAccountLabel } from "../mail-accounts.js";

export const id = "mail-accounts";

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/mail-accounts/, "") || "/";
  const seg = p.split("/").filter(Boolean);
  const m = req.method;
  try {
    if (m === "GET" && !seg.length) {
      const provider = url.searchParams.get("provider") || undefined;
      return h.json(res, 200, { accounts: listAccounts(provider) });
    }
    if (m === "POST" && !seg.length) {
      const account = addAccount({ provider: body?.provider, label: body?.label });
      return h.json(res, 200, { account, accounts: listAccounts(account.provider) });
    }
    if (m === "DELETE" && seg.length === 1) return h.json(res, 200, { accounts: await removeAccount(seg[0]) });
    if (m === "POST" && seg.length === 2 && seg[1] === "default") return h.json(res, 200, { accounts: setDefaultAccount(seg[0]) });
    if (m === "POST" && seg.length === 2 && seg[1] === "label") {
      const account = setAccountLabel(seg[0], body?.label);
      return h.json(res, 200, { account, accounts: listAccounts(account.provider) });
    }
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code });
  }
  return false;
}
