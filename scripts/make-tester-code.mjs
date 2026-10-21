// Owner-only. Makes one single-use promo code locked to one email, stores it
// on the licence server, then prints the code once. Does not apply migrations,
// does not read the local data folder, and does not print the service key.
//
//   CC_DEV_OWNER=1 CC_SUPABASE_URL=https://xxxx.supabase.co \
//   CC_SUPABASE_SERVICE_KEY=... node scripts/make-tester-code.mjs --email ada@example.com
//
// The service key stays in the environment. A publishable key is refused.
// Tier is pro, or studio with --tier studio. Owner is refused.
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_RE = /^TEST-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function assertOwner(env = process.env) {
  if (env.CC_PACKAGED === "1") {
    const err = new Error("This script does not run from a packaged install.");
    err.code = "packaged";
    throw err;
  }
  if (env.CC_DEV_OWNER !== "1") {
    const err = new Error("This script is owner-only. Set CC_DEV_OWNER=1 on an unpackaged owner machine and run it again.");
    err.code = "not_owner";
    throw err;
  }
}

export function serviceKeyFrom(env = process.env) {
  return String(env.CC_SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
}

export function assertServiceKey(key) {
  const k = String(key || "").trim();
  if (!k) {
    const err = new Error("Set CC_SUPABASE_SERVICE_KEY to the service role key. A publishable key cannot make a tester code.");
    err.code = "missing_service_key";
    throw err;
  }
  if (/^sb_publishable_/i.test(k)) {
    const err = new Error("This is a publishable key. Set CC_SUPABASE_SERVICE_KEY to the service role key.");
    err.code = "publishable_key";
    throw err;
  }
  if (/^sb_secret_[A-Za-z0-9_-]{8,}$/.test(k)) return k;
  if (k.startsWith("eyJ")) {
    let payload = {};
    try { payload = JSON.parse(Buffer.from(k.split(".")[1], "base64url").toString("utf8")); }
    catch { payload = {}; }
    if (payload.role === "service_role") return k;
    const err = new Error("This key is not a service role key. A publishable or anon key cannot make a tester code.");
    err.code = "not_service_role";
    throw err;
  }
  const err = new Error("CC_SUPABASE_SERVICE_KEY is not a service role key.");
  err.code = "not_service_role";
  throw err;
}

export function assertProjectUrl(url) {
  const raw = String(url || "").trim().replace(/\/$/, "");
  if (!raw) {
    const err = new Error("Set CC_SUPABASE_URL to the project URL. This script does not have one built in.");
    err.code = "missing_url";
    throw err;
  }
  let parsed;
  try { parsed = new URL(raw); }
  catch {
    const err = new Error("CC_SUPABASE_URL must be an http(s) address.");
    err.code = "bad_url";
    throw err;
  }
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (parsed.protocol === "https:" || (parsed.protocol === "http:" && loopback)) return raw;
  const err = new Error("CC_SUPABASE_URL must be https, except on this computer for a test.");
  err.code = "bad_url";
  throw err;
}

export function normalizeEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(e)) {
    const err = new Error("Pass --email with the one address this code is for.");
    err.code = "bad_email";
    throw err;
  }
  return e;
}

export function normalizeTier(tier) {
  const t = String(tier || "pro").trim().toLowerCase();
  if (t !== "pro" && t !== "studio") {
    const err = new Error("Tier must be pro or studio. This script does not make an owner key.");
    err.code = "bad_tier";
    throw err;
  }
  return t;
}

export function makeTesterCode(bytes = crypto.randomBytes(8)) {
  let out = "TEST";
  for (let i = 0; i < 8; i++) {
    if (i % 4 === 0) out += "-";
    out += ALPHABET[bytes[i] & 31];
  }
  return out;
}

export function redact(text, secret) {
  const s = String(text ?? "");
  if (!secret) return s;
  return s.split(secret).join("[redacted]");
}

export function parseArgs(argv) {
  const out = { email: "", tier: "pro" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--email") out.email = argv[++i] || "";
    else if (a.startsWith("--email=")) out.email = a.slice("--email=".length);
    else if (a === "--tier") out.tier = argv[++i] || "";
    else if (a.startsWith("--tier=")) out.tier = a.slice("--tier=".length);
    else if (a === "--help" || a === "-h") out.help = true;
    else throw Object.assign(new Error("Unknown argument. Use --email and, if you need it, --tier pro or --tier studio."), { code: "bad_args" });
  }
  return out;
}

export async function storeTesterCode({ url, serviceKey, email, code, tier, fetchImpl = fetch }) {
  const endpoint = `${url}/rest/v1/rpc/create_tester_code`;
  const r = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ p_email: email, p_code: code, p_tier: tier }),
  });
  const text = await r.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch { j = null; }
  if (!r.ok) {
    const msg = j?.message || j?.error || text || `HTTP ${r.status}`;
    const err = new Error(redact(msg, serviceKey));
    err.code = /schema cache|could not find the function|PGRST202/i.test(String(msg)) ? "migration_missing" : "store_failed";
    if (err.code === "migration_missing") err.message = "The licence server does not have create_tester_code yet. Apply the per-person migration first. No code was stored.";
    throw err;
  }
  const stored = typeof j === "string" ? j : "";
  if (!CODE_RE.test(stored)) {
    const err = new Error("The licence server did not confirm the code. Nothing is printed.");
    err.code = "store_failed";
    throw err;
  }
  return stored;
}

// Stores the code, then calls print once with the code the server kept.
export async function runTesterCode({ env = process.env, argv = [], fetchImpl = fetch, print = () => {} } = {}) {
  assertOwner(env);
  const args = parseArgs(argv);
  if (args.help || !args.email) {
    const err = new Error("Usage: node scripts/make-tester-code.mjs --email person@example.com [--tier pro|studio]");
    err.code = args.help ? "help" : "bad_email";
    throw err;
  }
  const url = assertProjectUrl(env.CC_SUPABASE_URL);
  const serviceKey = assertServiceKey(serviceKeyFrom(env));
  const email = normalizeEmail(args.email);
  const tier = normalizeTier(args.tier);
  const code = makeTesterCode();
  const stored = await storeTesterCode({ url, serviceKey, email, code, tier, fetchImpl });
  print(stored);
  return { code: stored, email, tier };
}

function isDirectRun() {
  const self = fileURLToPath(import.meta.url);
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
  return entry === self;
}

if (isDirectRun()) {
  const lines = [];
  runTesterCode({
    argv: process.argv.slice(2),
    print(code) { lines.push(code); },
  }).then((r) => {
    process.stdout.write(`Tester code for ${r.email} (single use, ${r.tier}):\n${lines[0]}\n`);
  }).catch((e) => {
    const secret = serviceKeyFrom(process.env);
    process.stderr.write(`${redact(e.message || "Could not make a tester code.", secret)}\n`);
    process.exitCode = e.code === "help" ? 0 : 1;
  });
}
