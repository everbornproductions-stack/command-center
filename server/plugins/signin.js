// One-click Sign in with Google and Sign in with Microsoft (0.4.17).
//   GET    /api/signin                 status for both, and whether one-click is set up yet
//   POST   /api/signin/google          { step: "first" | "inbox" }
//   POST   /api/signin/microsoft       { step: "first" | "inbox" }
//   DELETE /api/signin/microsoft       remove the Microsoft tokens from the vault
// Start opens a one-shot listener on 127.0.0.1 (server/oauth-signin.js), opens the sign-in page
// in the person's normal browser, and returns. When the browser comes back, the code is
// exchanged, the tokens go to the vault, the listener closes, and a signin.done event goes out.
// The person's own sign-in app (Advanced) keeps its routes under /api/browser/google and
// /api/services/mail. Nothing here sends, posts, or reads mail on its own.
import * as G from "../google.js";
import * as MS from "../microsoft.js";
import { mailStart, mailFinish, mailView } from "../services.js";
import { openLoopback, COMING_SOON } from "../oauth-signin.js";
import { assertServiceSlots } from "../service-limit.js";
import { openUrl } from "../discover.js";
import { unlockByEmail } from "../license.js";

export const id = "signin";

const open = new Map(); // provider -> loopback handle

function status() {
  const g = G.view();
  const m = MS.view();
  let outlook = {};
  try { outlook = mailView()?.outlook || {}; } catch { outlook = {}; }
  return {
    google: {
      ready: !!g.oneClick?.ready,
      connected: !!g.connected,
      needsSignIn: !!g.needsSignIn,
      via: g.via || null,
      scopes: g.scopes || [],
      first: g.oneClick?.first || [],
      inbox: { granted: !!g.oneClick?.inboxGranted, scopes: g.oneClick?.inbox || [] },
      waiting: open.has("google"),
      comingSoon: COMING_SOON.google,
    },
    microsoft: {
      ready: !!m.oneClick?.ready,
      connected: !!m.connected,
      needsSignIn: !!m.needsSignIn,
      scopes: m.scopes || [],
      first: m.oneClick?.first || [],
      inbox: { granted: !!outlook.connected && outlook.via === "everborn", scopes: [{ id: "read", label: "read Outlook mail" }] },
      waiting: open.has("microsoft"),
      comingSoon: COMING_SOON.microsoft,
    },
  };
}

const fail = (status, msg, extra = {}) => Object.assign(new Error(msg), { status, ...extra });

async function begin(provider, step, h) {
  if (h.HOSTED) throw fail(400, "One-click sign-in runs in the desktop app. In the hosted hub, use your own sign-in app under Advanced.");
  const st = status()[provider];
  if (!st.ready) throw fail(400, COMING_SOON[provider], { code: "coming_soon" });
  const inbox = step === "inbox";
  // Free has one connected service. Check before the browser opens, not after. Google's first
  // sign-in covers three services (Calendar, Gmail sending, Drive). When they do not all fit,
  // it asks only for the ones that still fit, Calendar first, and says so.
  let keys = provider === "google" ? (inbox ? G.ONE_CLICK.inbox : G.ONE_CLICK.first) : [];
  let note = "";
  if (provider === "google" && !inbox) {
    const SLOT = { calendar: "calendar", send: "gmail", driveFile: "drive" };
    try { await assertServiceSlots(keys.map((k) => SLOT[k])); }
    catch (e) {
      const fit = [];
      for (const k of ["calendar", "send", "driveFile"]) {
        try { await assertServiceSlots([...fit, k].map((x) => SLOT[x])); fit.push(k); } catch { /* does not fit on this plan */ }
      }
      if (!fit.length) throw e;
      keys = fit;
      note = `Your plan includes ${fit.length === 1 ? "one connected service" : `${fit.length} more connected services`}, so this sign-in asks only for ${fit.map((k) => G.SCOPE_LABEL[k]).join(" and ")}. Pro includes all of them.`;
    }
  } else {
    await assertServiceSlots(provider === "google" ? ["gmail"] : ["outlook"]);
  }
  await open.get(provider)?.close();
  open.delete(provider);
  let flow;
  if (provider === "google") {
    const want = Object.fromEntries(keys.map((k) => [k, true]));
    flow = {
      host: "127.0.0.1",
      begin: (redirectUri) => G.start({ want, redirectUri, keep: true, via: "everborn" }),
      finish: ({ code, state }) => G.finish({ code, state }),
    };
  } else if (inbox) {
    flow = {
      host: "localhost",
      begin: (redirectUri) => mailStart("outlook", { redirectUri, via: "everborn" }),
      finish: ({ code, state }) => mailFinish({ code, state }),
    };
  } else {
    flow = {
      host: "localhost",
      begin: (redirectUri) => MS.start({ redirectUri }),
      finish: ({ code, state }) => MS.finish({ code, state }),
    };
  }
  const run = await openLoopback({
    ...flow,
    onDone: ({ ok, result }) => {
      open.delete(provider);
      const error = ok ? null : String(result?.error || "Sign-in did not finish");
      h.emit("signin.done", { provider, step: inbox ? "inbox" : "first", ok, error: error === "timeout" ? "The sign-in page was not finished in time. Try again." : error });
      if (ok) h.emit("log", { text: `${provider === "google" ? "Google" : "Microsoft"} sign-in finished. The token is in the vault.` });
      // A paid licence on this verified email unlocks now, with no key to type.
      if (ok && !inbox) unlockByEmail().catch(() => {}).finally(() => h.emit("license.changed", {}));
    },
  });
  open.set(provider, run.handle);
  let opened = false;
  if (process.env.CC_SIGNIN_OPEN !== "off") {
    try { openUrl(run.url); opened = true; } catch { opened = false; }
  }
  return { url: run.url, opened, waiting: true, step: inbox ? "inbox" : "first", note };
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/signin/, "") || "/";
  const m = req.method;
  try {
    if (m === "GET" && p === "/") return h.json(res, 200, status());
    const prov = p === "/google" ? "google" : p === "/microsoft" ? "microsoft" : null;
    if (prov && m === "POST") {
      const step = body?.step === "inbox" ? "inbox" : "first";
      return h.json(res, 200, { ...(await begin(prov, step, h)), status: status() });
    }
    if (m === "POST" && (p === "/google/cancel" || p === "/microsoft/cancel")) {
      const which = p.startsWith("/google") ? "google" : "microsoft";
      await open.get(which)?.close();
      open.delete(which);
      return h.json(res, 200, status());
    }
    if (m === "DELETE" && p === "/microsoft") { await MS.disconnect(); return h.json(res, 200, status()); }
    if (m === "DELETE" && p === "/google") { await G.disconnect(); return h.json(res, 200, status()); }
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code });
  }
  return false;
}
