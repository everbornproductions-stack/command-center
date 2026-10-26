// Unified Project Media library (Slice B3, gated by flag_projectmedia).
// Builds a single index over existing media storage (media.jobs from images.js
// and media-jobs.js, project-files.js, media-modify outputs, and direct uploads
// in projects/<id>/media) without moving or duplicating files on disk.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "./paths.js";
import { doc, putDoc } from "./store.js";
import { listProjects } from "./projects.js";
import { projectmediaOn } from "./flags.js";
import { filesDir } from "./project-files.js";
import { projectMediaDir } from "./media-jobs.js";
import { PROVIDERS } from "./registry.js";

export const safeProjectId = (id) => String(id || "").replace(/[^a-z0-9-_]/gi, "_");

export const FLAG_NAME = "flag_projectmedia";
export const PRESET_TAGS = ["client-ready", "draft", "final", "reference"];
export const USAGE_KINDS = {
  posted: "Posted",
  site: "Placed in site",
  video: "Added to video",
  remix: "Used in Remix",
  finish: "Sent to Finish",
  project: "Linked to project",
};

// One vocabulary for the status chips everywhere (hub, project Media tab, Finish).
export const STATUSES = ["Draft", "Review", "Approved", "Scheduled", "Published"];
export const TRASH_DAYS = 30;
let SHOW_TRASH = false; // listMindMedia flips this while it collects, so trashed items can be listed and restored
export const UNFILED = "unfiled";
const DOC_KEY = "project.media";
const JOBS_KEY = "media.jobs";
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB per file

export function isProjectMediaEnabled(settingsObj = {}) {
  return projectmediaOn(settingsObj);
}

function emptyMediaDoc() {
  return {
    meta: {},        // "<projectId>::<assetId>" -> { tags, collections, parentId, usage, name, prompt, deleted }
    uploads: [],     // [{ id, projectId, name, filePath, mime, sizeBytes, prompt, createdAt }]
    links: [],       // [{ id, sourceProjectId, sourceAssetId, targetProjectId, createdAt }]
    collections: {}, // "<projectId>" -> [{ id, name, createdAt }]
  };
}

function mediaDoc() {
  const d = doc(DOC_KEY, emptyMediaDoc);
  if (!d.meta || typeof d.meta !== "object") d.meta = {};
  if (!Array.isArray(d.uploads)) d.uploads = [];
  if (!Array.isArray(d.links)) d.links = [];
  if (!d.collections || typeof d.collections !== "object") d.collections = {};
  return d;
}

function saveMediaDoc(d) {
  return putDoc(DOC_KEY, d);
}

function jobsDoc() {
  const d = doc(JOBS_KEY, () => ({ items: [] }));
  if (!Array.isArray(d.items)) d.items = [];
  return d;
}

function saveJobsDoc(d) {
  return putDoc(JOBS_KEY, d);
}

function assertProject(projectId) {
  const id = safeProjectId(projectId);
  if (!id) {
    const err = new Error("Project id is required.");
    err.status = 400;
    throw err;
  }
  const found = (listProjects() || []).find((p) => p.id === id);
  return { id, project: found || { id, name: id } };
}

function providerLabel(providerId) {
  if (!providerId) return "";
  return PROVIDERS?.[providerId]?.name || providerId;
}

function inferMime(fileName) {
  const ext = path.extname(String(fileName || "")).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".json") return "application/json";
  if (ext === ".md") return "text/markdown";
  if (ext === ".txt") return "text/plain";
  return "application/octet-stream";
}

function inferKind(mime, jobKind, isUpload = false) {
  const m = String(mime || "").toLowerCase();
  const jk = String(jobKind || "").toLowerCase();
  if (jk === "video" || m.startsWith("video/")) return "video";
  if (jk === "voice" || jk === "audio" || m.startsWith("audio/")) return "audio";
  if (jk === "image" || m.startsWith("image/")) return "image";
  if (isUpload) return "upload";
  return "upload";
}

// True when `candidate` (already resolved) is the same as, or inside, `root` after following links on BOTH sides.
function realInside(candidate, root) {
  try {
    const rc = fs.realpathSync(candidate);
    const rr = fs.realpathSync(root);
    return rc === rr || rc.startsWith(rr + path.sep);
  } catch { return false; }
}

// Refuses symlinks (the file itself or any folder on the way) so a link cannot lead out of the data folder.
function safeStat(filePath) {
  if (!filePath || typeof filePath !== "string") return null;
  try {
    const resolved = path.resolve(DATA_DIR, filePath);
    const root = path.resolve(DATA_DIR);
    if (!resolved.startsWith(root + path.sep) && resolved !== root) return null;
    const lst = fs.lstatSync(resolved);
    if (lst.isSymbolicLink()) return null;
    if (!lst.isFile()) return null;
    if (!realInside(resolved, root)) return null;
    // Every folder between the data folder and the file must be a real folder too.
    const rel = path.relative(root, resolved);
    let cur = root;
    for (const part of rel.split(path.sep).slice(0, -1)) {
      cur = path.join(cur, part);
      if (fs.lstatSync(cur).isSymbolicLink()) return null;
    }
    return { path: resolved, sizeBytes: lst.size, mtimeMs: Math.round(lst.mtimeMs) };
  } catch {
    return null;
  }
}

export function isInsideDataDir(filePath) { return Boolean(safeStat(filePath)); }

function metaKey(projectId, assetId) {
  return `${safeProjectId(projectId)}::${assetId}`;
}

function normalizeTag(t) {
  return String(t || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

function normalizeTags(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const t = normalizeTag(raw);
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

function getAssetMeta(state, projectId, assetId) {
  const k = metaKey(projectId, assetId);
  const m = state.meta[k] || {};
  return {
    tags: normalizeTags(m.tags || []),
    collections: Array.isArray(m.collections) ? [...new Set(m.collections.map((c) => String(c).trim()).filter(Boolean))] : [],
    parentId: m.parentId === "" ? "" : (m.parentId ? String(m.parentId) : null), // "" means unstacked on purpose
    usage: Array.isArray(m.usage) ? m.usage : [],
    name: m.name ? String(m.name) : null,
    prompt: m.prompt != null ? String(m.prompt) : null,
    deleted: Boolean(m.deleted),
    deletedAt: m.deleted && Number(m.deletedAt) ? Number(m.deletedAt) : null,
    status: STATUSES.includes(m.status) ? m.status : null,
    destinations: Array.isArray(m.destinations) ? m.destinations : [],
    kept: Boolean(m.kept),
    publicUrl: typeof m.publicUrl === "string" && /^https:\/\//.test(m.publicUrl) ? m.publicUrl : "",
  };
}

function setAssetMeta(state, projectId, assetId, patch) {
  const k = metaKey(projectId, assetId);
  const cur = getAssetMeta(state, projectId, assetId);
  const next = { ...cur };
  if (patch.tags !== undefined) next.tags = normalizeTags(patch.tags);
  if (Array.isArray(patch.addTags)) next.tags = normalizeTags([...next.tags, ...patch.addTags]);
  if (Array.isArray(patch.removeTags)) {
    const rm = new Set(normalizeTags(patch.removeTags));
    next.tags = next.tags.filter((t) => !rm.has(t));
  }
  if (patch.collections !== undefined) {
    next.collections = [...new Set((patch.collections || []).map((c) => String(c).trim()).filter(Boolean))];
  }
  if (Array.isArray(patch.addCollections)) {
    next.collections = [...new Set([...next.collections, ...patch.addCollections.map((c) => String(c).trim()).filter(Boolean)])];
  }
  if (Array.isArray(patch.removeCollections)) {
    const rm = new Set(patch.removeCollections.map((c) => String(c).trim()));
    next.collections = next.collections.filter((c) => !rm.has(c));
  }
  if (patch.parentId !== undefined) next.parentId = patch.parentId ? String(patch.parentId) : "";
  if (patch.name !== undefined) next.name = patch.name ? String(patch.name).slice(0, 140) : null;
  if (patch.prompt !== undefined) next.prompt = patch.prompt != null ? String(patch.prompt).slice(0, 2000) : null;
  if (patch.deleted !== undefined) {
    next.deleted = Boolean(patch.deleted);
    next.deletedAt = next.deleted ? (cur.deleted && cur.deletedAt ? cur.deletedAt : Date.now()) : null;
  }
  if (Array.isArray(patch.usage)) next.usage = patch.usage;
  if (patch.status !== undefined) {
    const want = STATUSES.find((x) => x.toLowerCase() === String(patch.status || "").toLowerCase());
    if (!want) { const err = new Error(`Status must be one of: ${STATUSES.join(", ")}.`); err.status = 400; throw err; }
    next.status = want;
  }
  if (patch.kept !== undefined) next.kept = Boolean(patch.kept);
  if (patch.publicUrl !== undefined) next.publicUrl = patch.publicUrl ? String(patch.publicUrl).slice(0, 500) : "";
  if (patch.addDestination && typeof patch.addDestination === "object") {
    const d = patch.addDestination;
    next.destinations = [...next.destinations, {
      channel: String(d.channel || "other").slice(0, 32),
      label: String(d.label || d.channel || "Sent").slice(0, 80),
      link: typeof d.link === "string" ? d.link.slice(0, 500) : "",
      status: ["posted", "dry-run", "failed", "saved"].includes(d.status) ? d.status : "saved",
      at: Number(d.at) || Date.now(),
    }].slice(-30);
  }
  if (patch.addUsage && typeof patch.addUsage === "object") {
    const u = {
      kind: String(patch.addUsage.kind || "used").slice(0, 32),
      label: String(patch.addUsage.label || USAGE_KINDS[patch.addUsage.kind] || patch.addUsage.kind || "Used").slice(0, 80),
      targetId: patch.addUsage.targetId ? String(patch.addUsage.targetId).slice(0, 120) : null,
      at: patch.addUsage.at || Date.now(),
    };
    const exists = next.usage.some((x) => x.kind === u.kind && x.targetId === u.targetId && x.label === u.label);
    if (!exists) next.usage = [...next.usage, u];
  }
  state.meta[k] = next;
  return next;
}

function buildFileUrl(projectId, assetId) {
  return `/projectmedia/file?projectId=${encodeURIComponent(projectId)}&assetId=${encodeURIComponent(assetId)}`;
}

// Collect native assets belonging directly to projectId (excluding cross-project links).
function collectNativeAssets(projectId, state, allJobs) {
  const pid = safeProjectId(projectId);
  if (!pid) return [];
  const items = [];
  const trackedPaths = new Set();
  // A file another project or an upload record already owns is never picked up again by the folder scan
  // (a result moved out of Unfiled stays in its old folder on disk).
  for (const u of state.uploads) if (typeof u.filePath === "string" && u.filePath) trackedPaths.add(path.resolve(u.filePath));
  for (const j of allJobs) for (const o of Array.isArray(j.outputs) ? j.outputs : []) if (typeof o === "string" && !/^https?:\/\//i.test(o)) trackedPaths.add(path.resolve(o));

  // 1. Media & Image jobs from doc("media.jobs")
  for (const job of allJobs) {
    if ((safeProjectId(job.projectId || "") || UNFILED) !== pid) continue;
    const outputs = Array.isArray(job.outputs) ? job.outputs : [];
    const mimes = Array.isArray(job.mimes) ? job.mimes : [];
    const prompt = String(job.params?.prompt || job.params?.text || "");
    const model = String(job.params?.model || job.params?.voiceId || "");
    const provider = String(job.provider || "");
    const op = String(job.op || "generate");

    // Derive automatic parentId from image edit/variation lineage
    let autoParentId = null;
    if (job.params?.from?.imageId) {
      const fromIdx = Number(job.params.from.index) || 0;
      autoParentId = `job:${job.params.from.imageId}:${fromIdx}`;
    } else if (job.params?.sourceJobId) {
      autoParentId = `job:${job.params.sourceJobId}:0`;
    }

    outputs.forEach((outPath, idx) => {
      const assetId = `job:${job.id}:${idx}`;
      const meta = getAssetMeta(state, pid, assetId);
      if (meta.deleted && !SHOW_TRASH) {
        if (typeof outPath === "string") trackedPaths.add(path.resolve(outPath));
        return;
      }
      const st = safeStat(outPath);
      if (st) trackedPaths.add(st.path);
      const baseName = typeof outPath === "string" && !outPath.startsWith("http")
        ? path.basename(outPath)
        : `${job.id}-${idx + 1}`;
      const mime = mimes[idx] || inferMime(baseName);
      const kind = inferKind(mime, job.kind, false);
      items.push({
        id: assetId,
        projectId: pid,
        sourceType: job.source === "images" ? "images" : "media-job",
        jobId: job.id,
        fileIndex: idx,
        kind,
        isUpload: false,
        isLink: false,
        linkedFrom: null,
        name: meta.name || baseName,
        mime,
        sizeBytes: st ? st.sizeBytes : 0,
        filePath: st ? st.path : (typeof outPath === "string" ? outPath : null),
        fileUrl: buildFileUrl(pid, assetId),
        prompt: meta.prompt != null ? meta.prompt : prompt,
        provider,
        providerName: providerLabel(provider),
        model,
        op,
        createdAt: Number(job.createdAt) || (st ? st.mtimeMs : Date.now()),
        parentId: meta.parentId !== null ? (meta.parentId || null) : autoParentId,
        tags: meta.tags,
        collections: meta.collections,
        usage: meta.usage,
      });
    });
  }

  // 2. Explicit uploads recorded in doc("project.media")
  for (const up of state.uploads) {
    if (safeProjectId(up.projectId || "") !== pid) continue;
    const assetId = `upload:${up.id}`;
    const meta = getAssetMeta(state, pid, assetId);
    const st = safeStat(up.filePath);
    if (st) trackedPaths.add(st.path);
    if (meta.deleted && !SHOW_TRASH) continue;
    const mime = up.mime || inferMime(up.name);
    const kind = up.kind || inferKind(mime, "upload", true);
    items.push({
      id: assetId,
      projectId: pid,
      sourceType: up.source ? "saved" : "upload",
      savedSource: up.source || null,
      provenance: up.provenance || null,
      folderPath: up.folderPath || null,
      textPreview: up.textPreview || "",
      jobId: null,
      fileIndex: 0,
      kind,
      isUpload: !up.source,
      isLink: false,
      linkedFrom: null,
      name: meta.name || up.name || path.basename(up.filePath || "upload"),
      mime,
      sizeBytes: st ? st.sizeBytes : (Number(up.sizeBytes) || 0),
      filePath: st ? st.path : up.filePath,
      fileUrl: buildFileUrl(pid, assetId),
      prompt: meta.prompt != null ? meta.prompt : String(up.prompt || ""),
      provider: up.provider || "upload",
      providerName: up.provider ? providerLabel(up.provider) : "Upload",
      model: up.model || "",
      op: "upload",
      createdAt: Number(up.createdAt) || (st ? st.mtimeMs : Date.now()),
      parentId: meta.parentId || null,
      tags: meta.tags,
      collections: meta.collections,
      usage: meta.usage,
    });
  }

  // 3. Untracked files sitting in projects/<id>/media (e.g. media-modify saveResult files)
  const mDir = projectMediaDir(pid);
  if (mDir && fs.existsSync(mDir)) {
    let entries = [];
    try { entries = fs.readdirSync(mDir, { withFileTypes: true }); } catch { entries = []; }
    for (const ent of entries) {
      if (!ent.isFile() || ent.name.startsWith(".")) continue;
      const full = path.resolve(path.join(mDir, ent.name));
      if (trackedPaths.has(full)) continue;
      trackedPaths.add(full);
      const assetId = `disk:${ent.name}`;
      const meta = getAssetMeta(state, pid, assetId);
      if (meta.deleted && !SHOW_TRASH) continue;
      const st = safeStat(full);
      const mime = inferMime(ent.name);
      const kind = inferKind(mime, "upload", true);

      // Check if filename starts with a jobId prefix (e.g. from media-modify saveResult)
      let autoParentId = null;
      let inferredPrompt = "";
      let inferredProvider = "upload";
      let inferredOp = "upload";
      for (const job of allJobs) {
        if (job.id && ent.name.startsWith(`${job.id}-`)) {
          autoParentId = `job:${job.id}:0`;
          inferredPrompt = String(job.params?.prompt || job.params?.text || "");
          inferredProvider = String(job.provider || "modify");
          inferredOp = "modify";
          break;
        }
      }

      items.push({
        id: assetId,
        projectId: pid,
        sourceType: inferredOp === "modify" ? "media-modify" : "disk",
        jobId: null,
        fileIndex: 0,
        kind,
        isUpload: inferredOp === "upload",
        isLink: false,
        linkedFrom: null,
        name: meta.name || ent.name,
        mime,
        sizeBytes: st ? st.sizeBytes : 0,
        filePath: full,
        fileUrl: buildFileUrl(pid, assetId),
        prompt: meta.prompt != null ? meta.prompt : inferredPrompt,
        provider: inferredProvider,
        providerName: inferredProvider === "upload" ? "Upload" : providerLabel(inferredProvider),
        model: "",
        op: inferredOp,
        createdAt: st ? st.mtimeMs : Date.now(),
        parentId: meta.parentId !== null ? (meta.parentId || null) : autoParentId,
        tags: meta.tags,
        collections: meta.collections,
        usage: meta.usage,
      });
    }
  }

  // 4. Files from project-files.js (projects/<id>/files)
  const fDir = filesDir(pid);
  if (fDir && fs.existsSync(fDir)) {
    let entries = [];
    try { entries = fs.readdirSync(fDir, { withFileTypes: true }); } catch { entries = []; }
    for (const ent of entries) {
      if (!ent.isFile() || ent.name.startsWith(".")) continue;
      const full = path.resolve(path.join(fDir, ent.name));
      if (trackedPaths.has(full)) continue;
      trackedPaths.add(full);
      const assetId = `pfile:${ent.name}`;
      const meta = getAssetMeta(state, pid, assetId);
      if (meta.deleted && !SHOW_TRASH) continue;
      const st = safeStat(full);
      const mime = inferMime(ent.name);
      const kind = inferKind(mime, "upload", true);
      items.push({
        id: assetId,
        projectId: pid,
        sourceType: "project-file",
        jobId: null,
        fileIndex: 0,
        kind,
        isUpload: true,
        isLink: false,
        linkedFrom: null,
        name: meta.name || ent.name,
        mime,
        sizeBytes: st ? st.sizeBytes : 0,
        filePath: full,
        fileUrl: buildFileUrl(pid, assetId),
        prompt: meta.prompt != null ? meta.prompt : "",
        provider: "upload",
        providerName: "Project file",
        model: "",
        op: "upload",
        createdAt: st ? st.mtimeMs : Date.now(),
        parentId: meta.parentId || null,
        tags: meta.tags,
        collections: meta.collections,
        usage: meta.usage,
      });
    }
  }

  const upById = new Map(state.uploads.map((u) => [`upload:${u.id}`, u]));
  for (const it of items) decorate(it, state, upById.get(it.id), allJobs);
  return items;
}

const SOURCE_LABELS = { images: "Images", "media-job": "Media", "media-modify": "Media edit", upload: "Upload", disk: "Project media", "project-file": "Project file" };
// Hub fields on every item: one status vocabulary, where it came from, where it went, how it was made.
function decorate(it, state, up, allJobs) {
  const meta = getAssetMeta(state, it.projectId, it.id);
  const posted = (it.usage || []).some((u) => u.kind === "posted");
  it.status = meta.status || up?.status || (posted || (meta.destinations || []).some((d) => d.status === "posted") ? "Published" : "Draft");
  it.destinations = meta.destinations;
  it.kept = meta.kept;
  it.publicUrl = meta.publicUrl || "";
  it.trashed = Boolean(meta.deleted);
  it.deletedAt = meta.deletedAt || null;
  it.source = up?.source || SOURCE_LABELS[it.sourceType] || "Project media";
  if (!it.provenance) {
    const job = it.jobId ? allJobs.find((j) => j.id === it.jobId) : null;
    const cost = Number(job?.cost ?? job?.estCost);
    it.provenance = { prompt: it.prompt || "", model: it.model || "", provider: it.providerName || it.provider || "", cost: Number.isFinite(cost) ? cost : null };
  }
  return it;
}

// Collect all assets for projectId including cross-project links.
export function indexProjectMedia(projectId) {
  const { id: pid } = assertProject(projectId);
  const state = mediaDoc();
  const allJobs = jobsDoc().items || [];
  const allProjects = listProjects() || [];
  const projectMap = new Map(allProjects.map((p) => [p.id, p]));

  const nativeItems = collectNativeAssets(pid, state, allJobs);
  const linkedItems = [];

  const linksForTarget = state.links.filter((l) => safeProjectId(l.targetProjectId || "") === pid);
  if (linksForTarget.length) {
    const cacheBySource = new Map();
    for (const link of linksForTarget) {
      const srcPid = safeProjectId(link.sourceProjectId || "");
      if (!srcPid) continue;
      if (!cacheBySource.has(srcPid)) {
        cacheBySource.set(srcPid, collectNativeAssets(srcPid, state, allJobs));
      }
      const srcList = cacheBySource.get(srcPid) || [];
      const srcAsset = srcList.find((a) => a.id === link.sourceAssetId);
      if (!srcAsset) continue;
      const linkAssetId = `link:${link.id}`;
      const meta = getAssetMeta(state, pid, linkAssetId);
      if (meta.deleted) continue;
      const srcProjName = projectMap.get(srcPid)?.name || srcPid;
      linkedItems.push({
        ...srcAsset,
        id: linkAssetId,
        projectId: pid,
        isLink: true,
        linkedFrom: {
          linkId: link.id,
          projectId: srcPid,
          projectName: srcProjName,
          assetId: srcAsset.id,
          linkedAt: link.createdAt,
        },
        fileUrl: buildFileUrl(pid, linkAssetId),
        name: meta.name || srcAsset.name,
        prompt: meta.prompt != null ? meta.prompt : srcAsset.prompt,
        parentId: meta.parentId || null,
        tags: normalizeTags([...(srcAsset.tags || []), ...(meta.tags || [])]),
        collections: meta.collections,
        usage: [...(srcAsset.usage || []), ...(meta.usage || [])],
        createdAt: Number(link.createdAt) || srcAsset.createdAt,
      });
    }
  }

  return [...nativeItems, ...linkedItems];
}

function stripPublicAsset(item) {
  const { filePath, ...rest } = item;
  return {
    ...rest,
    hasFile: Boolean(filePath && safeStat(filePath)),
  };
}

// Build version stacks: group variations/edits under their root asset.
export function buildVersionStacks(items) {
  const byId = new Map(items.map((a) => [a.id, a]));
  const childrenMap = new Map(); // rootId -> [descendant items]

  function findRootId(item) {
    const visited = new Set([item.id]);
    let cur = item;
    while (cur.parentId && byId.has(cur.parentId) && !visited.has(cur.parentId)) {
      visited.add(cur.parentId);
      cur = byId.get(cur.parentId);
    }
    return cur.id;
  }

  const roots = [];
  for (const item of items) {
    const rootId = findRootId(item);
    if (rootId === item.id) {
      roots.push(item);
    } else {
      if (!childrenMap.has(rootId)) childrenMap.set(rootId, []);
      childrenMap.get(rootId).push(item);
    }
  }

  return roots.map((root) => {
    const versions = (childrenMap.get(root.id) || [])
      .slice()
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      .map(stripPublicAsset);
    const pubRoot = stripPublicAsset(root);
    return {
      ...pubRoot,
      versions,
      versionCount: 1 + versions.length,
      latestVersion: versions.length ? versions[versions.length - 1] : pubRoot,
    };
  });
}

// Compute smart collections (auto-grouped by type, date, AI source, or generation prompt).
export function computeSmartCollections(items) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const weekMs = 7 * dayMs;

  const byType = {};
  const byDate = { today: 0, "this-week": 0, older: 0 };
  const byAi = {};
  const byPromptMap = new Map();

  for (const a of items) {
    const k = a.isUpload ? "uploads" : (a.kind || "other");
    byType[k] = (byType[k] || 0) + 1;

    const age = now - (Number(a.createdAt) || 0);
    if (age <= dayMs) byDate.today += 1;
    else if (age <= weekMs) byDate["this-week"] += 1;
    else byDate.older += 1;

    const aiKey = a.provider || "upload";
    if (!byAi[aiKey]) byAi[aiKey] = { id: aiKey, label: a.providerName || aiKey, count: 0 };
    byAi[aiKey].count += 1;

    const pText = String(a.prompt || "").trim();
    if (pText) {
      const norm = pText.toLowerCase().replace(/\s+/g, " ").slice(0, 48);
      const prev = byPromptMap.get(norm) || { key: norm, label: pText.slice(0, 48), count: 0 };
      prev.count += 1;
      byPromptMap.set(norm, prev);
    }
  }

  return {
    byType,
    byDate,
    byAi: Object.values(byAi).sort((a, b) => b.count - a.count),
    byPrompt: [...byPromptMap.values()].sort((a, b) => b.count - a.count).slice(0, 20),
  };
}

function matchesFilter(item, query = {}, now = Date.now()) {
  const type = String(query.type || "all").toLowerCase();
  if (type && type !== "all") {
    if (type === "images" || type === "image") {
      if (item.kind !== "image") return false;
    } else if (type === "video" || type === "videos") {
      if (item.kind !== "video") return false;
    } else if (type === "audio" || type === "voice") {
      if (item.kind !== "audio") return false;
    } else if (type === "uploads" || type === "upload") {
      if (!item.isUpload && item.kind !== "upload") return false;
    } else if (type === "text" || type === "site" || type === "file") {
      if (item.kind !== type) return false;
    }
  }

  if (query.status && String(query.status).toLowerCase() !== "all") {
    if (String(item.status || "").toLowerCase() !== String(query.status).toLowerCase()) return false;
  }
  if (query.source && String(query.source).toLowerCase() !== "all") {
    if (String(item.source || "").toLowerCase() !== String(query.source).toLowerCase()) return false;
  }

  if (query.tag) {
    const wantTag = normalizeTag(query.tag);
    if (wantTag && !(item.tags || []).includes(wantTag)) return false;
  }

  if (query.collection) {
    const wantCol = String(query.collection).trim();
    if (wantCol && !(item.collections || []).includes(wantCol)) return false;
  }

  if (query.smart) {
    const s = String(query.smart);
    const dayMs = 24 * 60 * 60 * 1000;
    const age = now - (Number(item.createdAt) || 0);
    if (s === "date:today" && age > dayMs) return false;
    if (s === "date:this-week" && (age <= dayMs || age > 7 * dayMs)) return false;
    if (s === "date:older" && age <= 7 * dayMs) return false;
    if (s.startsWith("ai:")) {
      const wantAi = s.slice(3);
      if ((item.provider || "upload") !== wantAi) return false;
    }
    if (s.startsWith("prompt:")) {
      const wantPrompt = s.slice(7).toLowerCase();
      const norm = String(item.prompt || "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 48);
      if (norm !== wantPrompt) return false;
    }
    if (s.startsWith("type:")) {
      const wantType = s.slice(5);
      const k = item.isUpload ? "uploads" : (item.kind || "other");
      if (k !== wantType) return false;
    }
  }

  if (query.q) {
    const q = String(query.q).trim().toLowerCase();
    if (q) {
      const hay = [
        item.name || "",
        item.prompt || "",
        ...(item.tags || []),
        item.provider || "",
        item.providerName || "",
        item.model || "",
        item.linkedFrom?.projectName || "",
        item.source || "",
        item.status || "",
        item.kind === "text" ? String(item.textPreview || "") : "",
      ].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
  }

  return true;
}

function sortItems(list, sortSpec = "date-desc") {
  const s = String(sortSpec || "date-desc").toLowerCase();
  const copy = list.slice();
  if (s === "name" || s === "name-asc") {
    copy.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  } else if (s === "name-desc") {
    copy.sort((a, b) => String(b.name || "").localeCompare(String(a.name || "")));
  } else if (s === "date-asc" || s === "oldest") {
    copy.sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
  } else {
    copy.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
  }
  return copy;
}

export function listProjectMedia(projectId, query = {}) {
  const { id: pid, project } = assertProject(projectId);
  const state = mediaDoc();
  const allItems = indexProjectMedia(pid);
  const smartCollections = computeSmartCollections(allItems);

  // Collect all distinct tags across the project
  const tagSet = new Set(PRESET_TAGS);
  for (const a of allItems) {
    for (const t of a.tags || []) tagSet.add(t);
  }

  const manualCollections = Array.isArray(state.collections[pid]) ? state.collections[pid] : [];
  const now = Date.now();
  const hasActiveFilter = Boolean(
    (query.type && query.type !== "all") || query.q || query.tag || query.collection || query.smart
  );

  // Build stacks over all items first so lineage is preserved, then filter/sort
  const allStacks = buildVersionStacks(allItems);
  const filteredFlat = sortItems(
    allItems.filter((item) => matchesFilter(item, query, now)),
    query.sort
  ).map(stripPublicAsset);

  const filteredStacks = sortItems(
    allStacks.filter((stack) => {
      if (matchesFilter(stack, query, now)) return true;
      return (stack.versions || []).some((v) => matchesFilter(v, query, now));
    }),
    query.sort
  );

  // Find the most recent generation across media.jobs so the UI can show "Add from last generation"
  const allJobs = (jobsDoc().items || []).filter(
    (j) => (j.status === "done" || j.status === "dry-run") && Array.isArray(j.outputs) && j.outputs.length > 0
  );
  const latestJob = allJobs[0] || null;
  const lastGeneration = latestJob
    ? {
        jobId: latestJob.id,
        kind: latestJob.kind || "image",
        provider: latestJob.provider,
        prompt: String(latestJob.params?.prompt || latestJob.params?.text || "").slice(0, 120),
        projectId: latestJob.projectId || null,
        createdAt: latestJob.createdAt,
      }
    : null;

  return {
    projectId: pid,
    projectName: project.name || pid,
    total: allItems.length,
    filteredTotal: filteredFlat.length,
    hasActiveFilter,
    items: String(query.flat || "") === "1" ? filteredFlat : filteredStacks,
    flatItems: filteredFlat,
    stacks: filteredStacks,
    tags: [...tagSet],
    presetTags: PRESET_TAGS,
    collections: manualCollections,
    smartCollections,
    lastGeneration,
  };
}

export function uploadMedia(projectId, body = {}) {
  const { id: pid } = assertProject(projectId);
  const files = Array.isArray(body.files)
    ? body.files
    : body.name
    ? [{ name: body.name, mime: body.mime, data: body.data, text: body.text }]
    : [];
  if (!files.length) {
    const err = new Error("At least one file is required to upload.");
    err.status = 400;
    throw err;
  }

  const dir = projectMediaDir(pid);
  const state = mediaDoc();
  const created = [];

  for (const f of files) {
    const rawName = String(f?.name || "upload.bin").trim();
    const safeName = rawName.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+/, "").slice(0, 100) || "upload.bin";
    let buf;
    if (typeof f.data === "string" && f.data.length > 0) {
      const stripped = f.data.replace(/^data:[^;]+;base64,/, "");
      buf = Buffer.from(stripped, "base64");
    } else if (typeof f.text === "string") {
      buf = Buffer.from(f.text, "utf8");
    } else {
      buf = Buffer.from("upload-placeholder", "utf8");
    }
    if (buf.length > MAX_UPLOAD_BYTES) {
      const err = new Error(`File "${safeName}" is larger than 25 MB.`);
      err.status = 400;
      throw err;
    }

    const upId = "up-" + Date.now().toString(36) + "-" + crypto.randomBytes(2).toString("hex");
    const diskName = `${upId}-${safeName}`;
    const filePath = path.join(dir, diskName);
    fs.writeFileSync(filePath, buf);

    const mime = f.mime || inferMime(safeName);
    const record = {
      id: upId,
      projectId: pid,
      name: safeName,
      filePath,
      mime,
      sizeBytes: buf.length,
      prompt: String(f.prompt ?? body.prompt ?? "").slice(0, 2000),
      createdAt: Date.now(),
    };
    state.uploads.unshift(record);

    const assetId = `upload:${upId}`;
    if (body.tags || f.tags || body.collection || body.parentId) {
      setAssetMeta(state, pid, assetId, {
        tags: f.tags || body.tags || [],
        collections: body.collection ? [body.collection] : [],
        parentId: body.parentId || null,
      });
    }
    created.push(assetId);
  }

  saveMediaDoc(state);
  const listed = listProjectMedia(pid);
  const addedItems = listed.flatItems.filter((a) => created.includes(a.id));
  return { ok: true, projectId: pid, added: addedItems, count: addedItems.length };
}

// Attach or link the most recent generation from doc("media.jobs") into projectId without copying files.
export function addFromLastGeneration(projectId, body = {}) {
  const { id: pid } = assertProject(projectId);
  const jDoc = jobsDoc();
  const candidates = (jDoc.items || []).filter(
    (j) => (j.status === "done" || j.status === "dry-run") && Array.isArray(j.outputs) && j.outputs.length > 0
  );
  if (!candidates.length) {
    const err = new Error("No recent generation found to add.");
    err.status = 404;
    throw err;
  }

  // If a specific jobId was requested, find it; otherwise pick the newest job
  const targetJob = body.jobId
    ? candidates.find((j) => j.id === body.jobId)
    : candidates.find((j) => safeProjectId(j.projectId || "") !== pid) || candidates[0];

  if (!targetJob) {
    const err = new Error("Requested generation was not found.");
    err.status = 404;
    throw err;
  }

  const existingPid = safeProjectId(targetJob.projectId || "");
  if (!existingPid) {
    // Assign the job directly to this project in-place without moving its output files
    targetJob.projectId = pid;
    saveJobsDoc(jDoc);
    const listed = listProjectMedia(pid);
    const asset = listed.flatItems.find((a) => a.id === `job:${targetJob.id}:0`) || listed.flatItems[0];
    return { ok: true, mode: "assigned", jobId: targetJob.id, asset };
  }

  if (existingPid === pid) {
    const listed = listProjectMedia(pid);
    const asset = listed.flatItems.find((a) => a.id === `job:${targetJob.id}:0`) || listed.flatItems[0];
    return { ok: true, mode: "already-in-project", jobId: targetJob.id, asset };
  }

  // Belongs to another project: link it into pid without copying the file on disk
  const linked = linkAssetToProject({
    sourceProjectId: existingPid,
    assetId: `job:${targetJob.id}:0`,
    targetProjectId: pid,
  });
  return { ok: true, mode: "linked", jobId: targetJob.id, asset: linked.asset };
}

export function updateAssetMeta(projectId, assetId, patch = {}) {
  const { id: pid } = assertProject(projectId);
  if (!assetId) {
    const err = new Error("assetId is required.");
    err.status = 400;
    throw err;
  }
  const state = mediaDoc();
  const updated = setAssetMeta(state, pid, String(assetId), patch);
  saveMediaDoc(state);
  const listed = listProjectMedia(pid);
  const item = listed.flatItems.find((a) => a.id === assetId) || null;
  return { ok: true, projectId: pid, assetId, meta: updated, asset: item };
}

// Create a cross-project metadata link (links, not copies).
export function linkAssetToProject({ sourceProjectId, assetId, targetProjectId }) {
  const { id: srcPid } = assertProject(sourceProjectId);
  const { id: dstPid, project: dstProj } = assertProject(targetProjectId);
  if (!assetId) {
    const err = new Error("assetId is required.");
    err.status = 400;
    throw err;
  }
  if (srcPid === dstPid) {
    const err = new Error("Source and target project are the same.");
    err.status = 400;
    throw err;
  }

  const state = mediaDoc();
  const allJobs = jobsDoc().items || [];

  // If linking an asset that is itself a link, resolve to the underlying native source asset
  let realSrcPid = srcPid;
  let realSrcAssetId = String(assetId);
  if (realSrcAssetId.startsWith("link:")) {
    const linkId = realSrcAssetId.slice(5);
    const existingLink = state.links.find((l) => l.id === linkId);
    if (existingLink) {
      realSrcPid = existingLink.sourceProjectId;
      realSrcAssetId = existingLink.sourceAssetId;
    }
  }

  const srcAssets = collectNativeAssets(realSrcPid, state, allJobs);
  const found = srcAssets.find((a) => a.id === realSrcAssetId);
  if (!found) {
    const err = new Error("Source asset was not found.");
    err.status = 404;
    throw err;
  }

  let link = state.links.find(
    (l) => l.sourceProjectId === realSrcPid && l.sourceAssetId === realSrcAssetId && l.targetProjectId === dstPid
  );
  if (!link) {
    link = {
      id: "lnk-" + Date.now().toString(36) + "-" + crypto.randomBytes(2).toString("hex"),
      sourceProjectId: realSrcPid,
      sourceAssetId: realSrcAssetId,
      targetProjectId: dstPid,
      createdAt: Date.now(),
    };
    state.links.unshift(link);
  }

  // Record usage badge on the source asset
  setAssetMeta(state, realSrcPid, realSrcAssetId, {
    addUsage: {
      kind: "project",
      label: `Linked to ${dstProj.name || dstPid}`,
      targetId: dstPid,
    },
  });

  saveMediaDoc(state);
  const targetList = listProjectMedia(dstPid);
  const linkedAsset = targetList.flatItems.find((a) => a.id === `link:${link.id}`) || null;
  return { ok: true, link, asset: linkedAsset };
}

export function manageCollection(projectId, { action = "create", name, id }) {
  const { id: pid } = assertProject(projectId);
  const state = mediaDoc();
  if (!Array.isArray(state.collections[pid])) state.collections[pid] = [];
  const list = state.collections[pid];

  if (action === "delete" || action === "remove") {
    const target = String(id || name || "").trim();
    state.collections[pid] = list.filter((c) => c.id !== target && c.name !== target);
    saveMediaDoc(state);
    return { ok: true, collections: state.collections[pid] };
  }

  const cleanName = String(name || "").trim().slice(0, 60);
  if (!cleanName) {
    const err = new Error("Collection name is required.");
    err.status = 400;
    throw err;
  }
  const colId = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "collection";
  if (!list.some((c) => c.id === colId || c.name.toLowerCase() === cleanName.toLowerCase())) {
    list.push({ id: colId, name: cleanName, createdAt: Date.now() });
  }
  saveMediaDoc(state);
  return { ok: true, collections: list };
}

// Consistent "Send to..." handler (Send to Project, Send to Remix, Send to Finish, Copy prompt, or mark usage).
export function sendAssetTo(projectId, body = {}) {
  const { id: pid } = assertProject(projectId);
  const target = String(body.target || "").trim().toLowerCase();
  const ids = Array.isArray(body.assetIds) && body.assetIds.length
    ? body.assetIds.map(String)
    : body.assetId
    ? [String(body.assetId)]
    : [];

  if (!ids.length) {
    const err = new Error("Pick at least one asset first.");
    err.status = 400;
    throw err;
  }

  const allItems = indexProjectMedia(pid);
  const picked = ids.map((id) => allItems.find((a) => a.id === id)).filter(Boolean);
  if (!picked.length) {
    const err = new Error("Selected asset was not found in this project.");
    err.status = 404;
    throw err;
  }

  if (target === "project") {
    const targetProjectId = body.targetProjectId;
    if (!targetProjectId) {
      const err = new Error("Pick a target project to send to.");
      err.status = 400;
      throw err;
    }
    const linked = picked.map((a) =>
      linkAssetToProject({ sourceProjectId: pid, assetId: a.id, targetProjectId }).asset
    ).filter(Boolean);
    return {
      ok: true,
      target: "project",
      targetProjectId: safeProjectId(targetProjectId),
      linkedCount: linked.length,
      assets: linked,
    };
  }

  if (target === "copy-prompt") {
    const prompts = picked.map((a) => a.prompt || a.name || "").filter(Boolean);
    return {
      ok: true,
      target: "copy-prompt",
      prompt: prompts.join("\n\n"),
      prompts,
    };
  }

  const state = mediaDoc();
  if (target === "remix") {
    for (const a of picked) {
      setAssetMeta(state, pid, a.id, {
        addUsage: { kind: "remix", label: "Used in Remix", targetId: "remix" },
      });
    }
    saveMediaDoc(state);
    return {
      ok: true,
      target: "remix",
      view: "remix",
      prompt: picked.map((a) => a.prompt || a.name).filter(Boolean).join("\n"),
      assets: picked.map(stripPublicAsset),
    };
  }

  if (target === "finish") {
    for (const a of picked) {
      setAssetMeta(state, pid, a.id, {
        addUsage: { kind: "finish", label: "Sent to Finish", targetId: "finish" },
      });
    }
    saveMediaDoc(state);
    return {
      ok: true,
      target: "finish",
      view: "media",
      prompt: picked.map((a) => a.prompt || a.name).filter(Boolean).join("\n"),
      assets: picked.map(stripPublicAsset),
    };
  }

  if (target === "posted" || target === "site" || target === "video") {
    const label = body.label || USAGE_KINDS[target] || target;
    for (const a of picked) {
      setAssetMeta(state, pid, a.id, {
        addUsage: { kind: target, label, targetId: body.targetId || target },
      });
    }
    saveMediaDoc(state);
    return {
      ok: true,
      target,
      assets: indexProjectMedia(pid).filter((a) => ids.includes(a.id)).map(stripPublicAsset),
    };
  }

  const err = new Error("Choose a valid destination: project, remix, finish, or copy-prompt.");
  err.status = 400;
  throw err;
}

// Bulk operations on multiple assets in one step.
export function bulkAction(projectId, body = {}) {
  const { id: pid } = assertProject(projectId);
  const assetIds = Array.isArray(body.assetIds) ? body.assetIds.map(String).filter(Boolean) : [];
  if (!assetIds.length) {
    const err = new Error("Select at least one asset for a bulk action.");
    err.status = 400;
    throw err;
  }
  const action = String(body.action || "").trim().toLowerCase();
  const state = mediaDoc();

  if (action === "tag") {
    const addTags = Array.isArray(body.tags) ? body.tags : body.tag ? [body.tag] : [];
    for (const id of assetIds) setAssetMeta(state, pid, id, { addTags });
    saveMediaDoc(state);
    return { ok: true, action, count: assetIds.length };
  }

  if (action === "untag") {
    const removeTags = Array.isArray(body.tags) ? body.tags : body.tag ? [body.tag] : [];
    for (const id of assetIds) setAssetMeta(state, pid, id, { removeTags });
    saveMediaDoc(state);
    return { ok: true, action, count: assetIds.length };
  }

  if (action === "collection") {
    const col = String(body.collection || "").trim();
    if (!col) {
      const err = new Error("Collection name is required.");
      err.status = 400;
      throw err;
    }
    manageCollection(pid, { action: "create", name: col });
    for (const id of assetIds) setAssetMeta(state, pid, id, { addCollections: [col] });
    saveMediaDoc(state);
    return { ok: true, action, collection: col, count: assetIds.length };
  }

  if (action === "uncollection") {
    const col = String(body.collection || "").trim();
    for (const id of assetIds) setAssetMeta(state, pid, id, { removeCollections: [col] });
    saveMediaDoc(state);
    return { ok: true, action, collection: col, count: assetIds.length };
  }

  if (action === "stack") {
    const parentId = body.parentId ? String(body.parentId) : assetIds[0];
    for (const id of assetIds) {
      if (id === parentId) continue;
      setAssetMeta(state, pid, id, { parentId });
    }
    saveMediaDoc(state);
    return { ok: true, action, parentId, count: assetIds.length };
  }

  if (action === "unstack") {
    for (const id of assetIds) setAssetMeta(state, pid, id, { parentId: null });
    saveMediaDoc(state);
    return { ok: true, action, count: assetIds.length };
  }

  if (action === "usage") {
    const kind = String(body.kind || "posted");
    const label = String(body.label || USAGE_KINDS[kind] || kind);
    for (const id of assetIds) {
      setAssetMeta(state, pid, id, { addUsage: { kind, label, targetId: body.targetId || null } });
    }
    saveMediaDoc(state);
    return { ok: true, action, count: assetIds.length };
  }

  // "move" is a link too: the original stays where it is, so the link never breaks.
  if (action === "link" || action === "move") {
    const res = sendAssetTo(pid, { assetIds, target: "project", targetProjectId: body.targetProjectId });
    return { ok: true, action, count: res.linkedCount, targetProjectId: res.targetProjectId };
  }

  if (action === "send") {
    return sendAssetTo(pid, {
      assetIds,
      target: body.sendTo || body.target || "remix",
      targetProjectId: body.targetProjectId,
    });
  }

  if (action === "export") {
    const allItems = indexProjectMedia(pid);
    const exported = assetIds
      .map((id) => allItems.find((a) => a.id === id))
      .filter(Boolean)
      .map((a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        mime: a.mime,
        sizeBytes: a.sizeBytes,
        prompt: a.prompt,
        provider: a.provider,
        tags: a.tags,
        fileUrl: a.fileUrl,
        linkedFrom: a.linkedFrom,
      }));
    return { ok: true, action: "export", count: exported.length, items: exported };
  }

  if (action === "delete") {
    for (const id of assetIds) setAssetMeta(state, pid, id, { deleted: true });
    saveMediaDoc(state);
    return { ok: true, action: "delete", count: assetIds.length };
  }

  const err = new Error("Unsupported bulk action.");
  err.status = 400;
  throw err;
}

// Resolve an asset's underlying file on disk without copying it (follows cross-project links).
export function resolveAssetFile(projectId, assetId) {
  const { id: pid } = assertProject(projectId);
  const allItems = indexProjectMedia(pid);
  const found = allItems.find((a) => a.id === String(assetId || ""));
  if (!found || !found.filePath) return null;
  const st = safeStat(found.filePath);
  if (!st) return null;
  return {
    filePath: st.path,
    bytes: fs.readFileSync(st.path),
    mime: found.mime || inferMime(found.name),
    name: found.name || path.basename(st.path),
  };
}


// ---------------------------------------------------------------------------------------------
// MindMedia hub (0.4.20): one place for everything Meldmind makes.
// saveToMindMedia({ kind, files|text, projectId, provenance, source, status }) is the one entry
// every flow calls. Items without a project go to projects/unfiled. Text results become items too
// (a Markdown file). Files are copied into the project's media folder unless they already live
// under the data folder (a builder's site folder), in which case they are referenced in place.
// ---------------------------------------------------------------------------------------------
export const HUB_KINDS = ["image", "video", "audio", "text", "site", "file"];

function slug(t, fallback = "result") {
  let w = String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (w.length > 48) { const cut = w.lastIndexOf("-", 48); w = w.slice(0, cut > 12 ? cut : 48); }
  return w || fallback;
}

// A readable name from the first line of some words (0.4.21): no #, ** or backticks, never cut in the middle of a word.
// A Pro prompt (ROLE / CONTEXT / COMMAND blocks) is named from its ROLE line, not from the profile block above it.
export function smartName(text, max = 60) {
  const raw = String(text || "").replace(/\r/g, "");
  const role = /^ROLE:\s*(.+)$/m.exec(raw);
  const lines = (role ? [role[1]] : raw.split("\n")).map((l) => l.replace(/^\s*(```+\w*|~~~+|-{3,}|\*{3,})\s*$/, "").replace(/^[\s#>*\-+]+/, "").replace(/[*_`]+/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim());
  let line = lines.find((l) => l.length > 2) || "";
  if (line.length > max) {
    const cut = line.lastIndexOf(" ", max);
    line = line.slice(0, cut > max / 2 ? cut : max).replace(/[,;:\-\s]+$/, "");
  }
  return line;
}
function hubProjectId(projectId) {
  const id = safeProjectId(projectId || "");
  return id || UNFILED;
}
function projectLabel(pid, projectMap) {
  if (pid === UNFILED) return "Unfiled";
  return projectMap?.get(pid)?.name || pid;
}
function cleanProvenance(p) {
  if (!p || typeof p !== "object") return null;
  const cost = Number(p.cost);
  return {
    prompt: String(p.prompt || "").slice(0, 2000),
    model: String(p.model || "").slice(0, 120),
    provider: String(p.provider || "").slice(0, 80),
    cost: Number.isFinite(cost) ? cost : null,
  };
}

export function saveToMindMedia(opts = {}) {
  const pid = hubProjectId(opts.projectId);
  const source = String(opts.source || "Meldmind").slice(0, 60);
  let status = STATUSES.find((x) => x.toLowerCase() === String(opts.status || "").toLowerCase()) || "Draft";
  const files = Array.isArray(opts.files) ? opts.files.filter(Boolean) : [];
  const hasText = typeof opts.text === "string" && opts.text.trim().length > 0;
  if (!files.length && !hasText) {
    const err = new Error("Nothing to save: send a file or some text.");
    err.status = 400;
    throw err;
  }
  const state = mediaDoc();
  const dir = projectMediaDir(pid);
  if (fs.lstatSync(dir).isSymbolicLink() || !realInside(dir, path.resolve(DATA_DIR))) {
    const err = new Error("That project folder is a link to somewhere else, so nothing can be saved into it.");
    err.status = 400;
    throw err;
  }
  const provenance = cleanProvenance(opts.provenance);
  const baseName = String(opts.name || opts.title || "").trim().slice(0, 140);
  const created = [];

  // dedupe: saving the same thing again (same key) updates the item instead of stacking copies
  const dedupeKey = opts.dedupeKey ? String(opts.dedupeKey).slice(0, 200) : "";
  if (dedupeKey) {
    const prev = state.uploads.find((u) => u.dedupeKey === dedupeKey && safeProjectId(u.projectId) === pid);
    if (prev && !getAssetMeta(state, pid, `upload:${prev.id}`).deleted) {
      if (hasText && prev.filePath) { try { fs.writeFileSync(prev.filePath, opts.text, "utf8"); prev.sizeBytes = Buffer.byteLength(opts.text); } catch { /* keep the old text */ } }
      prev.updatedAt = Date.now();
      saveMediaDoc(state);
      return finishSave(pid, [`upload:${prev.id}`], { reused: true });
    }
  }

  const make = ({ name, mime, filePath, sizeBytes, kind, folderPath }) => {
    const upId = "up-" + Date.now().toString(36) + "-" + crypto.randomBytes(3).toString("hex");
    state.uploads.unshift({
      id: upId, projectId: pid, name, filePath, mime, sizeBytes, kind,
      prompt: String(provenance?.prompt || opts.prompt || "").slice(0, 2000),
      provider: "upload", model: provenance?.model || "",
      source, status, provenance, folderPath: folderPath || null, dedupeKey: dedupeKey || undefined,
      textPreview: kind === "text" ? String(opts.text || "").slice(0, 300) : undefined,
      createdAt: Date.now(),
    });
    const assetId = `upload:${upId}`;
    const patch = {};
    if (opts.tags) patch.tags = opts.tags;
    if (opts.parentId) patch.parentId = opts.parentId;
    if (baseName && files.length <= 1) patch.name = baseName;
    if (Object.keys(patch).length) setAssetMeta(state, pid, assetId, patch);
    if (Array.isArray(opts.destinations)) for (const d of opts.destinations) setAssetMeta(state, pid, assetId, { addDestination: d });
    created.push(assetId);
  };

  if (hasText) {
    const name = `${slug(baseName || smartName(opts.text, 60))}.md`;
    const filePath = path.join(dir, `up-${Date.now().toString(36)}-${crypto.randomBytes(2).toString("hex")}-${name}`);
    fs.writeFileSync(filePath, opts.text, "utf8");
    make({ name: baseName ? `${baseName}.md` : (smartName(opts.text, 60) ? `${smartName(opts.text, 60)}.md` : name), mime: "text/markdown", filePath, sizeBytes: Buffer.byteLength(opts.text), kind: "text" });
  }

  for (const f of files) {
    const rawName = String(f.name || (f.path ? path.basename(String(f.path)) : "file")).trim();
    const safeName = rawName.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+/, "").slice(0, 100) || "file";
    let filePath, sizeBytes, buf = null;
    if (typeof f.path === "string" && f.path) {
      const st = safeStat(f.path);
      if (!st) {
        const err = new Error(`"${safeName}" is not inside the Meldmind data folder, so it cannot be kept.`);
        err.status = 400;
        throw err;
      }
      filePath = st.path;
      sizeBytes = st.sizeBytes;
    } else {
      if (typeof f.data === "string" && f.data) buf = Buffer.from(f.data.replace(/^data:[^;]+;base64,/, ""), "base64");
      else if (typeof f.text === "string") buf = Buffer.from(f.text, "utf8");
      else {
        const err = new Error(`"${safeName}" has no content.`);
        err.status = 400;
        throw err;
      }
      if (buf.length > MAX_UPLOAD_BYTES) {
        const err = new Error(`File "${safeName}" is larger than 25 MB.`);
        err.status = 400;
        throw err;
      }
      filePath = path.join(dir, `up-${Date.now().toString(36)}-${crypto.randomBytes(2).toString("hex")}-${safeName}`);
      fs.writeFileSync(filePath, buf);
      sizeBytes = buf.length;
    }
    const mime = f.mime || inferMime(safeName);
    let kind = HUB_KINDS.includes(opts.kind) && files.length === 1 ? opts.kind : null;
    if (!kind) {
      const k = inferKind(mime, "upload", true);
      kind = k === "upload" ? (/^text\/|json$/.test(mime) ? "text" : "file") : k;
    }
    make({ name: safeName, mime, filePath, sizeBytes, kind, folderPath: typeof f.folder === "string" ? f.folder : (typeof opts.folder === "string" ? opts.folder : null) });
  }

  saveMediaDoc(state);
  return finishSave(pid, created, {});
}

function finishSave(pid, assetIds, extra) {
  const projects = listProjects() || [];
  const map = new Map(projects.map((p) => [p.id, p]));
  const items = indexProjectMedia(pid).filter((a) => assetIds.includes(a.id)).map(stripPublicAsset);
  const where = projectLabel(pid, map);
  return {
    ok: true, projectId: pid, where, count: items.length, items, ...extra,
    savedWhere: `Saved in MindMedia, ${pid === UNFILED ? "Unfiled" : where}.`,
    link: `#mindmedia/${encodeURIComponent(pid)}/${encodeURIComponent(items[0]?.id || "")}`,
  };
}

function allProjectIds(state, allJobs) {
  const ids = new Set([UNFILED]);
  for (const p of listProjects() || []) ids.add(p.id);
  for (const u of state.uploads) ids.add(hubProjectId(u.projectId));
  for (const j of allJobs) if (Array.isArray(j.outputs) && j.outputs.length) ids.add(hubProjectId(j.projectId));
  return [...ids];
}

// Built-in saved views (0.4.21). Each is a plain filter over the live items; the rail shows a count for each.
export const VIEWS = {
  "needs-ok": { label: "Needs my OK", test: (i) => i.status === "Review" },
  "approved-unpublished": { label: "Approved, not published", test: (i) => i.status === "Approved" },
  "published-month": { label: "Published this month", test: (i, now) => i.status === "Published" && inThisMonth(lastPublishedAt(i), now) },
  "ai-employees": { label: "Made by AI employees", test: (i) => /^AI employee/i.test(String(i.source || "")) },
  "needs-ending": { label: "Needs an ending", test: (i) => needsAnEnding(i) },
};
function lastPublishedAt(i) {
  const posted = (i.destinations || []).filter((d) => d.status === "posted").map((d) => Number(d.at) || 0);
  return posted.length ? Math.max(...posted) : Number(i.createdAt) || 0;
}
function inThisMonth(t, now) {
  const a = new Date(t), b = new Date(now);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

// Jobs still running (or waiting for an OK) show up as a pending tile before they have a file.
const PENDING_STATES = new Set(["queued", "processing", "awaiting_ok", "running", "working"]);
export function pendingJobs() {
  const projects = listProjects() || [];
  const map = new Map(projects.map((p) => [p.id, p]));
  return (jobsDoc().items || [])
    .filter((j) => PENDING_STATES.has(j.status) && !(Array.isArray(j.outputs) && j.outputs.length))
    .map((j) => {
      const pid = hubProjectId(j.projectId);
      const prompt = String(j.params?.prompt || j.params?.text || "").replace(/\s+/g, " ").trim();
      return {
        id: String(j.id), kind: j.kind === "video" || j.kind === "audio" || j.kind === "image" ? j.kind : "file",
        status: j.status === "awaiting_ok" ? "Waiting for your OK" : j.status === "queued" ? "Waiting to start" : "Working",
        awaitingOk: j.status === "awaiting_ok",
        name: prompt.slice(0, 60) || `${j.kind || "Media"} job`, projectId: pid, projectName: projectLabel(pid, map),
        createdAt: Number(j.createdAt) || 0,
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
}
// Jobs that finished a moment ago, so the page can say "Your clip is ready".
export function recentlyFinished(sinceMs = 15 * 60 * 1000) {
  const now = Date.now();
  return (jobsDoc().items || [])
    .filter((j) => j.status === "done" && Array.isArray(j.outputs) && j.outputs.length && now - (Number(j.finishedAt) || Number(j.createdAt) || 0) < sinceMs)
    .map((j) => ({ id: String(j.id), kind: j.kind || "file", projectId: hubProjectId(j.projectId), assetId: `job:${j.id}:0`, finishedAt: Number(j.finishedAt) || 0 }))
    .slice(0, 20);
}

// Everything, across all projects and Unfiled. Query: project (id | "unfiled" | "all"), type, status, source, tag, q, sort,
// view (a built-in saved view or "trash").
export function listMindMedia(query = {}) {
  const state = mediaDoc();
  const allJobs = jobsDoc().items || [];
  const projects = listProjects() || [];
  const map = new Map(projects.map((p) => [p.id, p]));
  const now = Date.now();
  let every = [];
  SHOW_TRASH = true;
  try {
    for (const pid of allProjectIds(state, allJobs)) {
      for (const it of collectNativeAssets(pid, state, allJobs)) every.push({ ...it, projectName: projectLabel(pid, map) });
    }
  } finally { SHOW_TRASH = false; }
  const trashMs = TRASH_DAYS * 24 * 60 * 60 * 1000;
  const trash = every.filter((i) => i.trashed && i.deletedAt && now - i.deletedAt < trashMs).sort((a, b) => b.deletedAt - a.deletedAt);
  const items = every.filter((i) => !i.trashed);
  const perProject = {};
  for (const i of items) perProject[i.projectId] = (perProject[i.projectId] || 0) + 1;

  const viewQ = String(query.view || "");
  const projectQ = String(query.project || "all");
  const scoped = projectQ === "all" ? items : items.filter((i) => i.projectId === hubProjectId(projectQ));
  let base = scoped;
  if (viewQ === "trash") base = trash;
  else if (VIEWS[viewQ]) base = items.filter((i) => VIEWS[viewQ].test(i, now));
  const filtered = sortItems(base.filter((i) => matchesFilter(i, query, now)), query.sort).map(stripPublicAsset);
  const statusCounts = Object.fromEntries(STATUSES.map((x) => [x, 0]));
  const typeCounts = {};
  for (const i of scoped) { statusCounts[i.status] = (statusCounts[i.status] || 0) + 1; typeCounts[i.kind] = (typeCounts[i.kind] || 0) + 1; }
  const tagSet = new Set(PRESET_TAGS);
  for (const i of items) for (const t of i.tags || []) tagSet.add(t);
  const sources = [...new Set(items.map((i) => i.source).filter(Boolean))].sort();
  const endingAll = items.filter((i) => needsAnEnding(i)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const needsEnding = endingAll.slice(0, 12).map(stripPublicAsset);
  const viewCounts = Object.fromEntries(Object.entries(VIEWS).map(([k, v]) => [k, items.filter((i) => v.test(i, now)).length]));
  viewCounts.trash = trash.length;
  return {
    total: items.length,
    filteredTotal: filtered.length,
    items: filtered,
    projects: [
      { id: UNFILED, name: "Unfiled", count: perProject[UNFILED] || 0 },
      ...projects.map((p) => ({ id: p.id, name: p.name || p.id, count: perProject[p.id] || 0 })),
    ],
    unfiledCount: perProject[UNFILED] || 0,
    statuses: STATUSES, statusCounts, typeCounts, sources,
    tags: [...tagSet],
    needsEnding, needsEndingTotal: endingAll.length,
    views: Object.entries(VIEWS).map(([id, v]) => ({ id, label: v.label, count: viewCounts[id] })).concat([{ id: "trash", label: "Trash", count: trash.length }]),
    trashDays: TRASH_DAYS,
    pending: pendingJobs(),
  };
}

// Put something back from the Trash. Works for anything deleted in the last 30 days.
export function restoreFromTrash(projectId, assetId) {
  const { id: pid } = assertProject(hubProjectId(projectId));
  const state = mediaDoc();
  const cur = getAssetMeta(state, pid, String(assetId));
  if (!cur.deleted) { const err = new Error("That item is not in the Trash."); err.status = 404; throw err; }
  setAssetMeta(state, pid, String(assetId), { deleted: false, kept: true });
  saveMediaDoc(state);
  return { ok: true, projectId: pid, assetId: String(assetId) };
}

// A result "needs an ending" when nothing has been done with it: still a Draft, never sent anywhere,
// not kept on purpose, and made by Meldmind (not a file the person uploaded).
function needsAnEnding(i) {
  if (i.kept || i.isUpload || i.isLink) return false;
  if (i.status !== "Draft") return false;
  if ((i.destinations || []).length) return false;
  if ((i.usage || []).length) return false;
  return true;
}

// Keep, Publish (handled by the publish route), Discard on the "Needs an ending" shelf.
export function endingAction(projectId, assetId, action) {
  const { id: pid } = assertProject(hubProjectId(projectId));
  const state = mediaDoc();
  if (action === "keep") setAssetMeta(state, pid, String(assetId), { kept: true });
  else if (action === "discard") setAssetMeta(state, pid, String(assetId), { deleted: true });
  else { const err = new Error("Choose keep or discard."); err.status = 400; throw err; }
  saveMediaDoc(state);
  return { ok: true, action, projectId: pid, assetId };
}

// Promote an item (usually from Unfiled) into a project. Saved files and generations move in place;
// anything else becomes a link, so no file is ever copied or broken.
export function moveToProject(projectId, assetId, targetProjectId, { link = false } = {}) {
  const from = hubProjectId(projectId);
  const to = hubProjectId(targetProjectId);
  if (from === to) return { ok: true, mode: "same", projectId: to, assetId };
  const state = mediaDoc();
  const aid = String(assetId);
  if (aid.startsWith("upload:")) {
    const up = state.uploads.find((u) => `upload:${u.id}` === aid && hubProjectId(u.projectId) === from);
    if (up) {
      const old = metaKey(from, aid), nu = metaKey(to, aid);
      if (state.meta[old]) { state.meta[nu] = state.meta[old]; delete state.meta[old]; }
      up.projectId = to;
      saveMediaDoc(state);
      return { ok: true, mode: "moved", projectId: to, assetId: aid };
    }
  }
  const m = /^job:(.+):(\d+)$/.exec(aid);
  if (m) {
    const jd = jobsDoc();
    const job = jd.items.find((j) => j.id === m[1] && hubProjectId(j.projectId) === from);
    if (job) {
      const old = metaKey(from, aid), nu = metaKey(to, aid);
      if (state.meta[old]) { state.meta[nu] = state.meta[old]; delete state.meta[old]; saveMediaDoc(state); }
      job.projectId = to === UNFILED ? null : to;
      saveJobsDoc(jd);
      return { ok: true, mode: "moved", projectId: to, assetId: aid };
    }
  }
  // This kind of item lives in its first project's folder, so it cannot move. Linking shows it in both places
  // and leaves the original where it is. That only happens when the person agrees (link: true).
  if (!link) {
    const err = new Error("This item stays in its first project. You can link it into the other project instead (it then shows in both places).");
    err.status = 409; err.code = "link_needed";
    throw err;
  }
  const linked = linkAssetToProject({ sourceProjectId: from, assetId: aid, targetProjectId: to });
  return { ok: true, mode: "linked", projectId: to, assetId: linked.asset?.id || aid };
}

// What the publish routes need: a stored item resolved to a local file (and its text, for text items).
export function assetForPublish(projectId, assetId) {
  const pid = hubProjectId(projectId);
  const found = indexProjectMedia(pid).find((a) => a.id === String(assetId || ""));
  if (!found) return null;
  const st = found.filePath ? safeStat(found.filePath) : null;
  let text = "";
  if (found.kind === "text" && st) { try { text = fs.readFileSync(st.path, "utf8"); } catch { text = ""; } }
  return { projectId: pid, assetId: found.id, name: found.name, kind: found.kind, mime: found.mime, file: st?.path || null, text, remote: found.provider === "remote" ? found.filePath : null, publicUrl: found.publicUrl || "" };
}

// Publish writes its result back to the item: destination (with link and time), status Published
// after a real post, and the "Posted" usage badge. A practice run records the destination only.
export function recordPublishResult({ projectId, assetId, mediaJobId, entry }) {
  const state = mediaDoc();
  const ref = [];
  if (assetId) ref.push([hubProjectId(projectId), String(assetId)]);
  if (mediaJobId) {
    const job = (jobsDoc().items || []).find((j) => j.id === mediaJobId);
    if (job) ref.push([hubProjectId(job.projectId), `job:${job.id}:0`]);
  }
  if (!ref.length) return 0;
  const label = { instagram: "Instagram", ghl: "HighLevel", slack: "Slack", drive: "Google Drive" }[entry.channel] || entry.channel;
  const link = /^https?:\/\//.test(entry.result?.url || entry.result?.link || "") ? (entry.result.url || entry.result.link) : "";
  const dest = {
    channel: entry.channel,
    label: entry.status === "dry-run" ? `${label} (practice, nothing sent)` : entry.status === "failed" ? `${label} (did not send)` : label,
    link, status: entry.status, at: entry.ts || Date.now(),
  };
  for (const [pid, aid] of ref) {
    const patch = { addDestination: dest };
    if (entry.status === "posted") { patch.status = "Published"; patch.addUsage = { kind: "posted", label: `Posted to ${label}`, targetId: entry.id }; }
    setAssetMeta(state, pid, aid, patch);
  }
  saveMediaDoc(state);
  return ref.length;
}

// "Host this file" (0.4.21): Instagram and HighLevel need a public https link for a picture or video. Meldmind never
// uploads on its own. The person shares the file from their own Google Drive ("Anyone with the link") and pastes
// the link; a Drive share link is turned into the direct form those places can read.
export function hostedUrlFromShare(link) {
  const raw = String(link || "").trim();
  let u;
  try { u = new URL(raw); } catch { return ""; }
  if (u.protocol !== "https:" || u.username || u.password) return "";
  if (u.hostname === "drive.google.com" || u.hostname === "docs.google.com") {
    const m = /\/d\/([\w-]{10,})/.exec(u.pathname) || null;
    const id = m ? m[1] : u.searchParams.get("id");
    if (!id || !/^[\w-]{10,}$/.test(id)) return "";
    return `https://drive.google.com/uc?export=download&id=${id}`;
  }
  return u.href.slice(0, 500);
}
export function setHostedLink(projectId, assetId, link) {
  const { id: pid } = assertProject(hubProjectId(projectId));
  const url = hostedUrlFromShare(link);
  if (!url) {
    const err = new Error("That is not a link we can use. Share the file from Google Drive with \"Anyone with the link\", then paste the https link here.");
    err.status = 400;
    throw err;
  }
  const state = mediaDoc();
  setAssetMeta(state, pid, String(assetId), { publicUrl: url });
  saveMediaDoc(state);
  return { ok: true, projectId: pid, assetId: String(assetId), url };
}
