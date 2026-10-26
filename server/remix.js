// Remix any app (Phase 96).
// The person describes an app or a game they can see. Meldmind writes how it looks, plays, and works,
// then plans a new project from their own characters, art, and ideas.
// Free tools are named from this catalog only. Nothing is downloaded. A license check decides what
// may be used, and required credits go in a CREDITS file.
// Hard rule: never decompile, extract, or copy another app's code, assets, names, or brand.

import { decorateRemix, clearArt, applyReuseReport, importDesign, styleTokens } from "./remix-abilities.js";
import { makeLevel } from "./remix-wfc.js";

export const SCRATCH_NOTE = "Remix rebuilds from scratch. It does not copy the app or game you show. It does not decompile, extract, or reuse that app's code, assets, names, or brand.";

export const SOURCES = {
  url: {
    label: "A web address",
    detail: "You describe the page. Remix does not open the address.",
  },
  screenshots: {
    label: "Screenshots",
    detail: "You describe what is visible. Remix does not take assets out of the pictures.",
  },
  recording: {
    label: "A short screen recording",
    detail: "You describe what you saw. Remix does not pull frames or files out of the recording.",
  },
  desktop: {
    label: "An app on this computer",
    detail: "Observed only through what is visible on screen. Remix does not open the app's files.",
  },
};

export const CATALOG = [
  {
    id: "godot", name: "Godot Engine", kind: "engine", license: "MIT",
    url: "https://godotengine.org",
    credit: "Godot Engine, MIT License. https://godotengine.org",
    note: "Engine. A new project, not a copy of the game you showed.",
    defaultFor: ["game"],
  },
  {
    id: "phaser", name: "Phaser", kind: "engine", license: "MIT",
    url: "https://github.com/phaserjs/phaser",
    credit: "Phaser, MIT License. https://github.com/phaserjs/phaser",
    note: "Engine for a browser game. A new project.",
    defaultFor: ["game"],
  },
  {
    id: "kenney-cc0", name: "Kenney Game Assets", kind: "art", license: "CC0-1.0",
    url: "https://kenney.nl",
    credit: "Kenney, CC0. https://kenney.nl",
    note: "Free art pack. Credit is not required. The name stays in CREDITS so the source is clear.",
    defaultFor: ["game"],
  },
  {
    id: "scratch-page", name: "Blank page template", kind: "template", license: "MIT",
    url: "",
    credit: "Blank page template, MIT License. Written for this remix. Not taken from the app you showed.",
    note: "A starter written here.",
    defaultFor: ["app", "tool"],
  },
];

export const MOD_TOOLS = [
  { id: "minecraft", name: "Minecraft", tool: "Minecraft's own data packs and mod tools", note: "Use Minecraft's own mod tools. Rebuild the idea. Leave the game's files alone." },
  { id: "roblox", name: "Roblox", tool: "Roblox Studio", note: "Build in Roblox Studio. Use your own name and your own assets." },
  { id: "godot", name: "Godot", tool: "the Godot editor", note: "Start a new Godot project in the editor." },
  { id: "unity", name: "Unity", tool: "the Unity Editor", note: "Use the Unity Editor and its official packages. Leave other games' files alone." },
];

const ALLOWED = {};
const REJECTED = {};
function allow(spdx, credit, ...keys) {
  const row = { spdx, credit: !!credit };
  for (const k of keys) ALLOWED[k] = row;
}
function ban(...keys) { for (const k of keys) REJECTED[k] = true; }

allow("MIT", true, "mit");
allow("Apache-2.0", true, "apache-2.0", "apache-2", "apache2");
allow("BSD-2-Clause", true, "bsd-2-clause", "bsd-2");
allow("BSD-3-Clause", true, "bsd-3-clause", "bsd-3");
allow("ISC", true, "isc");
allow("Zlib", true, "zlib", "zlib-libpng");
allow("MPL-2.0", true, "mpl-2.0", "mpl-2");
allow("CC0-1.0", false, "cc0", "cc0-1.0", "cc-0");
allow("CC-BY-4.0", true, "cc-by", "cc-by-4.0");
allow("CC-BY-3.0", true, "cc-by-3.0");
allow("CC-BY-SA-4.0", true, "cc-by-sa", "cc-by-sa-4.0");
allow("Unlicense", false, "unlicense");
allow("0BSD", false, "0bsd", "bsd-0");
allow("OFL-1.1", true, "ofl-1.1", "ofl", "sil-ofl-1.1");
allow("BSL-1.0", true, "bsl-1.0", "boost", "boost-1.0");

ban(
  "gpl", "gpl-2.0", "gpl-2", "gpl-3.0", "gpl-3", "gplv2", "gplv3",
  "gpl-2.0-only", "gpl-3.0-only", "gpl-3.0-or-later",
  "agpl", "agpl-3.0", "agpl-3.0-only",
  "lgpl", "lgpl-2.1", "lgpl-3.0",
  "cc-by-nc", "cc-by-nc-4.0", "cc-by-nc-sa", "cc-by-nc-sa-4.0",
  "cc-by-nd", "cc-by-nd-4.0",
  "proprietary", "all-rights-reserved", "commercial", "sspl", "unlicensed", "closed",
);

const DUMPED = ["image", "images", "video", "recordingFile", "binary", "bytes", "asset", "assets", "apk", "ipa"];
const NOT_BEFORE = String.raw`(?<!\b(?:do not|does not|don't|never|not)\s)`;
const BAD = [
  new RegExp(`${NOT_BEFORE}\\bdecompile\\b`, "i"),
  new RegExp(`${NOT_BEFORE}\\bdisassembl`, "i"),
  new RegExp(`${NOT_BEFORE}\\breverse[\\s-]?engineer`, "i"),
  new RegExp(`${NOT_BEFORE}\\bunpack(?:ing)?\\b`, "i"),
  new RegExp(`${NOT_BEFORE}\\basset\\s*rip`, "i"),
  new RegExp(`${NOT_BEFORE}\\b(?:il2cpp|dnspy|jadx|apktool|assetstudio|ghidra)\\b`, "i"),
  new RegExp(`${NOT_BEFORE}\\brip(?:ping)?\\s+(?:the\\s+|their\\s+)?(?:assets|sprites|art|textures|code|audio|files)\\b`, "i"),
  new RegExp(`${NOT_BEFORE}\\bextract(?:ing)?\\s+(?:the\\s+|their\\s+)?(?:assets|code|files|resources|sprites|textures|binary|audio)\\b`, "i"),
  new RegExp(`${NOT_BEFORE}\\bcopy(?:ing)?\\s+(?:the\\s+|their\\s+|its\\s+)?(?:code|source|assets|sprites|art|logo|brand|name|files|app|game)\\b`, "i"),
  new RegExp(`${NOT_BEFORE}\\bclone\\s+(?:the\\s+)?(?:app|game|brand|code|ui|interface)\\b`, "i"),
  new RegExp(`${NOT_BEFORE}\\breuse\\s+(?:their|the|its)\\s+(?:logo|brand|assets|code|name|sprites|art)\\b`, "i"),
  /\.(?:apk|ipa|dll|exe|unity3d|assetbundle|pak|dex)\b/i,
];

const LOOK_STOP = new Set(["their", "there", "about", "which", "would", "could", "should", "screen", "button", "color", "colour", "large", "small", "round", "bright", "score", "level", "board", "game", "play", "looks", "works", "other", "every"]);

function fail(code, error) { return { ok: false, code, error }; }
function clip(s, n) { return String(s ?? "").slice(0, n); }
function normLic(raw) {
  let s = String(raw || "").trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/[_\s]+/g, "-").replace(/[^a-z0-9.+-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return s.replace(/-license$/, "");
}
function splitLicense(raw) {
  const s = String(raw || "").trim();
  if (!s) return [];
  return s.split(/\s+(?:OR|AND)\s+|\s*\/\s*/i).map((x) => x.trim()).filter(Boolean);
}
function resolveOne(raw) {
  const key = normLic(raw);
  if (!key) return { ok: false, reason: "license missing" };
  if (REJECTED[key]) return { ok: false, reason: "not free to use" };
  const hit = ALLOWED[key];
  if (!hit) return { ok: false, reason: "not free to use" };
  return { ok: true, spdx: hit.spdx, creditRequired: hit.credit };
}
function escapeReg(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function normName(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function namesClose(a, b) {
  const x = normName(a), y = normName(b);
  if (!x || !y) return false;
  if (x === y) return x.length >= 3;
  if (x.length >= 5 && y.length >= 5 && (x.includes(y) || y.includes(x))) return true;
  return false;
}
function nameParts(s) {
  return String(s || "").split(/,|\/|&|\band\b/i).map((x) => x.trim()).filter((x) => x.length >= 3);
}
function lookWords(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((w) => w.length >= 5 && !LOOK_STOP.has(w));
}
function lookClose(a, b) {
  const A = new Set(lookWords(a));
  const shared = [...new Set(lookWords(b).filter((w) => A.has(w)))];
  return shared.length >= 2;
}
function collectText(v, parts) {
  if (typeof v === "string") parts.push(v);
  else if (Array.isArray(v)) for (const x of v) collectText(x, parts);
  else if (v && typeof v === "object") for (const x of Object.values(v)) collectText(x, parts);
}
function dumpedFile(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  return DUMPED.some((k) => raw[k] != null && raw[k] !== "" && raw[k] !== false);
}
function redactSecrets(text) {
  return String(text || "")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|xai-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{8,}|ghp_[A-Za-z0-9]{8,})\b/g, "[key hidden]");
}
export function scrub(text, hidden = []) {
  let s = redactSecrets(text);
  const seen = new Set();
  for (const name of hidden) {
    const n = String(name || "").trim();
    const key = n.toLowerCase();
    if (n.length < 3 || seen.has(key)) continue;
    seen.add(key);
    s = s.replace(new RegExp(escapeReg(n), "gi"), "the original");
  }
  s = s.replace(/https?:\/\/\S+/gi, "[link not sent]");
  return s.replace(/[ \t]+\n/g, "\n").trim();
}
function cleanId(s, max) {
  const v = clip(s, max).trim();
  if (!v) return "";
  if (/sk-|xai-|AIza|ghp_|secret|api[_-]?key/i.test(v)) return "";
  if (!/^[A-Za-z0-9._:@+-]+$/.test(v)) return "";
  return v;
}

export function checkLicense(item = {}) {
  const name = clip(item.name, 120).trim();
  const parts = splitLicense(item.license || item.spdx || "");
  if (!parts.length) return { ok: false, name, spdx: null, creditRequired: false, credit: "", url: "", reason: "license missing" };
  const checked = parts.map(resolveOne);
  if (checked.some((c) => !c.ok)) {
    return { ok: false, name, spdx: null, creditRequired: false, credit: "", url: "", reason: checked.find((c) => !c.ok).reason };
  }
  const spdx = checked.map((c) => c.spdx).join(" OR ");
  const creditRequired = checked.some((c) => c.creditRequired);
  const url = clip(item.url, 200).trim();
  const given = clip(item.credit, 300).trim();
  const credit = creditRequired ? (given || [name || "Unnamed", spdx, url].filter(Boolean).join(". ")) : given;
  return {
    ok: true,
    id: clip(item.id, 40).trim(),
    name: name || "Unnamed",
    kind: clip(item.kind || "code", 40).trim() || "code",
    spdx, url, creditRequired, credit, reason: null,
  };
}

export function creditsText(items, notes) {
  const used = (items || []).filter((i) => i && i.ok);
  const extra = (notes || []).map((n) => String(n || "").trim()).filter(Boolean);
  const lines = [
    "# Credits",
    "",
    SCRATCH_NOTE,
    "",
    "Nothing here is copied from the app or game that was shown.",
    "",
  ];
  if (!used.length && !extra.length) {
    lines.push("No outside code, engine, template, or art pack was used.");
    lines.push("");
    return lines.join("\n");
  }
  if (!used.length) lines.push("No outside code, engine, template, or art pack was used.", "");
  else {
  lines.push("## Outside pieces that passed the license check", "");
  for (const item of used) {
    lines.push(`- ${item.name}`);
    lines.push(`  Kind: ${item.kind || "code"}`);
    lines.push(`  License: ${item.spdx}`);
    if (item.url) lines.push(`  Source: ${item.url}`);
    if (item.creditRequired) lines.push(`  Required credit: ${item.credit}`);
    else {
      lines.push("  Required credit: none. Listed so the source stays clear.");
      if (item.credit) lines.push(`  Credit: ${item.credit}`);
    }
    lines.push("");
  }
  }
  if (extra.length) {
    lines.push("## Named tools that are not copied", "");
    for (const note of extra) lines.push(`- ${note}`, "");
  }
  return lines.join("\n");
}

export function noCopyGuard(raw) {
  if (dumpedFile(raw)) return { ok: false, message: SCRATCH_NOTE };
  const parts = [];
  if (typeof raw === "string") parts.push(raw);
  else collectText(raw, parts);
  const text = parts.join("\n").slice(0, 20000);
  if (/data:(?:image|video|application)\//i.test(text.slice(0, 8000))) return { ok: false, message: SCRATCH_NOTE };
  if (BAD.some((re) => re.test(text))) return { ok: false, message: SCRATCH_NOTE };
  return { ok: true, message: "" };
}

export function closeness(input = {}) {
  const warnings = [];
  const own = input.own || {};
  if (namesClose(own.name, input.originalName)) warnings.push("The new name matches the name you typed for the original.");
  const originals = nameParts(input.originalCharacters);
  const next = nameParts(own.characters);
  if (originals.some((a) => next.some((b) => namesClose(a, b)))) warnings.push("A character name matches the original.");
  if (input.originalLook && lookClose(input.originalLook, own.look)) warnings.push("The look and layout are very close to the original.");
  return { close: warnings.length > 0, warnings };
}

function normalize(raw) {
  const body = raw && typeof raw === "object" ? raw : {};
  const source = clip(body.source, 40).trim();
  if (!SOURCES[source]) return fail("source", "Show a URL, screenshots, a short recording, or an app on this computer.");
  const appType = clip(body.appType, 20).trim();
  if (!["game", "app", "tool"].includes(appType)) return fail("appType", "Pick game, app, or tool.");
  const looks = clip(body.looks, 2000).trim();
  const plays = clip(body.plays, 2000).trim();
  const works = clip(body.works, 2000).trim();
  if (!looks && !plays && !works) return fail("describe", "Describe how it looks, plays, or works. Remix only uses what you can see.");
  const ownIn = body.own && typeof body.own === "object" ? body.own : {};
  const own = {
    name: clip(ownIn.name, 80).trim(),
    characters: clip(ownIn.characters, 500).trim(),
    look: clip(ownIn.look, 500).trim(),
    ideas: clip(ownIn.ideas, 1000).trim(),
    art: clip(ownIn.art, 500).trim(),
  };
  if (!own.name) return fail("name", "Give it your own name. Remix does not keep the original name.");
  let engineId = clip(body.engineId, 40).trim();
  if (engineId && engineId !== "none" && !CATALOG.some((c) => c.id === engineId && (c.kind === "engine" || c.kind === "template"))) {
    return fail("engine", "Pick a tool from the list.");
  }
  let packIds = null;
  if (Array.isArray(body.packIds)) {
    packIds = [];
    for (const id of body.packIds.slice(0, 12)) {
      const clean = clip(id, 40).trim();
      if (!clean) continue;
      if (!CATALOG.some((c) => c.id === clean)) return fail("pack", "Pick art and templates from the list.");
      if (!packIds.includes(clean)) packIds.push(clean);
    }
  }
  const modId = clip(body.modId, 40).trim();
  if (modId && !MOD_TOOLS.some((m) => m.id === modId)) return fail("mod", "Pick an official mod tool from the list.");
  const start = clip(body.start, 20).trim();
  if (start && !["screenshot", "recording", "design", "game", "description"].includes(start)) {
    return fail("start", "Choose a screenshot, a recording, your design file, a game type, or a description.");
  }
  const voice = clip(body.voice, 20).trim();
  if (voice && voice !== "piper" && voice !== "coqui") return fail("voice", "Choose Piper or Coqui, or leave the voice off.");
  const installer = clip(body.installer, 20).trim();
  if (installer && installer !== "tauri" && installer !== "electron") return fail("installer", "Choose a desktop installer, or skip it.");
  const designText = clip(body.designText, 20000);
  const design = importDesign(designText);
  if (!design.ok) return fail("design", design.error);
  const blendIn = body.blend && typeof body.blend === "object" ? body.blend : null;
  const blend = blendIn ? {
    name: clip(blendIn.name, 80).trim(),
    looks: clip(blendIn.looks, 1000).trim(),
    ideas: clip(blendIn.ideas, 1000).trim(),
  } : null;
  const artFiles = [];
  if (Array.isArray(body.artFiles)) {
    for (const file of body.artFiles.slice(0, 40)) {
      if (!file || typeof file !== "object") continue;
      artFiles.push({
        name: clip(file.name, 120).trim(),
        source: clip(file.source, 40).trim(),
        license: clip(file.license, 40).trim(),
      });
    }
  }
  const pulls = [];
  if (Array.isArray(body.pulls)) {
    for (const p of body.pulls.slice(0, 12)) {
      if (!p || typeof p !== "object") continue;
      pulls.push({
        name: clip(p.name, 120).trim(),
        license: clip(p.license, 80).trim(),
        url: clip(p.url, 200).trim(),
        credit: clip(p.credit, 300).trim(),
        kind: clip(p.kind || "code", 40).trim() || "code",
      });
    }
  }
  return {
    ok: true,
    value: {
      source, appType, looks, plays, works, own, engineId, packIds, modId, pulls,
      start, voice, installer, design, designText: designText.trim(),
      usePhaser: body.usePhaser === true, useBevy: body.useBevy === true,
      levels: body.levels === true, styleOnly: body.styleOnly === true, fork: body.fork === true,
      multiplayer: body.multiplayer === true,
      blend: blend?.name ? blend : null,
      artFiles, reuseReport: clip(body.reuseReport, 8000),
      originalName: clip(body.originalName, 80).trim(),
      originalCharacters: clip(body.originalCharacters, 300).trim(),
      originalLook: clip(body.originalLook, 500).trim(),
      url: clip(body.url, 300).trim(),
    },
  };
}

function chooseEngine(input, learned) {
  if (input.engineId === "none") return { ok: true, item: null };
  if (input.engineId) {
    const hit = CATALOG.find((c) => c.id === input.engineId);
    return hit ? { ok: true, item: hit } : fail("engine", "Pick a tool from the list.");
  }
  const learnedHit = CATALOG.find((c) => c.id === learned?.engineId && (c.kind === "engine" || c.kind === "template"));
  if (learnedHit) return { ok: true, item: learnedHit };
  const id = input.appType === "game" ? "godot" : "scratch-page";
  return { ok: true, item: CATALOG.find((c) => c.id === id) || null };
}

export function planRemix(raw, { learned } = {}) {
  const copy = noCopyGuard(raw);
  if (!copy.ok) return fail("no_copy", copy.message);
  const norm = normalize(raw);
  if (!norm.ok) return norm;
  const input = norm.value;
  const picked = chooseEngine(input, learned);
  if (!picked.ok) return picked;
  const packIds = input.packIds === null
    ? (input.appType === "game" ? ["kenney-cc0"] : [])
    : input.packIds;
  const chosen = [];
  if (picked.item) chosen.push(picked.item);
  for (const id of packIds) {
    const item = CATALOG.find((c) => c.id === id);
    if (item && !chosen.some((c) => c.id === item.id)) chosen.push(item);
  }
  const pieces = [];
  const rejected = [];
  for (const item of chosen) {
    const checked = checkLicense(item);
    if (checked.ok) pieces.push(checked);
    else rejected.push({ name: checked.name, reason: checked.reason });
  }
  for (const pull of input.pulls) {
    if (input.originalName && namesClose(pull.name, input.originalName)) {
      rejected.push({ name: pull.name || "Unnamed", reason: "That name matches the original. It was not used." });
      continue;
    }
    const checked = checkLicense(pull);
    if (!checked.ok) rejected.push({ name: checked.name || "Unnamed", reason: checked.reason === "license missing" ? "license missing" : "not free to use" });
    else pieces.push(checked);
  }
  const hidden = [input.originalName, ...nameParts(input.originalCharacters)].filter(Boolean);
  const own = {
    name: scrub(input.own.name, hidden).replace(/\s+/g, " ").trim().slice(0, 80) || "My remix",
    characters: scrub(input.own.characters, hidden),
    look: scrub(input.own.look, hidden),
    ideas: scrub(input.own.ideas, hidden),
    art: scrub(input.own.art, hidden),
  };
  const source = SOURCES[input.source];
  const description = {
    source: input.source,
    sourceLabel: source.label,
    observed: source.detail,
    filesRead: false,
    addressSent: false,
    looks: scrub(input.looks, hidden) || "Not described.",
    plays: scrub(input.plays, hidden) || "Not described.",
    works: scrub(input.works, hidden) || "Not described.",
  };
  const mod = input.modId ? MOD_TOOLS.find((m) => m.id === input.modId) : null;
  const near = closeness(input);
  const projectName = clip(input.own.name, 80).trim() || "My remix";
  const decorated = decorateRemix(input, picked.item?.id || "");
  const cleared = clearArt(input.artFiles);
  const reused = applyReuseReport(cleared.kept, input.reuseReport);
  for (const file of reused.kept) {
    const checked = checkLicense({ name: file.name, license: file.license, url: file.url, credit: file.credit, kind: "art" });
    if (checked.ok) pieces.push(checked);
    else rejected.push({ name: file.name, reason: "not cleared" });
  }
  for (const file of [...cleared.rejected, ...reused.rejected]) rejected.push({ name: file.name, reason: file.reason || "not cleared" });
  if ((input.artFiles || []).length) {
    decorated.notes.push(reused.reuseRan
      ? "The FSFE reuse tool report was applied. It runs as its own program and is not part of Meldmind."
      : "The external license tool was not run. Only CC0 files from Kenney and OpenGameArt were kept.");
  }
  const design = input.design?.empty ? null : {
    shapes: input.design?.shapes || 0,
    texts: (input.design?.texts || []).map((t) => scrub(t, hidden)).filter(Boolean),
    note: input.design?.note || "",
  };
  const blend = input.blend ? {
    name: scrub(input.blend.name, hidden).replace(/\s+/g, " ").trim().slice(0, 80),
    looks: scrub(input.blend.looks, hidden),
    ideas: scrub(input.blend.ideas, hidden),
  } : null;
  if (blend?.name && namesClose(input.blend.name, input.originalName)) {
    near.warnings.push("The second name matches the name you typed for the original.");
    near.close = true;
  }
  let level = null;
  if (input.levels) {
    let seed = 1;
    for (const c of projectName) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619) >>> 0;
    level = makeLevel({ seed: seed || 1 });
  }
  const style = input.styleOnly ? styleTokens() : null;
  const steps = [
    "Write how it looks, plays, and works from what you could see.",
    "Plan a new project with your characters, art, and ideas.",
    "Use only the free tools that passed the license check.",
    "Keep the required credits in the CREDITS file.",
    "Build it from scratch.",
  ];
  if (mod) steps.push(`Use ${mod.tool}. ${mod.note}`);
  if (own.art) steps.push("Turn your own art into sprites, models, or voices only when you ask. Media shows a price first and waits for Approve.");
  const toolLines = pieces.map((p) => `- ${p.name} (${p.spdx})`);
  const goal = [
    "Rebuild this as a new project from scratch.",
    SCRATCH_NOTE,
    "Do not decompile, extract, or unpack anything. Do not copy code, assets, names, or brand.",
    "",
    `The person's own name: ${own.name}`,
    own.characters ? `Their characters: ${own.characters}` : "",
    own.look ? `Their look: ${own.look}` : "",
    own.ideas ? `Their ideas: ${own.ideas}` : "",
    own.art ? `Their art: ${own.art}` : "",
    "",
    "What they could see:",
    `Looks: ${description.looks}`,
    `Plays: ${description.plays}`,
    `Works: ${description.works}`,
    "",
    toolLines.length ? "Free tools that passed the license check:\n" + toolLines.join("\n") : "No outside tool passed the license check. Use only their ideas.",
    mod ? `Official mod tool: ${mod.tool}. ${mod.note}` : "",
    blend?.name ? `Second idea: ${blend.name}. ${blend.looks || ""} ${blend.ideas || ""}`.trim() : "",
    input.styleOnly ? "Change colors and type only. Do not copy a layout." : "",
    input.levels ? "Add new levels from the level maker in this app." : "",
    "",
    "Write a short build plan, the screens, and a first playable or usable slice. Keep the credits.",
  ].filter((line) => line !== "").join("\n").slice(0, 4000);
  const summary = [
    SCRATCH_NOTE,
    `Your name: ${own.name}`,
    own.characters ? `Your characters: ${own.characters}` : "",
    own.look ? `Your look: ${own.look}` : "",
    own.ideas ? `Your ideas: ${own.ideas}` : "",
    own.art ? `Your art: ${own.art}` : "",
    `Looks: ${description.looks}`,
    `Plays: ${description.plays}`,
    `Works: ${description.works}`,
    mod ? `Official mod tool: ${mod.tool}` : "",
  ].filter(Boolean).join("\n").slice(0, 1200);
  return {
    ok: true,
    code: null,
    error: null,
    scratchNote: SCRATCH_NOTE,
    appType: input.appType,
    sourceKind: input.source,
    description,
    pieces,
    rejected,
    mod: mod ? { id: mod.id, name: mod.name, tool: mod.tool, note: mod.note } : null,
    creditsText: creditsText(pieces, decorated.notes),
    goal,
    steps,
    closeness: near,
    projectName,
    summary,
    start: input.start || "",
    abilityIds: decorated.ids,
    design,
    blend,
    level,
    styleTokens: style,
    styleOnly: !!input.styleOnly,
    voice: input.voice || "",
    installer: input.installer || "",
    multiplayer: !!input.multiplayer,
    engineId: picked.item?.id || "",
    packIds: packIds.filter((id) => id !== picked.item?.id),
    modId: mod?.id || "",
  };
}

export function recipients({ models = [], source } = {}) {
  const src = SOURCES[source] || null;
  const ais = (models || []).slice(0, 4).map((m) => ({
    provider: m.provider || "",
    providerName: m.providerName || m.provider || "AI",
    model: m.model || "",
    name: m.name || m.model || "AI",
    receives: "The words you typed: how it looks, plays, and works, plus your name, characters, art, and ideas.",
  }));
  return {
    ran: false,
    scratchNote: SCRATCH_NOTE,
    ais,
    services: [
      { id: "this-computer", name: "This computer", receives: "The new project and the CREDITS file, after you click Rebuild from scratch." },
    ],
    withheld: [
      src?.detail || "Only the words you type can be sent.",
      "The web address is not opened and is not sent.",
      "Installed app files are not opened.",
      "Screenshot and recording files are not uploaded.",
      "Nothing is posted.",
    ],
  };
}

export function publicRun(r = {}) {
  const appType = ["game", "app", "tool"].includes(r.appType) ? r.appType : "app";
  const sourceKind = SOURCES[r.sourceKind] ? r.sourceKind : "";
  const engineId = CATALOG.some((c) => c.id === r.engineId) ? r.engineId : "";
  const packIds = Array.isArray(r.packIds)
    ? r.packIds.filter((id) => CATALOG.some((c) => c.id === id)).slice(0, 12)
    : [];
  const modId = MOD_TOOLS.some((m) => m.id === r.modId) ? r.modId : "";
  const projectId = /^remix-[a-z0-9]+$/.test(String(r.projectId || "")) ? String(r.projectId) : "";
  return {
    id: cleanId(r.id, 40),
    ts: Number(r.ts) || 0,
    appType,
    sourceKind,
    engineId,
    packIds,
    modId,
    provider: cleanId(r.provider, 60),
    model: cleanId(r.model, 80),
    projectId,
    missionStarted: !!r.missionStarted,
    rating: r.rating === "up" || r.rating === "down" ? r.rating : null,
    fix: !!r.fix,
    ...(/^[a-z0-9][a-z0-9-]{0,80}$/.test(String(r.workingProjectId || "")) ? { workingProjectId: String(r.workingProjectId) } : {}),
  };
}

function tally(rows, key) {
  const bag = new Map();
  for (const r of rows) {
    if (r.rating !== "up" && r.rating !== "down" && !r.fix) continue;
    const id = r[key];
    if (!id) continue;
    const row = bag.get(id) || { id, score: 0, n: 0 };
    row.n += 1;
    if (r.rating === "up") row.score += 2;
    else if (r.rating === "down") row.score -= 2;
    if (r.fix) row.score -= 1;
    bag.set(id, row);
  }
  return [...bag.values()].sort((a, b) => b.score - a.score || b.n - a.n)[0]?.id || "";
}

export function suggest(items, appType = "game") {
  const type = ["game", "app", "tool"].includes(appType) ? appType : "game";
  const rows = (items || []).map(publicRun).filter((r) => r.appType === type);
  return {
    appType: type,
    engineId: tally(rows, "engineId"),
    provider: tally(rows, "provider"),
    model: tally(rows, "model"),
    sourceKind: tally(rows, "sourceKind"),
    samples: rows.length,
  };
}

export function library(items) {
  return ["game", "app", "tool"].map((appType) => suggest(items, appType));
}

export function shareTotals(items, { optedIn = false } = {}) {
  const bag = new Map();
  for (const raw of items || []) {
    const r = publicRun(raw);
    if (r.rating !== "up" && r.rating !== "down" && !r.fix) continue;
    const key = [r.appType, r.engineId, r.sourceKind, r.provider, r.model].join("|");
    const row = bag.get(key) || {
      appType: r.appType, engine: r.engineId, sourceKind: r.sourceKind,
      provider: r.provider, model: r.model, up: 0, down: 0, fixes: 0,
    };
    if (r.rating === "up") row.up += 1;
    else if (r.rating === "down") row.down += 1;
    if (r.fix) row.fixes += 1;
    bag.set(key, row);
  }
  return { optedIn: !!optedIn, sent: false, rows: [...bag.values()] };
}
