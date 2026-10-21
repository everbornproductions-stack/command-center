// Remix 2 abilities. Plain words in the app. Legal names stay in credits.
// Checked 2026-10-21:
// screenshot-to-code is MIT. Its video mode is the same project. Neither is copied.
// Penpot is MPL-2.0 and is not bundled. Godot demos and Kenney starter kits are MIT.
// Phaser the engine is MIT. @phaserjs/create-game is treated as unconfirmed and is not bundled.
// Bevy is Apache-2.0 OR MIT. Kenney art and OpenGameArt CC0 stay CC0-1.0.
// WaveFunctionCollapse (Maxim Gumin) is MIT. Levels here are original code.
// Piper (piper1-gpl) is GPL-3.0-or-later and runs only as its own program.
// Coqui TTS is MPL-2.0 and also runs as its own program.
// The FSFE reuse tool is GPL-3.0-or-later and runs only as its own program.
// Playwright is Apache-2.0. axe-core is MPL-2.0. pa11y is LGPL-3.0-only and stays a separate program.
// Vercel CLI is Apache-2.0. itch.io butler is MIT. Expo EAS CLI is MIT.
// Tauri is Apache-2.0 OR MIT. Electron Forge is MIT. Colyseus is MIT.
// Style Dictionary is Apache-2.0. isomorphic-git is MIT.
// Nothing here copies another app's code, assets, logos, or names.

import { spawn } from "node:child_process";

export const PHASER_COMMAND = ["npx", "@phaserjs/create-game@latest"];
export const PHASER_NOTE = "Phaser create-game runs through npx and is not bundled. Its license is unconfirmed, so its files are not copied.";
export const REUSE_COMMAND = ["reuse", "lint"];
export const REUSE_NOTE = "The FSFE reuse tool is GPL-3.0-or-later. It runs as its own program and is not part of Meldmind.";

export const ABILITIES = [
  { n: 1, id: "screenshot-ui", tier: "pro", plain: "A new layout from a screenshot", license: "MIT" },
  { n: 2, id: "recording-prototype", tier: "extreme", plain: "A clickable preview from a recording", license: "MIT" },
  { n: 3, id: "penpot-design", tier: "pro", plain: "Your design file", license: "MPL-2.0" },
  { n: 4, id: "godot-kenney", tier: "pro", plain: "A game starter", license: "MIT" },
  { n: 5, id: "phaser-create", tier: "pro", plain: "A browser game starter", license: "unconfirmed" },
  { n: 6, id: "bevy-starter", tier: "extreme", plain: "A desktop game starter", license: "Apache-2.0 OR MIT" },
  { n: 7, id: "cc0-art", tier: "pro", plain: "Free art that is cleared", license: "CC0-1.0" },
  { n: 8, id: "level-maker", tier: "extreme", plain: "New levels", license: "MIT" },
  { n: 9, id: "voices", tier: "extreme", plain: "A voice", license: "GPL-3.0-or-later" },
  { n: 10, id: "smoke-test", tier: "pro", plain: "A test that the page opens", license: "Apache-2.0" },
  { n: 11, id: "access-report", tier: "pro", plain: "A check that people can use it", license: "MPL-2.0" },
  {
    n: 12, id: "publish", tier: "pro", plain: "Publish",
    parts: [
      { id: "publish-web", tier: "pro", plain: "A website or an itch.io page" },
      { id: "publish-phone", tier: "extreme", plain: "A phone app" },
    ],
  },
  { n: 13, id: "installer", tier: "extreme", plain: "An installer", license: "Apache-2.0 OR MIT" },
  { n: 14, id: "multiplayer", tier: "extreme", plain: "Play together", license: "MIT" },
  {
    n: 15, id: "shape", tier: "pro", plain: "How it looks and how versions are kept",
    parts: [
      { id: "style-only", tier: "pro", plain: "Colors and type only" },
      { id: "blend", tier: "extreme", plain: "Blend two ideas" },
      { id: "forks", tier: "pro", plain: "Save a version" },
    ],
  },
];

export const PART_PLAIN = {};
for (const row of ABILITIES) {
  if (row.parts) for (const p of row.parts) PART_PLAIN[p.id] = p.plain;
  else PART_PLAIN[row.id] = row.plain;
}

export const STARTS = [
  { id: "screenshot", label: "A screenshot", detail: "A picture of a screen becomes a new layout.", ability: "screenshot-ui" },
  { id: "recording", label: "A recording", detail: "A recording becomes a clickable preview.", ability: "recording-prototype" },
  { id: "design", label: "Your design file", detail: "Bring in a design you made.", ability: "penpot-design" },
  { id: "game", label: "A game type", detail: "Start from a game shape, then make it yours.", ability: "godot-kenney" },
  { id: "description", label: "A description", detail: "Describe it in your own words.", ability: "" },
];

export const PUBLISH_TARGETS = {
  computer: { ability: "", plain: "This computer", bin: "", env: "" },
  vercel: { ability: "publish-web", plain: "A website", bin: "vercel", args: ["deploy"], env: "VERCEL_TOKEN", license: "Apache-2.0" },
  itch: { ability: "publish-web", plain: "itch.io", bin: "butler", args: ["push"], env: "BUTLER_API_KEY", license: "MIT" },
  phone: { ability: "publish-phone", plain: "A phone app", bin: "eas", args: ["build"], env: "EXPO_TOKEN", license: "MIT" },
};

const TOKEN_IDS = { vercel: "remix-vercel", itch: "remix-itch", phone: "remix-expo" };
export const publishVaultId = (target) => TOKEN_IDS[target] || "";

const NO_DOWNLOAD = new Set(["npx", "npm", "pnpm", "yarn", "pip", "pip3"]);

export function externalCommandAllowed() {
  if (process.env.CC_NET_TRACE === "1") return false;
  if (process.env.CI === "true" || process.env.CI === "1") return false;
  if (process.env.CC_REMIX_LIVE_TOOLS === "0") return false;
  return process.env.CC_REMIX_LIVE_TOOLS === "1";
}

function toolOnPath(bin) {
  return new Promise((resolve) => {
    const which = process.platform === "win32" ? "where" : "which";
    const child = spawn(which, [bin], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

// Live tools stay off unless CC_REMIX_LIVE_TOOLS=1. Tests set CC_NET_TRACE and never reach a real launch.
// npx, npm, and pip are never launched, so a package is never downloaded from here.
export async function runTool(bin, args = [], { live, spawnImpl, env } = {}) {
  const command = [bin, ...args];
  if (NO_DOWNLOAD.has(bin)) {
    return { ok: true, started: false, sent: false, command, reason: "That setup tool is not started from here, so nothing was downloaded." };
  }
  const allow = live === true || externalCommandAllowed();
  if (!allow) return { ok: true, started: false, sent: false, command, reason: "Not started in this check. Nothing was downloaded." };
  if (spawnImpl) {
    await spawnImpl(bin, args, env || {});
    return { ok: true, started: true, sent: false, command, reason: "Started on this computer. Nothing was posted by the check itself." };
  }
  if (!(await toolOnPath(bin))) {
    return { ok: true, started: false, sent: false, command, reason: "That program is not on this computer. Nothing was started." };
  }
  await new Promise((resolve) => {
    const child = spawn(bin, args, { env: { ...process.env, ...(env || {}) }, stdio: "ignore" });
    child.on("error", () => resolve());
    child.on("close", () => resolve());
  });
  return { ok: true, started: true, sent: false, command, reason: "The program was started on this computer." };
}

export function voiceCommand(kind) {
  if (kind === "piper") {
    return {
      kind, license: "GPL-3.0-or-later", external: true, gpl: true,
      command: ["piper", "--output_file", "voice.wav"],
      note: "Piper (piper1-gpl) is GPL-3.0-or-later. It runs as its own program and is not part of Meldmind.",
    };
  }
  if (kind === "coqui") {
    return {
      kind, license: "MPL-2.0", external: true, gpl: false,
      command: ["tts", "--out_path", "voice.wav"],
      note: "Coqui is MPL-2.0. It runs as its own program and is not bundled.",
    };
  }
  return null;
}

function artLicense(raw) {
  const s = String(raw || "").trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (s === "cc0" || s === "cc0-1.0" || s === "cc-0") return "CC0-1.0";
  return "";
}

export function clearArt(files = []) {
  const kept = [];
  const rejected = [];
  for (const file of (files || []).slice(0, 40)) {
    const name = String(file?.name || "").trim().slice(0, 120);
    const source = String(file?.source || "").trim().toLowerCase();
    if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) {
      rejected.push({ name: name || "Unnamed file", reason: "not cleared" });
      continue;
    }
    if (source !== "kenney" && source !== "opengameart") {
      rejected.push({ name, reason: "not cleared" });
      continue;
    }
    const license = artLicense(file?.license);
    if (!license) {
      rejected.push({ name, reason: "not cleared" });
      continue;
    }
    kept.push({
      name, source, license, kind: "art",
      credit: `${name} from ${source === "kenney" ? "Kenney" : "OpenGameArt"}, CC0.`,
      url: source === "kenney" ? "https://kenney.nl" : "https://opengameart.org",
    });
  }
  return { kept, rejected };
}

// reportText is the reuse tool's text, passed in by a test or by a later local run.
// Lines look like: "sky.png CC0-1.0". A file that is not CC0 is dropped.
export function applyReuseReport(kept, reportText) {
  const text = String(reportText || "").trim();
  if (!text) return { kept, rejected: [], reuseRan: false, note: REUSE_NOTE };
  const found = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^(\S+)\s+(?:SPDX-License-Identifier:\s*)?([A-Za-z0-9.+-]+)\s*$/);
    if (m) found.set(m[1], m[2]);
  }
  const next = [];
  const rejected = [];
  for (const file of kept) {
    const lic = found.get(file.name);
    if (!lic) { next.push(file); continue; }
    if (!artLicense(lic)) rejected.push({ name: file.name, reason: "not cleared" });
    else next.push(file);
  }
  return { kept: next, rejected, reuseRan: true, note: REUSE_NOTE };
}

export function importDesign(svg) {
  const raw = String(svg || "");
  if (!raw.trim()) return { ok: true, empty: true, shapes: 0, texts: [] };
  if (/<script|on\w+\s*=|javascript:/i.test(raw)) return { ok: false, error: "That design file has a script in it. Paste a plain design." };
  if (/data:(?:image|video|application)\//i.test(raw)) return { ok: false, error: "That design file has a picture in it. Remix does not take pictures out of the file." };
  const shapes = (raw.match(/<(?:rect|circle|ellipse|path|text|g)\b/gi) || []).length;
  const texts = [...raw.matchAll(/<text[^>]*>([^<]{1,80})<\/text>/gi)].map((m) => m[1].trim()).filter(Boolean).slice(0, 8);
  return { ok: true, empty: false, shapes, texts, note: "Penpot is MPL-2.0 and is not bundled. This layout is new." };
}

export function styleTokens({ ink = "#1c2430", paper = "#f7f3ea", font = "Georgia" } = {}) {
  return {
    color: { ink: { value: ink }, paper: { value: paper } },
    font: { body: { value: font } },
    note: "Token file written here in the Style Dictionary shape. Style Dictionary is Apache-2.0 and is not bundled.",
  };
}

export function decorateRemix(input, engineId) {
  const ids = [];
  const notes = [];
  const add = (id) => { if (id && !ids.includes(id)) ids.push(id); };
  const start = input.start || "";
  if (start === "screenshot") {
    add("screenshot-ui");
    notes.push("Fresh layout written for this remix. screenshot-to-code is MIT and is not copied.");
  }
  if (start === "recording") {
    add("recording-prototype");
    notes.push("Clickable preview written for this remix. The video mode of screenshot-to-code is MIT and is not copied.");
  }
  if (start === "design") {
    add("penpot-design");
    notes.push("Design import written for this remix. Penpot is MPL-2.0 and is not bundled.");
  }
  if (start === "game" || engineId === "godot") {
    add("godot-kenney");
    notes.push("Godot demo projects and Kenney starter kits are MIT. They are named here and not copied.");
  }
  if (engineId === "phaser" || input.usePhaser) {
    add("phaser-create");
    notes.push(PHASER_NOTE);
  }
  if (input.useBevy) {
    add("bevy-starter");
    notes.push("Bevy starter written for this remix. Bevy is Apache-2.0 OR MIT and is not copied.");
  }
  if (input.levels) {
    add("level-maker");
    notes.push("New levels use original code in this app. WaveFunctionCollapse by Maxim Gumin is MIT and is not copied.");
  }
  if (input.voice === "piper" || input.voice === "coqui") add("voices");
  if (input.styleOnly) {
    add("style-only");
    notes.push("Colors and type only. Style Dictionary is Apache-2.0 and is not bundled.");
  }
  if (input.blend?.name) {
    add("blend");
    notes.push("Two ideas blended into a new project. Neither app is copied.");
  }
  if (input.fork) {
    add("forks");
    notes.push("Versions saved with isomorphic-git, MIT License. https://github.com/isomorphic-git/isomorphic-git");
  }
  if (input.multiplayer) {
    add("multiplayer");
    notes.push("Online play starter written for this remix. Colyseus is MIT and is not copied.");
  }
  if (input.installer === "tauri" || input.installer === "electron") {
    add("installer");
    notes.push(input.installer === "tauri"
      ? "Installer notes for a desktop app. Tauri is Apache-2.0 OR MIT and is not bundled."
      : "Installer notes for a desktop app. Electron Forge is MIT and is not bundled.");
  }
  if ((input.artFiles || []).length) add("cc0-art");
  return { ids, notes };
}

export function smokeSource(title) {
  const name = JSON.stringify(String(title || "Remix"));
  return `// Generated for this remix. Playwright is Apache-2.0 and is not bundled.
import { test, expect } from "@playwright/test";

test("the page opens", async ({ page }) => {
  await page.goto("index.html");
  await expect(page.getByRole("heading", { name: ${name} })).toBeVisible();
});
`;
}

function hexLum(hex) {
  const n = Number.parseInt(String(hex || "").slice(1), 16);
  if (!Number.isFinite(n)) return 0;
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrastRatio(a, b) {
  const hi = Math.max(hexLum(a), hexLum(b));
  const lo = Math.min(hexLum(a), hexLum(b));
  return (hi + 0.05) / (lo + 0.05);
}

export function accessReport(html, { ink = "#1c2430", paper = "#f7f3ea" } = {}) {
  const text = String(html || "");
  const checks = [
    { name: "The page names its language", ok: /<html[^>]*\blang=/.test(text) },
    { name: "The page has a title", ok: /<title>[^<]+<\/title>/.test(text) },
    { name: "There is a heading", ok: /<h1>[^<]+<\/h1>/.test(text) },
    { name: "Buttons have words", ok: !/<button[^>]*>\s*<\/button>/.test(text) },
    { name: "Pictures have a description", ok: !/<img\b(?![^>]*\balt=)/i.test(text) },
    { name: "The text color is easy to read", ok: contrastRatio(ink, paper) >= 4.5 },
  ];
  const failed = checks.filter((c) => !c.ok).length;
  return {
    title: "Can people use it?",
    grade: failed ? "Needs a look" : "Ready",
    checks,
    tools: [
      { name: "axe-core", license: "MPL-2.0", external: true, ran: false, plain: "Not run. It is not included here." },
      { name: "pa11y", license: "LGPL-3.0-only", external: true, ran: false, plain: "Not run. It stays a separate program." },
    ],
    ranExternal: false,
  };
}

export function publishPlan({ target, click, hasToken }) {
  const row = PUBLISH_TARGETS[target];
  if (!row) return { ok: false, code: "target", sent: false, error: "Choose this computer, a website, itch.io, or a phone." };
  if (click !== true) return { ok: false, code: "confirm", sent: false, error: "Nothing is posted until you press Publish.", target, ability: row.ability };
  if (row.env && !hasToken) return { ok: false, code: "token", sent: false, error: "Add your token first. It is stored with your keys.", target, ability: row.ability };
  return {
    ok: true, code: null, sent: false, target, ability: row.ability, bin: row.bin, args: row.args || [],
    envName: row.env || "", plain: row.plain,
    message: row.bin ? "Ready. Nothing was posted yet." : "It stays on this computer. Nothing was posted.",
  };
}
