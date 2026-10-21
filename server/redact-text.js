// Strip secrets and dash characters that must not appear in user-facing text.
// Used by model watch and people chat. Nothing here is sent anywhere.
const SECRET = /(?:sk-(?:ant-|or-|proj-)?[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{10,}|AQ\.[A-Za-z0-9_-]{8,}|xai-[A-Za-z0-9_-]{8,}|gsk_[A-Za-z0-9_-]{8,}|sb_secret_[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9._-]{12,})/gi;

export function hasSecret(text) {
  SECRET.lastIndex = 0;
  return SECRET.test(String(text ?? ""));
}

export function redact(text, max = 2000) {
  SECRET.lastIndex = 0;
  const cleaned = String(text ?? "")
    .replace(SECRET, "[hidden]")
    .replace(/\u2014/g, ", ")
    .replace(/\u2013/g, ", ");
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
}

export const bad = (status, message, code) => Object.assign(new Error(message), { status, code });
