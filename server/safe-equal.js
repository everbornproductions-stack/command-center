// 0.4.22 (Aikido): one timing-safe compare for tokens and secrets. Different lengths or non-strings are
// simply "not equal"; it never throws.
import crypto from "node:crypto";

export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
