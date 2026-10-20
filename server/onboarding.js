// First-run setup runs once. The completed flag (with a version) lives in the user data
// folder as onboarding.json, next to settings and the vault, so an update that clears
// service workers and HTTP caches cannot bring the setup screen back.
//
// The flag is not the only signal. If the install already has history (a real vault key,
// saved settings, past chats or jobs, or bookmarks), setup stays closed. A later launch
// may, at most once every 24 hours, notice providers, models or keys that were not in
// that history and integrate only those. Bookmark organizing is never part of that check.

export const ONBOARDING_VERSION = 1;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const DOC_KIND = "onboarding";

const REASON_ORDER = ["vault", "jobs", "bookmarks", "settings", "flag"];

export function blankRecord() {
  return {
    version: ONBOARDING_VERSION,
    completed: false,
    completedAt: null,
    reason: null,
    lastDailyCheckAt: null,
    catalogBaselined: false,
    known: { providers: [], models: [], keys: [] },
    notice: null,
  };
}

function ids(v) {
  return Array.isArray(v) ? [...new Set(v.map((x) => String(x || "").trim()).filter(Boolean))] : [];
}

export function normalizeRecord(raw) {
  const base = blankRecord();
  if (!raw || typeof raw !== "object") return base;
  const known = raw.known && typeof raw.known === "object" ? raw.known : {};
  const notice = raw.notice && typeof raw.notice === "object" && raw.notice.text
    ? { text: String(raw.notice.text), at: Number(raw.notice.at) || 0 }
    : null;
  return {
    ...base,
    completed: raw.completed === true,
    completedAt: Number(raw.completedAt) || null,
    reason: raw.reason ? String(raw.reason) : null,
    version: Number(raw.version) || ONBOARDING_VERSION,
    lastDailyCheckAt: Number(raw.lastDailyCheckAt) || null,
    catalogBaselined: raw.catalogBaselined === true,
    known: { providers: ids(known.providers), models: ids(known.models), keys: ids(known.keys) },
    notice,
  };
}

// Saved settings means the person changed something, or the app stored a choice
// (demo, cloud, a budget that is not the factory number). The factory defaults
// written on a brand-new launch do not count. `onboarded` is the legacy flag.
// `uiMode` is the Simple / Expert choice. It must not count as history, or the
// first-run question would close setup before the person finishes it.
const SAVED_IGNORE = new Set(["onboarded", "uiMode", "uiModeChosen"]);

export function settingsSaved(settings, defaults) {
  if (!settings || typeof settings !== "object") return false;
  for (const [k, v] of Object.entries(settings)) {
    if (SAVED_IGNORE.has(k)) continue;
    if (!Object.prototype.hasOwnProperty.call(defaults, k) || defaults[k] !== v) return true;
  }
  return false;
}

export function realKeyIds(ids) {
  return (ids || []).map((id) => String(id || "")).filter((id) => id && !id.startsWith("demo-"));
}

// Ordered, de-duplicated reasons. Any one of them means setup is already done.
export function historyReasons({ vaultKeyIds = [], settings = null, defaults = {}, ledgerCount = 0, missionCount = 0, bookmarkCount = 0 } = {}) {
  const found = new Set();
  if (realKeyIds(vaultKeyIds).length) found.add("vault");
  if ((Number(ledgerCount) || 0) > 0 || (Number(missionCount) || 0) > 0) found.add("jobs");
  if ((Number(bookmarkCount) || 0) > 0) found.add("bookmarks");
  if (settings && typeof settings === "object") {
    if (settingsSaved(settings, defaults)) found.add("settings");
    if (settings.onboarded === true) found.add("flag");
  }
  return REASON_ORDER.filter((r) => found.has(r));
}

// `show` is the only thing the hub uses to decide whether to open setup.
// A completed flag of any version wins, and so does any history, even when the
// flag was never written (an install from before this file existed).
export function planOnboarding({ record, history = [], now = Date.now(), version = ONBOARDING_VERSION } = {}) {
  const rec = normalizeRecord(record);
  const hist = Array.isArray(history) ? history.filter(Boolean) : [];
  const done = rec.completed || hist.length > 0;
  const reason = rec.completed ? (rec.reason || hist[0] || "flag") : (hist[0] || null);
  let next = rec;
  let changed = false;
  if (done && !rec.completed) {
    next = { ...rec, completed: true, completedAt: now, version, reason };
    changed = true;
  } else if (done && rec.version !== version) {
    next = { ...rec, version, reason: rec.reason || reason };
    changed = true;
  }
  return { show: !done, reason: done ? (next.reason || reason) : null, record: next, changed };
}

export function completeRecord(record, now = Date.now(), version = ONBOARDING_VERSION) {
  const rec = normalizeRecord(record);
  if (rec.completed) return { ...rec, version, completedAt: rec.completedAt || now, reason: rec.reason || "user" };
  return { ...rec, completed: true, completedAt: now, version, reason: "user" };
}

export function shouldOpenSetup({ mode, show, legacyOnboarded }) {
  if (mode === "hosted") return false;
  if (show === true) return true;
  if (show === false) return false;
  return !legacyOnboarded;
}

// "New: Groq added" / "New: Groq, Gemini 3.8 Flash added" / "New: A, B, C and 2 more added"
export function noticeText(names) {
  const list = (names || []).map((n) => String(n || "").trim()).filter(Boolean);
  if (!list.length) return null;
  const shown = list.slice(0, 3);
  const extra = list.length - shown.length;
  const body = extra > 0 ? `${shown.join(", ")} and ${extra} more` : shown.join(", ");
  return `New: ${body} added`;
}

function sets(known) {
  return { providers: [...known.providers], models: [...known.models], keys: [...known.keys] };
}

// Compare the current provider / model / key-id catalog with the remembered history.
// The first run only records what is already there (nothing is "new" yet). Later runs,
// at most once per 24h, add only the ids that were not remembered and name those.
// Key material is never an input: `keyIds` are provider ids.
export function applyDailyCheck({ record, catalog = [], keyIds = [], now = Date.now(), dayMs = DAY_MS } = {}) {
  const rec = normalizeRecord(record);
  if (!rec.completed) return { record: rec, ran: false, throttled: false, skipped: true, notice: null, added: [] };
  if (rec.lastDailyCheckAt && now - rec.lastDailyCheckAt < dayMs) {
    return { record: rec, ran: false, throttled: true, skipped: false, notice: null, added: [] };
  }
  const known = {
    providers: new Set(rec.known.providers),
    models: new Set(rec.known.models),
    keys: new Set(rec.known.keys),
  };
  const keys = realKeyIds(keyIds);
  if (!rec.catalogBaselined) {
    for (const p of catalog) {
      if (!p?.id) continue;
      known.providers.add(p.id);
      for (const m of p.models || []) if (m?.id) known.models.add(m.id);
    }
    for (const id of keys) known.keys.add(id);
    return {
      record: { ...rec, catalogBaselined: true, lastDailyCheckAt: now, known: sets(known), notice: null },
      ran: true, throttled: false, skipped: false, notice: null, added: [],
    };
  }
  const added = [];
  for (const p of catalog) {
    if (!p?.id) continue;
    if (!known.providers.has(p.id)) {
      known.providers.add(p.id);
      for (const m of p.models || []) if (m?.id) known.models.add(m.id);
      added.push(p.name || p.id);
    } else {
      for (const m of p.models || []) {
        if (!m?.id || known.models.has(m.id)) continue;
        known.models.add(m.id);
        added.push(m.name || m.id);
      }
    }
  }
  for (const id of keys) {
    if (known.keys.has(id)) continue;
    known.keys.add(id);
    const p = catalog.find((x) => x.id === id);
    const name = p?.name || id;
    if (!added.includes(name)) added.push(`${name} key`);
  }
  const notice = noticeText(added);
  return {
    record: { ...rec, catalogBaselined: true, lastDailyCheckAt: now, known: sets(known), notice: notice ? { text: notice, at: now } : null },
    ran: true, throttled: false, skipped: false, notice, added,
  };
}

export function publicOnboarding(plan) {
  const rec = plan?.record || blankRecord();
  return {
    show: !!plan?.show,
    completed: rec.completed === true,
    version: rec.version || ONBOARDING_VERSION,
    reason: plan?.show ? null : (rec.reason || plan?.reason || null),
    notice: rec.notice?.text || null,
    noticeAt: rec.notice?.at || null,
    lastDailyCheckAt: rec.lastDailyCheckAt || null,
  };
}
