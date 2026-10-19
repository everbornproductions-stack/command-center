// Chat with files (Phase 6): drop PDFs, Word files, text and images into a project and ask about them.
//
//  - Each project gets its own knowledge library ("Project files: <name>", server/libraries.js), made on the
//    first drop and attached to that project's chats, so Single, Council and Mission runs in the project get
//    the best passages, cited as [L1], [L2]. The chunks live in that library's index file, per project.
//  - Documents go through the library's extractor (text, Markdown, CSV, JSON, code, HTML, Word, text PDFs).
//  - Images are saved to the project's files folder and described once by an AI that can see images (OpenAI,
//    Anthropic or Google Gemini with the person's key; the pretend AI in demo mode). The description is what
//    gets chunked, so any model can answer questions about the picture later.
//  - Two clicks, like libraries: "stage" reads and estimates (free), "add" describes and indexes (spends;
//    the click repeats the estimate it saw). Every call is in the ledger; spend caps apply.
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths.js";
import { HOSTED, doc, putDoc } from "./store.js";
import { PROVIDERS, estimateCostAt } from "./registry.js";
import { rank } from "./router.js";
import { complete } from "./providers.js";
import { recordCall } from "./ledger.js";
import { listProjects } from "./projects.js";
import { demoActive } from "./mock.js";
import * as L from "./libraries.js";
import * as X from "./library-extract.js";

const MAP = "projectfiles.map"; // { [projectId]: libraryId }
export const IMAGE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024, MAX_FILES = 50;
const VISION = new Set(["openai", "anthropic", "google"]); // every current chat model of these reads images
const DESCRIBE_IN = 1600, DESCRIBE_OUT = 350; // tokens per image, for the estimate
export const DESCRIBE_SYSTEM = "You describe an image so it can be searched and asked about later. Write plain text, no preamble: what the image shows, every piece of text in it word for word, numbers, colours, layout and anything a person might ask about. At most 250 words.";

const bad = (msg, status = 400, extra = {}) => Object.assign(new Error(msg), { status, ...extra });
const isImage = (name) => !!IMAGE_TYPES[path.extname(String(name || "")).toLowerCase()];
const safeName = (name) => String(name || "file").replace(/\\/g, "/").split("/").pop().replace(/[^\w.() -]/g, "_").slice(0, 120) || "file";

function need(projectId) {
  if (HOSTED) throw bad("Chat with files lives in the desktop app for now (the files and their index stay on your PC).", 501, { code: "hosted" });
  if (!L.available()) throw bad("Chat with files needs a newer runtime (node:sqlite). Update Command AI.", 501);
  const p = listProjects().find((x) => x.id === String(projectId || ""));
  if (!p) throw bad("Pick a project first: files are kept per project.", 404);
  return p;
}
export const filesDir = (projectId) => path.join(DATA_DIR, "projects", String(projectId).replace(/[^a-z0-9-_]/gi, "_"), "files");
const mapDoc = () => doc(MAP, () => ({}));
const libOf = (projectId) => { const id = mapDoc()[projectId]; return id && L.getLibrary(id) ? id : null; };

// the AI that describes images: the cheapest one that can see, with a key, under its cap
export function describer() {
  const ok = (m) => VISION.has(m.provider) || (PROVIDERS[m.provider]?.demo && demoActive());
  return rank({ capability: "writing", difficulty: 1, mode: "economy", small: true }).find(ok) || null;
}
// the embedder for a new project library: the demo one in demo mode, else the cheapest keyed one under its cap
function embedderFor() {
  const list = L.embedderChoices().filter((e) => e.keyed && !e.capped && !e.custom);
  const demo = list.find((e) => e.demo);
  if (demo) return demo;
  return list.filter((e) => !e.demo).sort((a, b) => a.per1M - b.per1M)[0] || null;
}
function ensureLibrary(project) {
  const have = libOf(project.id);
  if (have) return have;
  const e = embedderFor();
  if (!e) throw bad("Chat with files needs an embedding key: OpenAI, Google Gemini or Mistral (Settings > AI keys), or demo mode. Nothing was read or spent.", 400, { code: "no_embedder" });
  const taken = new Set(L.listLibraries().map((l) => l.name.toLowerCase()));
  let name = `Project files: ${project.name}`.slice(0, 74);
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${`Project files: ${project.name}`.slice(0, 70)} (${n})`;
  const lib = L.createLibrary({ name, provider: e.provider, model: e.model });
  L.setAttached({ libraryId: lib.id, scope: "chat", target: project.id, on: true });
  const m = mapDoc(); m[project.id] = lib.id; putDoc(MAP, m);
  return lib.id;
}

// what the project has: its library, the documents in it and the image files
export function overview(projectId) {
  const p = need(projectId);
  const libId = libOf(p.id);
  const lib = libId ? L.view(L.getLibrary(libId)) : null;
  const docs = libId ? L.docsOf(libId) : [];
  const d = describer();
  return {
    projectId: p.id, projectName: p.name, library: lib, attached: !!lib?.attached?.some((a) => a.scope === "chat" && a.target === p.id),
    files: docs.map((x) => ({ id: x.id, title: x.title, image: x.ref.startsWith("image:"), chars: x.chars, chunks: x.chunks, addedAt: x.addedAt })),
    describer: d ? { provider: d.provider, providerName: d.providerName, model: d.model } : null,
    embedder: lib ? lib.embed : (embedderFor() || null),
    limits: { files: MAX_FILES, imageMb: MAX_IMAGE_BYTES / 1048576, fileMb: Math.round(X.MAX_FILE_BYTES / 1048576) },
  };
}

const imageStages = new Map(); // stageId -> { images: [{ name, mime, data }], describer, perImage }
// files: [{ name, text } | { name, data: base64 }]. Reads and estimates; nothing is spent.
export function stage(projectId, files) {
  const p = need(projectId);
  if (!Array.isArray(files) || !files.length) throw bad("Drop at least one file.");
  if (files.length > MAX_FILES) throw bad(`Up to ${MAX_FILES} files at a time.`);
  const libId = ensureLibrary(p);
  const items = [], images = [], skipped = [];
  const d = describer();
  for (const f of files) {
    const name = safeName(f?.name);
    const buf = typeof f?.data === "string" ? Buffer.from(f.data, "base64") : Buffer.from(String(f?.text ?? ""), "utf8");
    if (isImage(name)) {
      if (buf.length > MAX_IMAGE_BYTES) { skipped.push({ title: name, reason: `image over ${MAX_IMAGE_BYTES / 1048576} MB` }); continue; }
      if (!d) { skipped.push({ title: name, reason: "no AI that can see images: add an OpenAI, Anthropic or Google Gemini key, or turn on demo mode" }); continue; }
      images.push({ name, mime: IMAGE_TYPES[path.extname(name).toLowerCase()], data: buf.toString("base64") });
      continue;
    }
    if (!X.supported(name)) { skipped.push({ title: name, reason: "file type not supported (text, Markdown, CSV, JSON, code, HTML, Word .docx, PDF and images are)" }); continue; }
    const r = X.extract(name, buf);
    if (r.skipped) skipped.push({ title: name, reason: r.skipped });
    else items.push({ source: "file", ref: `doc:${name}`, title: name, text: r.text });
  }
  const st = L.stage(libId, items);
  const perImage = d ? +estimateCostAt(d.model, DESCRIBE_IN, DESCRIBE_OUT).toFixed(6) : 0;
  // a described image is about 1,500 characters to embed
  const imageEmbed = images.length * (1500 / 4 / 1e6) * (st.estimate.per1M || 0);
  const usd = +(st.estimate.cost + images.length * perImage + imageEmbed).toFixed(6);
  for (const [k, v] of imageStages) if (Date.now() - v.at > 30 * 60 * 1000) imageStages.delete(k);
  imageStages.set(st.stageId, { at: Date.now(), images, describer: d ? { provider: d.provider, model: d.model, providerName: d.providerName } : null, usd });
  return {
    stageId: st.stageId, libraryId: libId,
    files: st.files.map((x) => ({ title: x.title, chars: x.chars, chunks: x.chunks, replaces: x.replaces })),
    images: images.map((x) => ({ title: x.name, kb: Math.round(Buffer.byteLength(x.data, "base64") / 102.4) / 10 })),
    skipped: [...st.skipped, ...skipped],
    estimate: { usd, embed: st.estimate, images: images.length, perImage, describer: d ? `${d.providerName} ${d.model}` : null, capped: st.estimate.capped, keyed: st.estimate.keyed },
  };
}

// The click that spends: describe the images (one call each, in the ledger), then index everything.
export async function add(projectId, { stageId, estimate: seen } = {}) {
  const p = need(projectId);
  const libId = libOf(p.id);
  const imgs = imageStages.get(String(stageId || ""));
  if (!libId || !imgs) throw bad("That list has expired. Drop the files again.", 410);
  if (seen === undefined || seen === null || seen === "" || !(Number(seen) + 1e-9 >= imgs.usd)) throw bad("Check the cost first: drop the files again to see the estimate.", 409, { code: "estimate_first" });
  imageStages.delete(String(stageId));
  const described = [], failed = [];
  if (imgs.images.length) {
    const dir = filesDir(p.id);
    fs.mkdirSync(dir, { recursive: true });
    for (const im of imgs.images) {
      const t0 = Date.now();
      try {
        const r = await complete({ provider: imgs.describer.provider, model: imgs.describer.model, maxTokens: 600, system: DESCRIBE_SYSTEM, messages: [{ role: "user", content: [{ type: "text", text: `File name: ${im.name}\nDescribe this image.` }, { type: "image", mime: im.mime, data: im.data }] }] });
        recordCall({ provider: imgs.describer.provider, model: imgs.describer.model, usage: r.usage, role: "describe-image", ms: Date.now() - t0 });
        fs.writeFileSync(path.join(dir, im.name), Buffer.from(im.data, "base64"));
        described.push({ source: "file", ref: `image:${im.name}`, title: im.name, text: `Image file ${im.name} (in this project's files).\n\n${r.text.trim()}` });
      } catch (e) { failed.push({ title: im.name, reason: e.message }); }
    }
  }
  let st;
  try { st = described.length ? L.stage(libId, described, { stageId }) : null; } catch (e) { throw bad(`${e.message}${described.length ? " The images were described (in the ledger) but not added." : ""}`, e.status || 500); }
  let job = null;
  try { job = L.index(libId, stageId).job; }
  catch (e) { if (!/Nothing new/.test(e.message)) throw e; L.dropStage(stageId); }
  return { job, described: described.map((x) => x.title), failed, staged: st?.files?.length ?? null, library: L.view(L.getLibrary(libId)) };
}

export function remove(projectId, docId) {
  const p = need(projectId);
  const libId = libOf(p.id);
  if (!libId) throw bad("This project has no files.", 404);
  const d = L.docsOf(libId).find((x) => x.id === Number(docId));
  if (!d) throw bad("No such file in this project.", 404);
  L.removeDoc(libId, d.id);
  if (d.ref.startsWith("image:")) { const f = path.join(filesDir(p.id), safeName(d.ref.slice(6))); try { fs.rmSync(f, { force: true }); } catch {} }
  return overview(p.id);
}

// an image the project keeps (for the thumbnail), only inside its files folder
export function imageFile(projectId, docId) {
  const p = need(projectId);
  const libId = libOf(p.id);
  const d = libId && L.docsOf(libId).find((x) => x.id === Number(docId));
  if (!d || !d.ref.startsWith("image:")) return null;
  const f = path.join(filesDir(p.id), safeName(d.ref.slice(6)));
  return fs.existsSync(f) ? { file: f, mime: IMAGE_TYPES[path.extname(f).toLowerCase()] || "application/octet-stream" } : null;
}
