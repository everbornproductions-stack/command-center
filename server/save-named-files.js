// Every named file a mission was asked for is saved at the end (0.4.27, dogfood batch 2).
// Before, only the first name in the goal was saved, and only from the assembled answer: "Save both files as
// invoice_totals.py and invoices.csv" ended with "Not saved: there was no code for invoice_totals.py in this
// answer" because the assembler dropped the code that the step had written. Now each name is looked for in the
// final answer and in every finished step (newest first). The rules stay: a file is reported saved only when it is
// on the disk, a file is never overwritten (saveNamedFile picks name-2), and the caller copies every saved file to
// the folder the person asked for (server/asked-folder.js).
import fs from "node:fs";
import path from "node:path";
import { saveNamedFile } from "./named-file.js";
import { bodyForFile } from "./code-files.js";
import { fileExt, onDisk, OFFICE_EXT } from "./step-guard.js";

const PROSE_EXT = new Set(["md", "txt", "html", "htm"]);
// Word, Excel and PowerPoint files are only made when the office writer is part of this build
export function officeSupported() {
  try { return fs.existsSync(new URL("./office-files.js", import.meta.url)); } catch { return false; }
}
const same = (a, b) => path.basename(String(a || "")).toLowerCase() === path.basename(String(b || "")).toLowerCase();
const hasTable = (t) => /^\s*\|.*\|\s*\n\s*\|?\s*:?-{3,}/m.test(String(t || ""));
// one fenced block named for the file, so saveNamedFile writes exactly this body
export function fenced(name, body) {
  const runs = String(body || "").match(/^\s*`{3,}/gm) || [];
  const n = Math.max(3, ...runs.map((r) => r.trim().length + 1));
  const f = "`".repeat(n);
  return `${f}${fileExt(name)} ${name}\n${String(body).replace(/\n+$/, "")}\n${f}\n`;
}

/**
 * Save each name. tasks: the mission's steps ({ id, output, status, media, writes, notSaved }). wrote: files the
 * steps already wrote ({ name, path, bytes, taskId }). Returns one result per name that can be saved here:
 * { ok, name, requested, path, bytes, ... } or { ok: false, name, error }. save is injectable for tests.
 */
export function saveEveryNamedFile({ goal = "", names = [], deliverable = "", tasks = [], wrote = [], projectId = "", missionId = "", truncated = "", save = saveNamedFile, office = officeSupported() } = {}) {
  const steps = (tasks || []).filter((t) => t && !t.media && t.status !== "failed" && typeof t.output === "string" && t.output.trim()).reverse();
  const texts = [{ text: String(deliverable || ""), from: "answer" }, ...steps.map((t) => ({ text: t.output, from: t.id }))];
  const out = [];
  for (const want of names) {
    const ext = fileExt(want);
    if (OFFICE_EXT.includes(ext) && !office) continue;
    const hit = (wrote || []).find((w) => w?.path && same(w.name || w.path, want));
    let r;
    if (hit) {
      r = { ok: true, name: path.basename(hit.name || hit.path), requested: want, path: hit.path, bytes: hit.bytes, ext: fileExt(hit.path), previewable: false, readable: false, projectId: projectId || null, inProjectFolder: true, fromStep: hit.taskId || null };
    } else if (OFFICE_EXT.includes(ext)) {
      // a Word file or a deck is the answer itself; a spreadsheet is the first answer with a table (the final answer first)
      const whole = ext === "docx" || ext === "pptx";
      const src = whole ? (texts[0].text.trim() ? texts[0] : texts[1] || texts[0]) : texts.find((x) => hasTable(x.text)) || texts[0];
      r = whole && truncated && src === texts[0] ? { ok: false, name: want, error: `Not saved: the result was cut off (${truncated}), so ${want} was not written.` } : save({ goal, name: want, text: src.text, projectId, missionId });
    } else {
      const b = bodyForFile(want, texts);
      if (b) r = save({ goal, name: want, text: fenced(want, b.body), projectId, missionId });
      else if (PROSE_EXT.has(ext)) r = truncated ? { ok: false, name: want, error: `Not saved: the result was cut off (${truncated}), so ${want} was not written.` } : save({ goal, name: want, text: String(deliverable || ""), projectId, missionId });
      else {
        const step = (tasks || []).find((t) => t?.notSaved && (t.notSaved.files || []).some((n) => same(n, want)));
        r = { ok: false, name: want, error: step?.notSaved?.line || `Not saved: there was no ${ext === "csv" ? "data" : "code"} for ${want} in this answer.` };
      }
      if (r && b) r.from = b.from;
    }
    if (!r) r = { ok: false, name: want, error: `Not saved: ${want} is not a safe file name.` };
    if (r.ok && r.path && !onDisk(r.path).exists) r = { ok: false, name: r.name, error: `Not saved: ${r.name} is not on the disk.` };
    out.push(r);
  }
  return out;
}
