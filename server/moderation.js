// Report and block, stored on this PC. Nothing is emailed or sent to a host.
import crypto from "node:crypto";
import { bad } from "./together-text.js";

const DOC = "together.moderation";

export function readMod(h) {
  const d = h.doc(DOC, () => ({ blocks: [], reports: [] }));
  d.blocks ||= [];
  d.reports ||= [];
  return d;
}

export function blockKeys(h) {
  return new Set(readMod(h).blocks.map((b) => b.key));
}

export function isBlocked(h, key) {
  const k = String(key || "").trim().toLowerCase();
  return !!k && blockKeys(h).has(k);
}

export function blockPerson(h, key) {
  const k = String(key || "").trim().toLowerCase();
  if (!k || k === "you") throw bad(400, "Pick someone else to block.", "block");
  const d = readMod(h);
  if (!d.blocks.some((b) => b.key === k)) d.blocks.push({ key: k, at: Date.now() });
  h.putDoc(DOC, d);
  return { blocked: true, key: k, sent: false };
}

export function unblockPerson(h, key) {
  const k = String(key || "").trim().toLowerCase();
  const d = readMod(h);
  d.blocks = d.blocks.filter((b) => b.key !== k);
  h.putDoc(DOC, d);
  return { blocked: false, key: k };
}

export function fileReport(h, item) {
  const reason = String(item.reason || "").replace(/\s+/g, " ").trim();
  if (!reason) throw bad(400, "Say why you are reporting this.", "reason");
  if (reason.length > 500) throw bad(400, "Keep the report under 500 characters.", "reason");
  const types = ["message", "member", "room", "reply"];
  if (!types.includes(item.targetType)) throw bad(400, "Pick a message, a person, or a room to report.", "target");
  const d = readMod(h);
  const row = {
    id: "rp-" + crypto.randomBytes(6).toString("hex"),
    area: String(item.area || "rooms").slice(0, 40),
    targetType: item.targetType,
    targetId: String(item.targetId || "").slice(0, 120),
    reason: reason.slice(0, 500),
    at: Date.now(),
    sent: false,
  };
  d.reports.push(row);
  if (d.reports.length > 200) d.reports.splice(0, d.reports.length - 200);
  h.putDoc(DOC, d);
  return row;
}
