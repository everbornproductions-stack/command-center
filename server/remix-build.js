// Files written for one remix. Original text only. No outside project is copied.
import { accessReport, smokeSource, PHASER_COMMAND, PHASER_NOTE, voiceCommand, REUSE_COMMAND, REUSE_NOTE } from "./remix-abilities.js";
import { WFC_NOTE } from "./remix-wfc.js";

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const PAGE_CSS = "body{margin:0;font-family:Georgia,serif;background:#f7f3ea;color:#1c2430}main{max-width:720px;margin:0 auto;padding:24px}button,a.btn{font:inherit;background:#1c2430;color:#f7f3ea;border:0;border-radius:10px;padding:10px 16px;cursor:pointer}section{display:none}section.on{display:block}";

function shell(title, body) {
  const name = escapeHtml(title || "My remix");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

export function freshPage(plan) {
  const title = plan.projectName || "My remix";
  const looks = escapeHtml(plan.description?.looks || "");
  const plays = escapeHtml(plan.description?.plays || "");
  const works = escapeHtml(plan.description?.works || "");
  if (plan.start === "recording") {
    const steps = String(plan.description?.plays || plan.description?.looks || "Start")
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 6);
    const sections = (steps.length ? steps : ["Start"]).map((step, i) => {
      const next = i + 1 < (steps.length || 1) ? i + 1 : 0;
      return `<section id="s${i}" class="${i === 0 ? "on" : ""}"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(step)}</p><button type="button" data-next="s${next}">Next</button></section>`;
    }).join("\n");
    const script = `<script>document.querySelectorAll("button[data-next]").forEach((b)=>b.addEventListener("click",()=>{document.querySelectorAll("section").forEach((s)=>s.classList.remove("on"));document.getElementById(b.dataset.next)?.classList.add("on");}));</script>`;
    return shell(title, `${sections}\n${script}`);
  }
  if (plan.styleOnly) {
    return shell(title, `<h1>${escapeHtml(title)}</h1><p>Colors and type only. The layout stays yours.</p>`);
  }
  const design = plan.design?.shapes ? `<p>Your design had ${plan.design.shapes} shapes. This page is a new layout.</p>` : "";
  return shell(title, `<h1>${escapeHtml(title)}</h1><p>${looks}</p><p>${plays}</p><p>${works}</p>${design}<button type="button">Start</button>`);
}

function godotFile(name) {
  const safe = String(name || "My remix").replace(/[^\w .'-]+/g, "").slice(0, 60) || "My remix";
  return `; A new project written for this remix. Not a Godot demo.
config_version=5

[application]
config/name="${safe}"
`;
}

function bevyFiles() {
  return {
    "bevy/Cargo.toml": `# Original starter. Bevy is Apache-2.0 OR MIT. This is not a Bevy template.
[package]
name = "remix_game"
version = "0.1.0"
edition = "2021"
`,
    "bevy/src/main.rs": `// Original starter. Bevy is not copied and is not bundled.
fn main() {
    println!("Start a new game of your own.");
}
`,
  };
}

function roomFile() {
  return `// Original online room. Colyseus is MIT and is not copied.
// Install it yourself if you want online play. It is not bundled here.
export const roomName = "remix";
export function welcome(name) {
  return "Hello " + String(name || "friend");
}
`;
}

export function projectFiles(plan) {
  const ids = new Set(plan.abilityIds || []);
  const html = freshPage(plan);
  const files = { "index.html": html };
  if (ids.has("smoke-test")) files["smoke.spec.js"] = smokeSource(plan.projectName);
  if (ids.has("access-report")) files["access-report.json"] = JSON.stringify(accessReport(html), null, 2) + "\n";
  if (ids.has("style-only") && plan.styleTokens) files["tokens.json"] = JSON.stringify(plan.styleTokens, null, 2) + "\n";
  if (ids.has("level-maker") && plan.level?.ok) {
    files["levels.json"] = JSON.stringify({ ...plan.level, note: WFC_NOTE }, null, 2) + "\n";
  }
  if (ids.has("godot-kenney")) files["game/project.godot"] = godotFile(plan.projectName);
  if (ids.has("bevy-starter")) Object.assign(files, bevyFiles());
  if (ids.has("phaser-create")) files["phaser-command.txt"] = `${PHASER_COMMAND.join(" ")}\n${PHASER_NOTE}\n`;
  if (ids.has("multiplayer")) files["online/room.js"] = roomFile();
  if (ids.has("installer") && plan.installer === "tauri") {
    files["installer/tauri.conf.json"] = JSON.stringify({
      productName: plan.projectName || "My remix",
      note: "Original notes. Tauri is Apache-2.0 OR MIT and is not bundled.",
    }, null, 2) + "\n";
  }
  if (ids.has("installer") && plan.installer === "electron") {
    files["installer/forge.config.js"] = `// Original notes. Electron Forge is MIT and is not bundled.
export const forge = { packagerConfig: {}, makers: [] };
`;
  }
  if (ids.has("voices") && plan.voice) {
    const voice = voiceCommand(plan.voice);
    if (voice) files["voice-command.txt"] = `${voice.command.join(" ")}\n${voice.note}\nNothing is recorded until you approve it.\n`;
  }
  if (ids.has("cc0-art")) files["art-check.txt"] = `${REUSE_COMMAND.join(" ")}\n${REUSE_NOTE}\nDownloads wait until you approve them.\n`;
  if (ids.has("penpot-design") && plan.design && !plan.design.empty) {
    const texts = (plan.design.texts || []).map((t) => `- ${t}`).join("\n");
    files["design-notes.txt"] = `Shapes: ${plan.design.shapes}\n${texts}\n${plan.design.note || ""}\n`;
  }
  return files;
}

export function safeRel(rel) {
  const s = String(rel || "");
  if (!s || s.includes("..") || s.startsWith("/") || s.includes("\\")) return "";
  if (!/^[A-Za-z0-9._/-]+$/.test(s)) return "";
  return s;
}
