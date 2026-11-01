// 0.4.32 (dogfood backup-ps1): an AI's backup script loaded System.IO.Compression.FileSystem but used
// [System.IO.Compression.ZipArchiveMode], which lives in System.IO.Compression, so it stopped on every Windows
// PowerShell 5.1 with "Unable to find type". AI-written PowerShell is never run to test it; instead these known traps
// are read from the text, and a hit fails the step's check with the fix, so the AI corrects it.
const ADD = (asm) => new RegExp(`Add-Type\\s+(?:-AssemblyName\\s+)?['"]?${asm.replace(/\./g, "\\.")}['"]?(?=[\\s;,)]|$)`, "im");
const LOAD = (asm) => new RegExp(`\\[(?:System\\.)?Reflection\\.Assembly\\]::Load(?:WithPartialName)?\\(\\s*['"]${asm.replace(/\./g, "\\.")}['"]`, "i");
const loads = (s, asm) => ADD(asm).test(s) || LOAD(asm).test(s);
const uses = (s, types) => new RegExp(`\\[\\s*(?:System\\.)?IO\\.Compression\\.(?:${types.join("|")})\\s*\\]`, "i").test(s);

// Windows PowerShell 5.1 loads neither zip assembly by itself; each type lives in one of them
const RULES = [
  {
    hit: (s) => uses(s, ["ZipArchive", "ZipArchiveMode", "ZipArchiveEntry", "CompressionLevel"]) && !loads(s, "System.IO.Compression"),
    fix: "it uses ZipArchive, ZipArchiveMode or CompressionLevel without Add-Type -AssemblyName System.IO.Compression (those types live there, not in System.IO.Compression.FileSystem)",
  },
  {
    hit: (s) => uses(s, ["ZipFile", "ZipFileExtensions"]) && !loads(s, "System.IO.Compression.FileSystem"),
    fix: "it uses ZipFile without Add-Type -AssemblyName System.IO.Compression.FileSystem",
  },
];

/** Known traps in a PowerShell script. Returns the fixes to ask for, [] when none. */
export function psTraps(text) {
  const s = String(text || "");
  return RULES.filter((r) => r.hit(s)).map((r) => r.fix);
}

export const psIssueLine = (name, fixes) => `${name} would stop on Windows PowerShell: ${fixes.join("; ")}. Add the missing line near the top.`;
