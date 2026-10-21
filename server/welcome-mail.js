// Standard welcome email. Off until a provider is configured. The Supabase service
// key is not read here. A test process (CC_INSTANCE starting with test-) never sends.
// The HTTP config route does not accept an API key; the key stays in the vault as welcome-mail.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./paths.js";
import { doc, putDoc } from "./store.js";
import { getSecret } from "./vault.js";

export const VAULT_ID = "welcome-mail";
export const CONFIG_DOC = "welcome.mail";
export const SENT_DOC = "welcome.sent";
export const DEFAULT_INSTALL = "https://everbornproductions.com/command-center/";
export const DEFAULTS = {
  provider: "none",
  from: "Meldmind <hello@everbornproductions.com>",
  installUrl: DEFAULT_INSTALL,
};

const providers = new Map();
let welcomeFetch = globalThis.fetch;

export function registerMailProvider(name, fn) {
  if (!name || typeof fn !== "function") throw new Error("provider needs a name and a function");
  providers.set(String(name), fn);
}

export function setWelcomeFetch(fn) { welcomeFetch = typeof fn === "function" ? fn : globalThis.fetch; }

export function liveMailAllowed(instance = process.env.CC_INSTANCE) {
  return !String(instance || "").startsWith("test-");
}

export function safeInstallUrl(raw) {
  const s = String(raw || "").trim();
  try {
    const u = new URL(s);
    if (u.protocol !== "https:") return DEFAULT_INSTALL;
    if (u.username || u.password) return DEFAULT_INSTALL;
    return u.toString();
  } catch { return DEFAULT_INSTALL; }
}

export function cleanEmail(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s || s.length > 200 || /[\r\n]/.test(s)) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return "";
  return s;
}

export function firstNameOf({ firstName, name, email } = {}) {
  const explicit = String(firstName || name || "").replace(/[\r\n]/g, " ").replace(/\s+/g, " ").trim();
  const local = String(email || "").split("@")[0].replace(/[._+-]+/g, " ").replace(/\s+/g, " ").trim();
  const pick = (explicit || local).slice(0, 80).trim();
  return pick || "there";
}

function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

let templates = null;
function readTemplates() {
  if (templates) return templates;
  templates = {
    html: fs.readFileSync(path.join(ROOT, "emails", "welcome.html"), "utf8"),
    text: fs.readFileSync(path.join(ROOT, "emails", "welcome.txt"), "utf8"),
  };
  return templates;
}

export function renderWelcome({ firstName = "there", installUrl = DEFAULT_INSTALL } = {}) {
  const name = firstNameOf({ firstName });
  const url = safeInstallUrl(installUrl);
  const files = readTemplates();
  const fill = (src, n, u) => src.replaceAll("{{FIRST_NAME}}", n).replaceAll("{{INSTALL_URL}}", u);
  return {
    subject: "Welcome to Meldmind",
    html: fill(files.html, escHtml(name), escHtml(url)),
    text: fill(files.text, name, url),
    toName: name,
  };
}

export function nextSent(map, email, source, result, now = Date.now()) {
  const prev = map && typeof map === "object" ? map : {};
  if (!result?.sent || !email) return { map: prev, recorded: false };
  if (prev[email]) return { map: prev, recorded: false, reason: "already" };
  return { map: { ...prev, [email]: { at: now, source: source || "license" } }, recorded: true };
}

function blankConfig() { return { ...DEFAULTS }; }
export function mailConfig() {
  const d = doc(CONFIG_DOC, blankConfig);
  return { ...DEFAULTS, ...(d && typeof d === "object" ? d : {}) };
}
function sentMap() {
  const d = doc(SENT_DOC, () => ({}));
  return d && typeof d === "object" ? { ...d } : {};
}

export function publicWelcome() {
  const cfg = mailConfig();
  const key = getSecret(VAULT_ID);
  return {
    provider: cfg.provider || "none",
    from: cfg.from,
    installUrl: safeInstallUrl(cfg.installUrl),
    enabled: cfg.provider && cfg.provider !== "none",
    keySaved: !!key?.key,
  };
}

const bad = (message) => Object.assign(new Error(message), { status: 400 });

export function saveMailConfig(body = {}) {
  if (!body || typeof body !== "object") throw bad("Say which provider to use.");
  for (const k of Object.keys(body)) {
    if (!/key|token|secret|service.?role/i.test(k)) continue;
    if (body[k] != null && String(body[k]).trim()) throw bad("The mail key stays in the vault. This form does not take a key.");
  }
  const prev = mailConfig();
  const next = { ...prev };
  if (body.provider !== undefined) {
    const name = String(body.provider || "").trim() || "none";
    if (name !== "none" && !providers.has(name)) throw bad("That mail provider is not available.");
    next.provider = name;
  }
  if (body.from !== undefined) {
    const from = String(body.from || "").trim();
    if (!from || from.length > 200 || /[\r\n]/.test(from) || !/@/.test(from)) throw bad("From needs an email address.");
    next.from = from;
  }
  if (body.installUrl !== undefined) next.installUrl = safeInstallUrl(body.installUrl);
  putDoc(CONFIG_DOC, { provider: next.provider, from: next.from, installUrl: next.installUrl });
  return publicWelcome();
}

export async function sendResend(message, { key, fetchImpl, from } = {}) {
  if (!key) return { sent: false, reason: "no-key" };
  if (typeof fetchImpl !== "function") return { sent: false, reason: "no-key" };
  const r = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: from || message.from || DEFAULTS.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });
  if (!r || r.ok === false) return { sent: false, reason: "provider" };
  return { sent: true, reason: "sent" };
}

registerMailProvider("resend", sendResend);

// Pure of the network decision. `fetchImpl` is used only when a provider is on and this is not a test.
export async function deliverWelcome(message, { provider = "none", key = "", fetchImpl, instance, from } = {}) {
  const name = provider || "none";
  if (name === "none") return { sent: false, reason: "disabled" };
  if (!liveMailAllowed(instance)) return { sent: false, reason: "test" };
  const fn = providers.get(name);
  if (!fn) return { sent: false, reason: "disabled" };
  if (!key) return { sent: false, reason: "no-key" };
  return fn(message, { key, fetchImpl, from });
}

export async function queueWelcome({ email, firstName, name, source } = {}) {
  const to = cleanEmail(email);
  if (!to) return { sent: false, reason: "no-email" };
  const prev = sentMap();
  if (prev[to]) return { sent: false, reason: "already", source: prev[to].source || null };
  const cfg = mailConfig();
  const who = firstNameOf({ firstName, name, email: to });
  const rendered = renderWelcome({ firstName: who, installUrl: cfg.installUrl });
  const message = { ...rendered, to, from: cfg.from };
  const secret = getSecret(VAULT_ID);
  const result = await deliverWelcome(message, {
    provider: cfg.provider,
    key: secret?.key || "",
    fetchImpl: welcomeFetch,
    instance: process.env.CC_INSTANCE,
    from: cfg.from,
  });
  const kept = nextSent(prev, to, source, result);
  if (kept.recorded) putDoc(SENT_DOC, kept.map);
  return { sent: !!result.sent, reason: result.reason, source: source || null };
}
