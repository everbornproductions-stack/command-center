// "Save to Drive": local mode writes the deliverable (and any media files) into a folder you choose,
// typically your Google Drive desktop-synced folder, so it syncs without OAuth. Hosted mode: TODO
// (Google Drive API with OAuth consent; tracked in docs/roadmap.md).
import fs from "node:fs";
import path from "node:path";
export const id = "drive";
export const name = "Drive folder";

export function ready(prefs, hosted) { return !hosted && !!prefs?.driveFolder && fs.existsSync(prefs.driveFolder); }

export function preview({ title, text, files }, prefs) {
  const problems = [];
  if (!prefs?.driveFolder) problems.push("Choose a Drive-synced folder in Settings → Publishing");
  else if (!fs.existsSync(prefs.driveFolder)) problems.push(`Folder not found: ${prefs.driveFolder}`);
  return { channel: id, summary: `Save "${title}" as Markdown${files?.length ? ` + ${files.length} file${files.length === 1 ? "" : "s"}` : ""} into ${prefs?.driveFolder || "(no folder)"}`, problems };
}

export async function post({ title, text, files, projectId }, prefs) {
  const safe = (s) => String(s || "untitled").replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "untitled";
  const dir = path.join(prefs.driveFolder, "Everborn Command", projectId ? safe(projectId) : "unfiled");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const f = path.join(dir, `${stamp} ${safe(title)}.md`);
  fs.writeFileSync(f, `# ${title}\n\n${text || ""}\n`);
  const copied = [];
  for (const src of files || []) { try { if (fs.existsSync(src)) { const dst = path.join(dir, path.basename(src)); fs.copyFileSync(src, dst); copied.push(dst); } } catch {} }
  return { id: f, url: f, copied };
}
