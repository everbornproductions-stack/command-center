// Phase 60. A send or a buy asks first. When a phone is paired, the phone can give
// that yes. When it is not, the yes stays on this PC. The phone payload is the action
// and the amount only. No key, no prompt, no password.

import crypto from "node:crypto";
import { doc, putDoc } from "./store.js";

const DOC = "phone.approvals";

function load() {
  const saved = doc(DOC, () => ({ items: [] }));
  return { items: Array.isArray(saved?.items) ? saved.items : [] };
}
function save(next) {
  putDoc(DOC, next);
  return next;
}

export function phoneReady() {
  const p = doc("settings", () => ({}))?.phonePair;
  return !!(p && p.on === true && /^[a-f0-9]{64}$/.test(String(p.token || "")));
}

function cleanAction(value) {
  return String(value || "")
    .replace(/\b(sk-[A-Za-z0-9_\-]{6,}|sk-ant-[A-Za-z0-9_\-]{6,}|AIza[0-9A-Za-z\-_]{8,}|xai-[A-Za-z0-9_\-]{6,}|gsk_[A-Za-z0-9_\-]{6,})\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

function cleanAmount(amount) {
  if (amount == null || amount === "") return null;
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0 || n > 1000000) {
    const err = new Error("The amount has to be a plain number.");
    err.status = 400;
    throw err;
  }
  const digits = String(amount).replace(/\D/g, "");
  if (digits.length >= 12) {
    const err = new Error("An approval cannot carry a card or account number.");
    err.status = 400;
    throw err;
  }
  return +n.toFixed(2);
}

export function ask({ kind = "send", action, amount = null } = {}) {
  const state = load();
  const item = {
    id: `ap-${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`,
    kind: kind === "buy" ? "buy" : kind === "delete" ? "delete" : "send",
    action: cleanAction(action) || "Send",
    amount: cleanAmount(amount),
    status: "pending",
    via: phoneReady() ? "phone" : "pc",
    createdAt: Date.now(),
  };
  state.items.unshift(item);
  state.items = state.items.slice(0, 100);
  save(state);
  return publicItem(item);
}

export function find(id) {
  return load().items.find((item) => item.id === id) || null;
}

export function decide(id, yes, from = "pc") {
  const state = load();
  const item = state.items.find((row) => row.id === id);
  if (!item) {
    const err = new Error("That approval is not waiting.");
    err.status = 404;
    throw err;
  }
  if (item.status !== "pending") return publicItem(item);
  const where = from === "phone" ? "phone" : "pc";
  if (item.via === "phone" && where === "phone" && !phoneReady()) {
    const err = new Error("Phone pairing is off. Approve it on this PC.");
    err.status = 409;
    throw err;
  }
  item.status = yes ? "approved" : "declined";
  item.decidedBy = where;
  item.decidedAt = Date.now();
  save(state);
  return publicItem(item);
}

export function requireApproval(id) {
  const item = find(id);
  if (!item || item.status !== "approved") {
    const err = new Error("Approve this before it is sent. Declining sends nothing.");
    err.status = 409;
    err.code = "approval_required";
    err.approvalId = item?.id || null;
    throw err;
  }
  return publicItem(item);
}

// Phone paired: wait for a yes on the phone, or a yes on this PC.
// Phone not paired: return null and let the caller's own confirm stand.
export function holdOutbound({ kind, action, amount, approvalId, confirmed }) {
  if (!phoneReady()) return null;
  let item = approvalId ? find(approvalId) : null;
  if (!item) item = ask({ kind, action, amount });
  if (confirmed && item.status === "pending") item = decide(item.id, true, "pc");
  if (item.status !== "approved") {
    const err = new Error("Approve this on your phone before it goes out. Declining sends nothing.");
    err.status = 409;
    err.code = "approval_required";
    err.approvalId = item.id;
    throw err;
  }
  return item;
}

export function pushPayload(id) {
  const item = find(id);
  if (!item) return null;
  return { action: item.action, amount: item.amount };
}

function publicItem(item) {
  return {
    id: item.id,
    kind: item.kind,
    action: item.action,
    amount: item.amount,
    status: item.status,
    via: item.via,
    createdAt: item.createdAt,
  };
}

export function publicState() {
  const items = load().items.map(publicItem);
  return {
    phone: phoneReady(),
    pending: items.filter((item) => item.status === "pending"),
    recent: items.slice(0, 20),
    note: phoneReady()
      ? "A send or a buy can be approved on the paired phone. Declining sends nothing."
      : "No phone is paired. The approval stays on this PC. Phone pairing stays off until you turn it on.",
  };
}
