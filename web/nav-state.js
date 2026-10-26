// Navigation state, form draft preservation, Back button history, and Business Profile draft state (Slice A5).
// Behind flag_navstate (on by default in 0.4.19).

export const DEFAULT_FLAG_NAVSTATE = true;

export function isNavStateEnabled(state) {
  const s = state || (typeof window !== "undefined" ? window.CC?.state : null);
  if (typeof s?.settings?.flag_navstate === "boolean") return s.settings.flag_navstate;
  if (typeof s?.flags?.flag_navstate === "boolean") return s.flags.flag_navstate;
  try {
    if (typeof localStorage !== "undefined" && localStorage) {
      const raw = String(localStorage.getItem("cc.flag_navstate") || "").trim().toLowerCase();
      if (raw === "1" || raw === "true" || raw === "on") return true;
      if (raw === "0" || raw === "false" || raw === "off") return false;
    }
  } catch { /* ignore storage errors */ }
  return DEFAULT_FLAG_NAVSTATE;
}

export function fieldKeyOf(el) {
  if (!el || typeof el !== "object") return null;
  const tag = String(el.tagName || "").toUpperCase();
  if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") return null;
  const type = String(el.type || "").toLowerCase();
  if (type === "password" || type === "file" || type === "submit" || type === "button" || type === "reset") return null;
  if (el.id) return `id:${el.id}`;
  const ds = el.dataset || {};
  if (ds.f) {
    const rowId = el.closest?.("[data-id]")?.dataset?.id || "";
    return `f:${rowId}:${ds.f}`;
  }
  if (ds.k) return `k:${ds.k}`;
  if (ds.allow) return `allow:${ds.allow}`;
  if (ds.tool) return `tool:${ds.tool}`;
  if (ds.pauseTask) return `pause:${ds.pauseTask}`;
  if (ds.rule) return `rule:${ds.rule}`;
  if (ds.cap) return `cap:${ds.cap}`;
  if (el.name) return `name:${el.name}`;
  return null;
}

function queryControls(rootEl) {
  if (!rootEl) return [];
  if (typeof rootEl.querySelectorAll === "function") {
    return [...rootEl.querySelectorAll("input, textarea, select")];
  }
  if (Array.isArray(rootEl.controls)) return rootEl.controls;
  return [];
}

export function createDraftStore(storage = null) {
  const map = new Map();
  const key = "cc.navDrafts";
  const resolveStorage = () => {
    if (storage) return storage;
    try { return typeof sessionStorage !== "undefined" ? sessionStorage : null; } catch { return null; }
  };
  const syncIn = () => {
    const st = resolveStorage();
    if (!st) return;
    try {
      const raw = st.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        for (const [k, v] of Object.entries(parsed)) {
          if (!map.has(k)) map.set(k, v);
        }
      }
    } catch { /* ignore */ }
  };
  const syncOut = () => {
    const st = resolveStorage();
    if (!st) return;
    try {
      st.setItem(key, JSON.stringify(Object.fromEntries(map.entries())));
    } catch { /* ignore */ }
  };
  return {
    get(viewId) {
      syncIn();
      return map.get(String(viewId || "")) || null;
    },
    set(viewId, snap) {
      if (!viewId) return null;
      map.set(String(viewId), snap);
      syncOut();
      return snap;
    },
    delete(viewId) {
      map.delete(String(viewId || ""));
      syncOut();
    },
    clear() {
      map.clear();
      const st = resolveStorage();
      try { st?.removeItem(key); } catch { /* ignore */ }
    },
  };
}

export const defaultDraftStore = createDraftStore();

export function captureViewDraft(viewId, rootEl, store = defaultDraftStore) {
  if (!viewId || !rootEl) return null;
  const fields = {};
  for (const el of queryControls(rootEl)) {
    const k = fieldKeyOf(el);
    if (!k) continue;
    const type = String(el.type || "").toLowerCase();
    if (type === "checkbox" || type === "radio") {
      fields[k] = { type, checked: !!el.checked };
    } else {
      fields[k] = { type: type || String(el.tagName || "").toLowerCase(), value: String(el.value ?? "") };
    }
  }
  const snap = {
    view: String(viewId),
    at: Date.now(),
    scrollTop: Number(rootEl.scrollTop || 0),
    fields,
  };
  store?.set(viewId, snap);
  return snap;
}

export function restoreViewDraft(viewId, rootEl, store = defaultDraftStore) {
  if (!viewId || !rootEl) return { restored: 0, snapshot: null };
  const snap = store?.get(viewId);
  if (!snap || !snap.fields) return { restored: 0, snapshot: null };
  let restored = 0;
  for (const el of queryControls(rootEl)) {
    const k = fieldKeyOf(el);
    if (!k || !(k in snap.fields)) continue;
    const saved = snap.fields[k];
    const type = String(el.type || "").toLowerCase();
    if (type === "checkbox" || type === "radio") {
      if (typeof saved.checked === "boolean" && el.checked !== saved.checked) {
        el.checked = saved.checked;
        restored += 1;
      }
    } else if (typeof saved.value === "string" && el.value !== saved.value) {
      el.value = saved.value;
      restored += 1;
    }
  }
  if (typeof snap.scrollTop === "number" && snap.scrollTop > 0) {
    try { rootEl.scrollTop = snap.scrollTop; } catch { /* ignore */ }
  }
  return { restored, snapshot: snap };
}

export function createNavHistory({ maxEntries = 40, historyApi = null } = {}) {
  const stack = [];
  let suppressPush = false;
  let lastNonHelpView = "command";

  const normalizeEntry = (entry = {}) => ({
    view: String(entry.view || "command"),
    openProject: entry.openProject || null,
    settingsMore: !!entry.settingsMore,
    navFocus: String(entry.navFocus || ""),
    cmdMode: String(entry.cmdMode || ""),
  });

  const sameEntry = (a, b) => a && b
    && a.view === b.view
    && (a.openProject || null) === (b.openProject || null)
    && !!a.settingsMore === !!b.settingsMore;

  return {
    record(entry) {
      const next = normalizeEntry(entry);
      const top = stack[stack.length - 1];
      if (top && top.view !== "help" && top.view !== "setup") {
        lastNonHelpView = top.view;
      }
      if (next.view !== "help" && next.view !== "setup") {
        lastNonHelpView = next.view;
      }
      if (sameEntry(top, next)) {
        stack[stack.length - 1] = next;
        return next;
      }
      stack.push(next);
      if (stack.length > maxEntries) stack.shift();
      if (!suppressPush && historyApi && typeof historyApi.pushState === "function") {
        try { historyApi.pushState({ ccNav: next, idx: stack.length - 1 }, "", `#${next.view}`); } catch { /* ignore */ }
      }
      return next;
    },
    canGoBack() {
      return stack.length > 1;
    },
    back() {
      if (stack.length <= 1) return null;
      stack.pop();
      const prev = stack[stack.length - 1] || null;
      if (prev && prev.view !== "help" && prev.view !== "setup") {
        lastNonHelpView = prev.view;
      }
      return prev ? { ...prev } : null;
    },
    withPopState(fn) {
      suppressPush = true;
      try { return fn(); } finally { suppressPush = false; }
    },
    current() {
      return stack.length ? { ...stack[stack.length - 1] } : null;
    },
    previousView() {
      for (let i = stack.length - 2; i >= 0; i--) {
        if (stack[i].view && stack[i].view !== "help") return stack[i].view;
      }
      return lastNonHelpView || "command";
    },
    lastContextView() {
      return lastNonHelpView || "command";
    },
    size() {
      return stack.length;
    },
    clear() {
      stack.length = 0;
      lastNonHelpView = "command";
    },
  };
}

// ---- Business Profile / Persona ego screen draft state (web/features/prompts.js) ----
const PROFILE_DRAFT_KEY = "cc.profileDraft";
let memoryProfileDraft = null;

function resolveProfileStorage(storage) {
  if (storage) return storage;
  try { return typeof sessionStorage !== "undefined" ? sessionStorage : null; } catch { return null; }
}

export function saveProfileDraft(draft, storage = null) {
  if (!draft || typeof draft !== "object") return null;
  const clean = {};
  for (const [k, v] of Object.entries(draft)) {
    if (k === "updatedAt" || k === "hasDraft") continue;
    clean[k] = typeof v === "boolean" ? v : String(v ?? "");
  }
  clean.updatedAt = Date.now();
  memoryProfileDraft = clean;
  const st = resolveProfileStorage(storage);
  try { st?.setItem(PROFILE_DRAFT_KEY, JSON.stringify(clean)); } catch { /* ignore */ }
  return clean;
}

export function loadProfileDraft(storage = null) {
  const st = resolveProfileStorage(storage);
  if (st) {
    try {
      const raw = st.getItem(PROFILE_DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          memoryProfileDraft = parsed;
          return parsed;
        }
      }
    } catch { /* ignore */ }
  }
  return memoryProfileDraft ? { ...memoryProfileDraft } : null;
}

export function clearProfileDraft(storage = null) {
  memoryProfileDraft = null;
  const st = resolveProfileStorage(storage);
  try { st?.removeItem(PROFILE_DRAFT_KEY); } catch { /* ignore */ }
}

export function mergeProfileWithDraft(savedProfile = {}, draft = null) {
  const base = savedProfile && typeof savedProfile === "object" ? savedProfile : {};
  if (!draft || typeof draft !== "object") return { ...base, hasDraft: false };
  const merged = { ...base };
  for (const [k, v] of Object.entries(draft)) {
    if (k === "updatedAt" || k === "hasDraft") continue;
    if (v !== undefined) merged[k] = v;
  }
  merged.hasDraft = true;
  return merged;
}

export function allAppsAllowed(rows) {
  return Array.isArray(rows) && rows.length > 0 && rows.every((app) => !!app.allowed);
}

export function toggleAllAppsLabel(rows) {
  return allAppsAllowed(rows) ? "Deselect All" : "Select All";
}
