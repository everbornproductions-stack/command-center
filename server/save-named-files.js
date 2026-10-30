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
import { bodyForFile, looksLikeCode } from "./code-files.js";
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

// ---- 0.4.28 (dogfood tip-split) ----
// tipsplit.test.js was saved twice: the writing step's 3478-byte test file, then 18 bytes ("All tests passed.") from the
// answer of the step that ran the tests, and the 18-byte copy landed in the asked folder. A run, check or verify step
// replaces the code a writing step made for that file only with a corrected full file (see fullReplacement), and a
// block with no code in it never replaces anything.
const CHECK_TITLE = /^\s*(?:run|re-?run|verify|check|double-check|test|confirm|validate|review|execute|qa)\b/i;
/** A step that runs, checks or verifies files instead of writing them. */
export function isCheckStep(t) {
  return !!t && (t.run === true || CHECK_TITLE.test(String(t.title || "")));
}
// Lead decision (0.4.28): "Run tests and fix any failures" is meant to fix the code, so a check step's corrected FULL
// file wins. It may replace the writer's version only when it is real code for the file type (checked before it is
// written) and at least 60 percent of the writer's length, so a snippet or an output line never replaces the file.
export const FULL_FILE_SHARE = 0.6;
/** May a check step's version (nextLen bytes) replace the writer's version (prevLen bytes)? */
export function fullReplacement(nextLen, prevLen) {
  const p = Number(prevLen) || 0, n = Number(nextLen) || 0;
  return !p || n >= FULL_FILE_SHARE * p;
}
/** The last good write of `name`: writing steps in order, and a check step's write only when it is a full file. */
export function lastGoodWrite(name, wrote = [], tasks = []) {
  const byId = new Map((tasks || []).filter(Boolean).map((t) => [t.id, t]));
  const hits = (wrote || []).filter((w) => w?.path && same(w.name || w.path, name));
  let best = null;
  for (const w of hits) {
    if (!best || !isCheckStep(byId.get(w.taskId)) || fullReplacement(w.bytes, best.bytes)) best = w;
  }
  return best;
}
// The answers to look in for one file (newest first): a check step's answer stays only when its block for the file is
// real code and a full file (60 percent of the writing steps' version or more); otherwise the writers' code is used.
function textsFor(want, texts, tasks) {
  const byId = new Map((tasks || []).filter(Boolean).map((t) => [t.id, t]));
  const checks = new Set(texts.filter((x) => isCheckStep(byId.get(x.from))).map((x) => x.from));
  if (!checks.size) return texts;
  const writers = texts.filter((x) => !checks.has(x.from));
  const w = bodyForFile(want, writers);
  if (!w || !looksLikeCode(w.body, fileExt(want))) return texts;
  return texts.filter((x) => {
    if (!checks.has(x.from)) return true;
    const b = bodyForFile(want, [x]);
    return !!b && looksLikeCode(b.body, fileExt(want)) && fullReplacement(Buffer.byteLength(b.body), Buffer.byteLength(w.body));
  });
}
// The first body for the file that is really code (a source whose block is plain sentences is skipped).
function codeBodyFor(want, texts) {
  let list = texts;
  for (let i = 0; i < 6 && list.length; i++) {
    const b = bodyForFile(want, list);
    if (!b) return null;
    if (looksLikeCode(b.body, fileExt(want))) return b;
    list = list.filter((x) => x.from !== b.from);
  }
  return null;
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
    let hit = lastGoodWrite(want, wrote, tasks);
    // the file on the disk is not the one that step wrote (a later write replaced it): save it again from the answers
    if (hit && Number(hit.bytes) > 0) { const d = onDisk(hit.path); if (d.exists && d.bytes !== Number(hit.bytes) && codeBodyFor(want, textsFor(want, texts, tasks))) hit = null; }
    let r;
    if (hit) {
      r = { ok: true, name: path.basename(hit.name || hit.path), requested: want, path: hit.path, bytes: hit.bytes, ext: fileExt(hit.path), previewable: false, readable: false, projectId: projectId || null, inProjectFolder: true, fromStep: hit.taskId || null };
    } else if (OFFICE_EXT.includes(ext)) {
      // a Word file or a deck is the answer itself; a spreadsheet is the first answer with a table (the final answer first)
      const whole = ext === "docx" || ext === "pptx";
      const src = whole ? (texts[0].text.trim() ? texts[0] : texts[1] || texts[0]) : texts.find((x) => hasTable(x.text)) || texts[0];
      r = whole && truncated && src === texts[0] ? { ok: false, name: want, error: `Not saved: the result was cut off (${truncated}), so ${want} was not written.` } : save({ goal, name: want, text: src.text, projectId, missionId });
    } else {
      const b = codeBodyFor(want, textsFor(want, texts, tasks));
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
