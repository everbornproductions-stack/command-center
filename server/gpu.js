// Free local AI on your graphics card (0.4.18). Finds an NVIDIA card and its memory, read-only:
// nvidia-smi when it is there, otherwise the Windows video controller list (CIM). No shell, a short timeout,
// and nothing is changed. The model table lives in server/free-ai.json.
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const CONFIG = JSON.parse(fs.readFileSync(path.join(here, "free-ai.json"), "utf8"));
const GB = 1024 * 1024 * 1024;

// nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits  ->  "NVIDIA GeForce RTX 4070, 12282"
export function parseNvidiaSmi(text) {
  const out = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const parts = line.split(",").map((s) => s.trim());
    if (parts.length < 2 || !parts[0]) continue;
    const mib = Number(String(parts[1]).replace(/[^\d.]/g, ""));
    if (!Number.isFinite(mib) || mib <= 0) continue;
    out.push({ name: parts[0], vramGb: Math.round((mib / 1024) * 10) / 10, source: "nvidia-smi" });
  }
  return out;
}

// Get-CimInstance Win32_VideoController | Select Name, AdapterRAM | ConvertTo-Json
// AdapterRAM is a 32-bit number, so cards with 4 GB or more can show about 4 GB: that is a floor, not the size.
export function parseCim(text) {
  let rows;
  try { rows = JSON.parse(String(text || "").trim() || "[]"); } catch { return []; }
  if (!Array.isArray(rows)) rows = [rows];
  const out = [];
  for (const r of rows) {
    const name = String(r?.Name || "").trim();
    if (!/nvidia/i.test(name)) continue;
    const bytes = Number(r?.AdapterRAM) || 0;
    const gb = Math.round((bytes / GB) * 10) / 10;
    out.push({ name, vramGb: gb, source: "windows", atLeast: bytes >= 4 * GB - 1024 * 1024 });
  }
  return out;
}

function run(file, args, { execImpl = execFile, timeout = 8000 } = {}) {
  return new Promise((resolve) => {
    try {
      execImpl(file, args, { windowsHide: true, timeout, shell: false }, (err, stdout) => resolve(err ? "" : String(stdout || "")));
    } catch { resolve(""); }
  });
}

export async function detectGpu({ platform = process.platform, execImpl, env = process.env } = {}) {
  if (env.CC_GPU_DETECT === "off") return { found: false };
  if (env.CC_GPU_FIXTURE) return pickBest(parseNvidiaSmi(env.CC_GPU_FIXTURE));
  const smi = await run(env.CC_NVIDIA_SMI || "nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], { execImpl });
  let gpus = parseNvidiaSmi(smi);
  if (!gpus.length && platform === "win32") {
    const cim = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM | ConvertTo-Json -Compress"], { execImpl });
    gpus = parseCim(cim);
  }
  return pickBest(gpus);
}

function pickBest(gpus) {
  if (!gpus.length) return { found: false };
  const best = [...gpus].sort((a, b) => b.vramGb - a.vramGb)[0];
  return { found: true, ...best };
}

// The biggest tier that fits. No offer under the smallest tier (unless Windows only gave a floor of about 4 GB:
// then the smallest tier is offered with a note).
export function recommend(gpu, { developer = false, tiers = CONFIG.gpuTiers } = {}) {
  if (!gpu?.found) return null;
  const sorted = [...tiers].sort((a, b) => a.minGb - b.minGb);
  let tier = null;
  for (const t of sorted) if (gpu.vramGb + 0.6 >= t.minGb) tier = t;
  let unsure = false;
  if (!tier && gpu.atLeast) { tier = sorted[0]; unsure = true; }
  if (!tier) return null;
  const main = developer ? tier.coding : tier.general;
  return {
    tier: tier.label, general: tier.general, coding: tier.coding, pick: main.model, pickKind: developer ? "coding" : "general",
    unsure, note: unsure ? "Windows could only tell that the card has at least 4 GB. The smallest model is the safe pick." : "",
  };
}
