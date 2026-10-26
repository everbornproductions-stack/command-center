// Email for alerts and the weekly report (0.4.21 item 9).
// Three ways to send, and the person picks one:
//   resend   the person's OWN Resend key, from an address their Resend account may use (the "From" field)
//   gmail    through the Gmail the person connected (needs the send permission)
//   outlook  through the Outlook the person connected (needs the send permission)
// It never sends from Everborn's domain with someone else's key. With no From saved, the sender is the first
// verified domain in the person's own Resend account; if there is none, Resend's own test sender (which Resend
// only lets send to the account owner's address). Nothing here prints a key. The network, the keys and the
// Gmail/Outlook senders are all injected, so tests never reach a real service.
export const VIA = ["resend", "gmail", "outlook"];
export const RESEND_URL = "https://api.resend.com";
export const RESEND_TEST_SENDER = "Meldmind <onboarding@resend.dev>";
const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const EVERBORN_DOMAIN = /@(?:[a-z0-9-]+\.)*everbornproductions\.com\b/i;

// The one plain setup line shown where the feature lives, per way of sending.
export const SETUP = {
  resend: "Add your Resend key below, then type the From address your Resend account has verified (for example alerts@yourdomain.com).",
  gmail: "Connect Gmail in Settings and tick send email. Meldmind then sends from your own Gmail.",
  outlook: "Sign in with Microsoft in Settings and allow send email. Meldmind then sends from your own Outlook.",
  none: "Pick how to send: add a Resend key and a From address, or connect Gmail or Outlook.",
};

export const cleanFrom = (v) => String(v || "").trim().slice(0, 200);
export function checkFrom(v) {
  const from = cleanFrom(v);
  if (!from) return "";
  if (/[\r\n]/.test(from) || !EMAIL.test(from.replace(/^.*<([^>]+)>\s*$/, "$1"))) throw Object.assign(new Error("From needs one plain email address, like alerts@yourdomain.com."), { status: 400 });
  return from;
}
// A From on Everborn's domain only works with Everborn's own Resend account. A user's key must never be pointed at it.
export const isEverbornFrom = (from) => EVERBORN_DOMAIN.test(String(from || ""));

// What can send right now. `avail` comes from the server: { resendKey, gmail, outlook } booleans.
export function options(avail = {}) {
  return VIA.map((id) => ({
    id,
    ready: id === "resend" ? !!avail.resendKey : !!avail[id],
    label: id === "resend" ? "Your Resend account" : id === "gmail" ? "Your Gmail" : "Your Outlook",
    setup: SETUP[id],
  }));
}
// The chosen way if it works, else the first one that does (resend, gmail, outlook), else null.
export function pickVia(prefs = {}, avail = {}) {
  const opts = options(avail);
  const want = opts.find((o) => o.id === prefs.via);
  if (want?.ready) return want.id;
  if (!prefs.via || prefs.via === "auto") return opts.find((o) => o.ready)?.id || null;
  return null;
}
export function setupLine(prefs = {}, avail = {}) {
  const via = prefs.via && prefs.via !== "auto" ? prefs.via : (options(avail).find((o) => o.ready)?.id || "none");
  const opt = options(avail).find((o) => o.id === via);
  if (opt && !opt.ready) return SETUP[via];
  if (via === "resend" && !cleanFrom(prefs.from)) return "Resend is ready. Type the From address your Resend account has verified, or Meldmind uses your first verified domain.";
  return opt ? "" : SETUP.none;
}

// Which From a Resend send uses: the person's saved one, else their own first verified domain, else Resend's test sender.
export async function resolveFrom({ key, from, fetchImpl } = {}) {
  const own = cleanFrom(from);
  if (own) {
    if (isEverbornFrom(own)) throw Object.assign(new Error("That From address belongs to Everborn, so your own Resend key cannot send from it. Type an address on a domain you verified in your Resend account."), { status: 400, code: "from" });
    return { from: own, source: "saved" };
  }
  if (key && typeof fetchImpl === "function") {
    try {
      const r = await fetchImpl(`${RESEND_URL}/domains`, { headers: { authorization: `Bearer ${key}` } });
      if (r?.ok) {
        const j = await r.json();
        const d = (j.data || []).find((x) => x && x.status === "verified" && x.name && !isEverbornFrom(`a@${x.name}`));
        if (d) return { from: `Meldmind <alerts@${d.name}>`, source: "domain" };
      }
    } catch { /* fall through to the test sender */ }
  }
  return { from: RESEND_TEST_SENDER, source: "test" };
}

async function viaResend({ to, subject, text }, { key, from, fetchImpl }) {
  if (!key) throw Object.assign(new Error(SETUP.resend), { status: 400, code: "setup" });
  if (typeof fetchImpl !== "function") throw Object.assign(new Error("Sending is not available here."), { status: 400 });
  const f = await resolveFrom({ key, from, fetchImpl });
  const r = await fetchImpl(`${RESEND_URL}/emails`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ from: f.from, to, subject, text }) });
  if (!r?.ok) {
    let why = "";
    try { why = String((await r.json())?.message || "").slice(0, 160); } catch { /* no body */ }
    const hint = r?.status === 403 || r?.status === 422 ? " Check that the From address is on a domain verified in your Resend account." : r?.status === 401 ? " Resend refused the key." : "";
    throw Object.assign(new Error(`Resend said no (${r?.status || "no answer"}).${why ? ` ${why}` : ""}${hint}`), { status: 502, code: "resend", from: f.from });
  }
  return { sent: true, via: "resend", from: f.from, fromSource: f.source };
}

// deps: { getKey(): string, fetchImpl, gmailSend(mail), outlookSend(mail), avail }
export async function sendMail({ to, subject, text }, prefs = {}, deps = {}) {
  const addr = String(to || "").trim();
  if (!EMAIL.test(addr)) throw Object.assign(new Error("Type the address to send to first."), { status: 400 });
  const via = pickVia(prefs, deps.avail || {});
  if (!via) throw Object.assign(new Error(setupLine(prefs, deps.avail || {}) || SETUP.none), { status: 400, code: "setup" });
  if (via === "resend") return viaResend({ to: addr, subject, text }, { key: deps.getKey?.() || "", from: prefs.from, fetchImpl: deps.fetchImpl });
  const send = via === "gmail" ? deps.gmailSend : deps.outlookSend;
  if (typeof send !== "function") throw Object.assign(new Error(SETUP[via]), { status: 400, code: "setup" });
  const r = await send({ to: addr, subject, body: text });
  return { sent: true, via, from: r?.from || null, fromSource: via };
}
