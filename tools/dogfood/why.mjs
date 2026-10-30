// Prints, for each task in a batch results.json, what the app says it saved and why steps were marked with errors.
import fs from "node:fs";
const [file, port = 4747] = process.argv.slice(2);
const B = `http://127.0.0.1:${port}`;
const h = await (await fetch(B + "/")).text();
const t = (h.match(/name="cc-token"\s+content="([^"]+)"/) || h.match(/content="([^"]+)"\s+name="cc-token"/))[1];
for (const r of JSON.parse(fs.readFileSync(file, "utf8"))) {
  if (!r.missionId) { console.log(`## ${r.id}: no mission (${r.startError})`); continue; }
  const m = await (await fetch(`${B}/api/missions/${r.missionId}`, { headers: { "X-CC-Token": t } })).json();
  console.log(`## ${r.id} ${r.pass ? "PASS" : "FAIL"} status=${m.status}`);
  console.log(`  savedFile: ${JSON.stringify(m.savedFile)?.slice(0, 260)}`);
  for (const x of m.incomplete?.reasons || []) console.log(`  incomplete: ${x.kind} | ${x.title} | ${String(x.reason).slice(0, 150)}`);
  for (const x of m.tasks || []) console.log(`  step: ${x.title} | ${x.status} | ${x.provider}/${x.model} | writes=${(x.writes || []).map((w) => w.name).join(",")} | notSaved=${x.notSaved ? String(x.notSaved.line).slice(0, 120) : ""}`);
  const tail = String(m.deliverable || "").split("\n").filter((l) => /saved|wrote|not saved|could not/i.test(l)).slice(-4);
  for (const l of tail) console.log(`  says: ${l.slice(0, 200)}`);
}
