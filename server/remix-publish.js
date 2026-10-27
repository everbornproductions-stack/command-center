// 0.4.21: Remix publish for real, after the person presses Publish and has added their own token.
//   Vercel: one deployment through Vercel's API, files sent inline. Needs a Vercel token.
//   itch.io: checks the token and finds the person's game page through itch.io's API, then pushes with
//           itch's own program (butler) using the token. The page has to exist on itch.io first.
//   Phone stores: not built yet. The button says "Coming soon" and the server refuses.
// Every network call goes through an injectable fetch, and the program run through an injectable
// runner, so tests use mocks. Tokens are never logged, never returned, and never put in a URL.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export const VERCEL_API = "https://api.vercel.com";
export const ITCH_API = "https://itch.io";
export const PHONE_SOON = "Phone app stores are coming soon. Nothing can be published to them yet. Pick This computer, A website or itch.io.";
const MAX_FILES = 300;
const MAX_BYTES = 25 * 1024 * 1024;
const SKIP = /^(node_modules|\.git|test-results|playwright-report|\.env.*|\.DS_Store|TESTRUN\.json|access-report\.json|CREDITS\.md)$/;

const baseOf = (envName, dflt, env) => String(env[envName] || dflt).replace(/\/+$/, "");
const fail = (code, error) => ({ ok: false, sent: false, code, error });

// Real posting stays off in the test suite unless a test points the call at its own stand-in address.
export function liveApiAllowed(envName, env = process.env) {
  if (env[envName]) return true;
  return env.CC_NET_TRACE !== "1" && env.CI !== "true" && env.CI !== "1";
}

export function collectFiles(folder) {
  const out = [];
  let bytes = 0;
  const walk = (dir, rel) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.test(ent.name)) continue;
      const abs = path.join(dir, ent.name);
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) { walk(abs, r); continue; }
      if (!ent.isFile()) continue;
      const buf = fs.readFileSync(abs);
      bytes += buf.length;
      if (out.length >= MAX_FILES || bytes > MAX_BYTES) { const e = new Error("too_big"); e.code = "too_big"; throw e; }
      out.push({ file: r, data: buf.toString("base64"), encoding: "base64" });
    }
  };
  walk(folder, "");
  return out;
}

const slug = (s) => String(s || "remix").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 52) || "remix";

export async function publishVercel({ token, folder, name, fetchImpl = globalThis.fetch, env = process.env } = {}) {
  if (!token) return fail("token", "Add your Vercel token first. It is stored with your keys.");
  let files;
  try {
    if (!folder || !fs.existsSync(path.join(folder, "index.html"))) return fail("files", "Build the project first, then publish it. There is no index.html to send yet.");
    files = collectFiles(folder);
  } catch (e) {
    return fail(e.code === "too_big" ? "too_big" : "files", e.code === "too_big" ? "This project is too big to send in one go (over 25 MB or 300 files)." : "The project files could not be read.");
  }
  let r, j = null;
  try {
    r = await fetchImpl(`${baseOf("CC_VERCEL_API_URL", VERCEL_API, env)}/v13/deployments?skipAutoDetectionConfirmation=1`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: slug(name), files, target: "production", projectSettings: { framework: null } }),
      signal: AbortSignal.timeout(60000),
    });
    j = await r.json().catch(() => null);
  } catch { return fail("network", "Could not reach Vercel. Check your internet and try again. Nothing was published."); }
  if (r.status === 401 || r.status === 403) return fail("token", "Vercel did not accept that token. Make a new one at vercel.com/account/tokens and paste it here.");
  if (!r.ok || !j?.url) return fail("vercel", `Vercel said no${j?.error?.message ? `: ${String(j.error.message).slice(0, 160)}` : ` (HTTP ${r.status})`}. Nothing was published.`);
  const url = /^https?:/.test(j.url) ? j.url : `https://${j.url}`;
  return { ok: true, sent: true, target: "vercel", url, id: j.id || "", message: `Published. Your site is at ${url}` };
}

function runButler(args, { token, spawnImpl = spawn } = {}) {
  return new Promise((resolve) => {
    let tail = "", child;
    try { child = spawnImpl("butler", args, { env: { ...process.env, BUTLER_API_KEY: token }, stdio: ["ignore", "pipe", "pipe"] }); }
    catch { resolve({ code: -1, missing: true, tail: "" }); return; }
    child.stdout?.on("data", (d) => { tail = (tail + d).slice(-400); });
    child.stderr?.on("data", (d) => { tail = (tail + d).slice(-400); });
    child.on("error", (e) => resolve({ code: -1, missing: e?.code === "ENOENT", tail }));
    child.on("close", (code) => resolve({ code, missing: false, tail }));
  });
}

export async function publishItch({ token, folder, name, fetchImpl = globalThis.fetch, run = runButler, env = process.env } = {}) {
  if (!token) return fail("token", "Add your itch.io key first. It is stored with your keys.");
  if (!folder || !fs.existsSync(path.join(folder, "index.html"))) return fail("files", "Build the project first, then publish it. There is no index.html to send yet.");
  const base = baseOf("CC_ITCH_API_URL", ITCH_API, env);
  const get = async (p) => {
    try {
      const r = await fetchImpl(`${base}/api/1/x/${p}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
      return { status: r.status, json: await r.json().catch(() => null) };
    } catch { return { status: 0, json: null }; }
  };
  const me = await get("me");
  if (me.status === 0) return fail("network", "Could not reach itch.io. Check your internet and try again. Nothing was published.");
  const user = me.json?.user?.username;
  if (me.status === 401 || me.status === 403 || !user) return fail("token", "itch.io did not accept that key. Make one at itch.io/user/settings/api-keys and paste it here.");
  const mine = await get("my-games");
  const want = slug(name);
  const games = Array.isArray(mine.json?.games) ? mine.json.games : [];
  const game = games.find((g) => String(g.url || "").replace(/\/+$/, "").split("/").pop() === want) || games.find((g) => slug(g.title) === want);
  if (!game) return fail("no_page", `Make a page for it on itch.io first: go to itch.io/game/new, name it "${name || want}", save it as a draft, then press Publish again.`);
  const gslug = String(game.url).replace(/\/+$/, "").split("/").pop();
  const result = await run(["push", folder, `${user}/${gslug}:html5`], { token });
  if (result.missing) return fail("butler", "itch.io's upload program (butler) is not on this computer. Install it from itch.io/docs/butler, then press Publish again.");
  if (result.code !== 0) return fail("butler", `The upload did not finish${result.tail ? `: ${String(result.tail).replace(/\s+/g, " ").trim().slice(-160)}` : ""}. Nothing was published.`);
  return { ok: true, sent: true, target: "itch", url: game.url, message: `Uploaded. Open your page to check it and set it to public: ${game.url}` };
}
