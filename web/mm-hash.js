// Links into the MindMedia hub (0.4.21, F27). Pure, so a test can call it.
// #mindmedia opens it, #mindmedia/<project>/<item> opens that item, #mindmedia?view=needs-ending opens a saved view.
export function parseMindMediaHash(hash) {
  const m = /^#mindmedia(?:\/([^/?]+)\/([^?]+))?(?:\?view=([\w-]+))?$/.exec(String(hash || ""));
  if (!m) return null;
  const dec = (x) => { try { return decodeURIComponent(x); } catch { return x; } };
  return { projectId: m[1] ? dec(m[1]) : "", assetId: m[2] ? dec(m[2]) : "", view: m[3] || "" };
}
