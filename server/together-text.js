// Shared text cleanup for Together. Keys and secrets never go into a room, a recipe, or the newsfeed.
const SECRET = /\b(?:sk-(?:ant-|or-|proj-)?[A-Za-z0-9_\-]{8,}|AIza[0-9A-Za-z\-_]{10,}|AQ\.[A-Za-z0-9_\-]{8,}|xai-[A-Za-z0-9_\-]{8,}|gsk_[A-Za-z0-9_\-]{8,}|sb_secret_[A-Za-z0-9_\-]+|Bearer\s+[A-Za-z0-9._\-]{12,})\b/g;

export function redact(text, max = 2000) {
  return String(text ?? "").replace(SECRET, "[hidden]").replace(/\u2014/g, ", ").slice(0, max);
}

export const bad = (status, message, code) => Object.assign(new Error(message), { status, code });
