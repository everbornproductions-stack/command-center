// Shared by the popup and the background worker. Talks only to Meldmind on this computer
// (http://127.0.0.1:<port>), with the pairing code made in the app. Nothing is sent anywhere else.
export const PORTS = Array.from({ length: 10 }, (_, i) => 4747 + i); // the app uses the first free port from 4747 up
const MAX_TEXT = 50000;

export async function settings() {
  const s = await chrome.storage.local.get(["code", "port", "action", "name"]);
  return { code: s.code || "", port: Number(s.port) || 4747, action: s.action || "draft", name: s.name || "" };
}
export const save = (o) => chrome.storage.local.set(o);
export const forget = () => chrome.storage.local.remove(["code", "port", "name"]);

// "cce.<port>.<secret>" as shown in the app; the port is a hint, the secret is the pairing
export function parseCode(raw) {
  const m = String(raw || "").trim().match(/^cce\.(\d{2,5})\.([A-Za-z0-9_-]{30,60})$/);
  if (!m) throw new Error("That is not a Meldmind pairing code. Copy it again from Settings > Browser extension.");
  return { port: Number(m[1]), secret: m[2], code: m[0] };
}

async function call(port, code, path, body) {
  const r = await fetch(`http://127.0.0.1:${port}/api/ext/${path}`, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${code}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status });
  return j;
}

// Finds the app (the saved port first, then 4747 up) and checks the pairing. Saves the port that answered.
export async function ping(code, hint) {
  const tried = [hint, ...PORTS].filter((p, i, a) => p && a.indexOf(p) === i);
  let refused = null;
  for (const port of tried) {
    try { const j = await call(port, code, "ping"); await save({ port, name: j.name || "" }); return { ...j, port }; }
    catch (e) { if (e.status === 401 || e.status === 429) refused = e; }
  }
  throw refused || new Error("Meldmind is not running on this PC (or it was started on an unusual port). Open the app and try again.");
}

export async function send(payload) {
  const s = await settings();
  if (!s.code) throw new Error("Pair the extension first: click its icon and paste the code from Meldmind > Settings > Browser extension.");
  const body = { action: s.action, ...payload, text: String(payload.text || "").slice(0, MAX_TEXT) };
  try { return await call(s.port, s.code, "send", body); }
  catch (e) {
    if (e.status) throw e;
    const p = await ping(s.code, s.port); // the app moved to another port: find it and retry once
    return call(p.port, s.code, "send", body);
  }
}

// runs inside the page (chrome.scripting): title, address, the visible text and the current selection
export function grabPage() {
  const sel = String(getSelection ? getSelection() : "").trim();
  return { title: document.title, url: location.href, text: (document.body ? document.body.innerText : "").slice(0, 50000), selection: sel.slice(0, 50000) };
}
