// CC.saveToMindMedia(opts): the one call every flow uses to keep a result (0.4.20).
//   opts = { kind, text | files, projectId, source, status, provenance, name, tags, dedupeKey, parentId, destinations, quiet }
//   kind:   "image" | "video" | "audio" | "text" | "site" | "file"   (optional, guessed from the files)
//   text:   a text result. It becomes a Markdown item.
//   files:  [{ name, data (base64 or data: URL) | text | path (a file already inside a project folder), mime, folder }]
//   projectId: the project, or empty for Unfiled. status: Draft | Review | Approved | Published (default Draft).
//   provenance: { prompt, model, provider, cost }.
// Returns { ok, projectId, where, count, items, savedWhere, link } and shows a "Saved in MindMedia" toast
// with an Open link, unless opts.quiet. Throws with a plain message when the server refuses.
const { api, toast, S } = window.CC;

window.CC.openMindMedia = (projectId, assetId) => {
  S.mmFocus = { projectId: projectId || "unfiled", assetId: assetId || "" };
  window.CC.go("mindmedia");
};

window.CC.saveToMindMedia = async function saveToMindMedia(opts = {}) {
  const { quiet, ...body } = opts;
  if (!body.projectId) body.projectId = S.project || "";
  try {
    const out = await api("/mindmedia/save", { method: "POST", body });
    if (!quiet) {
      const first = out.items?.[0];
      toast(out.savedWhere || "Saved in MindMedia.", false, { label: "Open", onClick: () => window.CC.openMindMedia(out.projectId, first?.id) });
    }
    window.dispatchEvent(new CustomEvent("cc:mindmedia-saved", { detail: out }));
    return out;
  } catch (e) {
    if (!quiet) toast(e.message || "Could not save to MindMedia.", true);
    throw e;
  }
};
