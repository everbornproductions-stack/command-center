// One-click Sign in with Google and Sign in with Microsoft.
//
// Everborn ships its own sign-in apps (OAuth clients), so a person does not have to make one.
// The client ids are public and live in server/oauth-clients.json, with build or run time
// overrides CC_GOOGLE_CLIENT_ID and CC_MS_CLIENT_ID. Google desktop clients also send a client
// secret at token time (Google does not treat it as confidential for installed apps). It is
// never committed: a release build writes it into that file from the GOOGLE_OAUTH_CLIENT_SECRET
// build secret and puts the file back afterwards (scripts/inject-oauth-secret.mjs). Local runs
// read CC_GOOGLE_CLIENT_SECRET. It is never logged or sent to the browser.
// Microsoft is a public client: authority /common, PKCE, redirect http://localhost:<port>.
//
// The flow is the installed-app flow: PKCE (S256) and a loopback redirect. A one-shot listener
// opens on 127.0.0.1 with a random port, the sign-in page opens in the person's normal browser,
// the browser comes back to that listener once, the code is exchanged, and the listener closes.
// It also closes on its own after a few minutes. Tokens go to the vault through the caller.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CLIENTS_FILE = path.join(HERE, "oauth-clients.json");
export const CLIENT_ENV = { google: "CC_GOOGLE_CLIENT_ID", microsoft: "CC_MS_CLIENT_ID" };
export const SECRET_ENV = { google: "CC_GOOGLE_CLIENT_SECRET" };
export const LOOPBACK_MS = 5 * 60 * 1000;

export const COMING_SOON = {
  google: "One-click Sign in with Google is coming soon. For now you can use your own Google sign-in app under Advanced.",
  microsoft: "One-click Sign in with Microsoft is coming soon. For now you can use your own Microsoft sign-in app under Advanced.",
};

export function readClientFile(file = process.env.CC_OAUTH_CLIENTS_FILE || CLIENTS_FILE) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) || {}; } catch { return {}; }
}

// The shipped client for "google" or "microsoft". An env value wins over the file.
export function shippedClient(provider, { env = process.env, file } = {}) {
  const row = readClientFile(file)?.[provider] || {};
  const clientId = String(env[CLIENT_ENV[provider]] || row.clientId || "").trim();
  const secretEnv = SECRET_ENV[provider];
  const clientSecret = secretEnv ? String(env[secretEnv] || row.clientSecret || "").trim() : "";
  const ok = /^[A-Za-z0-9._-]{8,200}$/.test(clientId);
  const secretOk = !secretEnv || (!!clientSecret && clientSecret.length <= 400 && !/\s/.test(clientSecret));
  // Google desktop clients need the secret at token time. Without it, one-click Google is not
  // ready and the button offers the Advanced own-client path. Microsoft needs no secret.
  return { provider, clientId: ok ? clientId : "", clientSecret: ok && secretOk && clientSecret ? clientSecret : null, hasId: ok, ready: ok && secretOk };
}

const b64url = (b) => Buffer.from(b).toString("base64url");

export function pkcePair() {
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge, method: "S256" };
}
export function challengeFor(verifier) {
  return b64url(crypto.createHash("sha256").update(String(verifier)).digest());
}

const live = new Set();
export function activeListeners() { return live.size; }
export async function closeAll() { await Promise.all([...live].map((l) => l.close())); }

function page(ok, text) {
  const title = ok ? "You are signed in" : "Sign-in did not finish";
  const safe = String(text || "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:520px;margin:12vh auto;padding:0 16px;color:#111;background:#fff"><h1 style="font-size:22px">${title}</h1><p>${safe}</p><p>You can close this tab and go back to Meldmind.</p></body>`;
}

// Opens the one-shot listener. `begin(redirectUri)` returns { url, state } from the caller's
// own start function (which keeps the PKCE verifier). `finish({ code, state, error })` runs once
// when the browser comes back. `host` is the name in the redirect: Google wants 127.0.0.1,
// Microsoft registers http://localhost (any port). The socket is always bound to 127.0.0.1.
export function openLoopback({ begin, finish, host = "127.0.0.1", timeoutMs = LOOPBACK_MS, onDone } = {}) {
  if (typeof begin !== "function" || typeof finish !== "function") throw new Error("begin and finish are required");
  return new Promise((resolve, reject) => {
    let closed = false, started = null, timer = null, handled = false;
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url || "/", "http://127.0.0.1");
      if (u.pathname !== "/callback") { res.writeHead(404, { "content-type": "text/plain", connection: "close" }); res.end("Not found"); return; }
      if (handled) { res.writeHead(410, { "content-type": "text/html; charset=utf-8", connection: "close" }); res.end(page(false, "This sign-in already finished.")); return; }
      handled = true;
      const code = u.searchParams.get("code") || "";
      const state = u.searchParams.get("state") || "";
      const error = u.searchParams.get("error") || "";
      let ok = false, text = "", result = null;
      try {
        if (started && state !== started.state) throw Object.assign(new Error("This sign-in link does not match the one Meldmind opened. Start again."), { status: 400 });
        if (error) throw Object.assign(new Error(error === "access_denied" ? "You said no on the sign-in page. Nothing was saved." : `The sign-in page answered: ${String(error).slice(0, 80)}`), { status: 400 });
        result = await finish({ code, state });
        ok = true; text = "Meldmind is connected.";
      } catch (e) { text = e?.message || "Something went wrong."; result = { error: text }; }
      res.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", connection: "close" });
      res.end(page(ok, text));
      try { onDone?.({ ok, result }); } catch { /* the page already answered */ }
      handle.close();
    });
    const handle = {
      server,
      get closed() { return closed; },
      get port() { return server.address()?.port || 0; },
      close() {
        if (closed) return Promise.resolve();
        closed = true;
        clearTimeout(timer);
        live.delete(handle);
        return new Promise((r) => { try { server.closeAllConnections?.(); } catch {} server.close(() => r()); });
      },
    };
    server.on("error", (e) => { if (!started) reject(e); });
    server.listen(0, "127.0.0.1", async () => {
      live.add(handle);
      const port = server.address().port;
      const redirectUri = `http://${host}:${port}/callback`;
      try { started = await begin(redirectUri); }
      catch (e) { await handle.close(); reject(e); return; }
      timer = setTimeout(() => { handle.close(); try { onDone?.({ ok: false, result: { error: "timeout" } }); } catch {} }, timeoutMs);
      timer.unref?.();
      resolve({ ...started, redirectUri, port, handle });
    });
  });
}
