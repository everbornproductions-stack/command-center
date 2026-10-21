// Versioned forks for a remix project. isomorphic-git is MIT. No network.
import fs from "node:fs";
import path from "node:path";

function walk(dir, base = "") {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (name === ".git") continue;
    const rel = base ? `${base}/${name}` : name;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) out.push(...walk(full, rel));
    else out.push(rel);
  }
  return out;
}

export async function commitVersion(dir, message = "Saved a version of this remix") {
  const imported = await import("isomorphic-git");
  const git = imported.default || imported;
  await git.init({ fs, dir, defaultBranch: "main" });
  for (const filepath of walk(dir)) await git.add({ fs, dir, filepath });
  const sha = await git.commit({
    fs,
    dir,
    message,
    author: { name: "Meldmind", email: "remix@localhost" },
  });
  const version = String(sha).slice(0, 7);
  const branch = `fork-${version}`;
  try { await git.branch({ fs, dir, ref: branch, checkout: false }); } catch { /* the branch may already exist */ }
  return { ok: true, version, branch, sent: false };
}
