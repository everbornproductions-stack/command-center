// 0.4.32 (dogfood backup-ps1): an AI's backup script loaded System.IO.Compression.FileSystem but used
// [System.IO.Compression.ZipArchiveMode], which lives in System.IO.Compression, so it stopped on every Windows
// PowerShell 5.1 with "Unable to find type". AI-written PowerShell is never run to test it; instead these known traps
// are read from the text, and a hit fails the step's check with the fix, so the AI corrects it.
// 0.4.36 (panel 0432 item 4): every correct way to load the assemblies counts (a comma list, -AssemblyName, -Assembly,
// -A, a bare name, "using assembly", [Reflection.Assembly]::Load...), and commented-out lines do not.

const norm = (n) => String(n || "").trim().replace(/^['"]|['"]$/g, "").replace(/\.dll$/i, "").toLowerCase();

/** The assembly names a script loads, from its live (not commented) lines. */
export function loadedAssemblies(text) {
  const names = new Set();
  const lines = String(text || "").split(/\r?\n/).map((l) => l.replace(/^\s+/, "")).filter((l) => l && !l.startsWith("#"));
  for (const line of lines) {
    const add = /^Add-Type\s+(?:-(?:AssemblyName|Assembly|A)\b\s*)?(.+)$/i.exec(line);
    if (add) for (const part of add[1].split(/[;|]/)[0].split(",")) { const n = norm(part.replace(/\s+-\w+.*$/, "")); if (n) names.add(n); }
    const using = /^using\s+assembly\s+(.+)$/i.exec(line);
    if (using) names.add(norm(using[1]));
    const load = /\[(?:System\.)?Reflection\.Assembly\]::Load(?:WithPartialName)?\(\s*(['"])([^'"]+)\1/i.exec(line);
    if (load) names.add(norm(load[2].split(",")[0]));
  }
  return names;
}
const loads = (s, asm) => loadedAssemblies(s).has(asm.toLowerCase());
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
