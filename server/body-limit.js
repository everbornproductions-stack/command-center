// The most one request body may hold. Files travel as base64 text inside JSON, which is a third bigger than the
// file itself, so the plain-words limit for one file is about three quarters of the body limit.
export const BODY_LIMIT_CHARS = 18e6;
export const FILE_LIMIT_MB = Math.floor((BODY_LIMIT_CHARS * 0.75) / 1e6);
export const BODY_TOO_BIG_LINE = `That is too large to send at once. The biggest file you can send is about ${FILE_LIMIT_MB} MB. Try a smaller file.`;
