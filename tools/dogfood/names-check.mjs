// Shows which file names Meldmind's parser finds in each dogfood goal (quick check, no app needed).
import fs from "node:fs";
const sg = await import("../../server/step-guard.js");
const nf = await import("../../server/named-file.js");
const dir = String.raw`C:\Users\pat\Desktop\x`;
for (const f of process.argv.slice(2)) {
  for (const t of JSON.parse(fs.readFileSync(f, "utf8"))) {
    const g = t.goal.replaceAll("{dir}", dir);
    const want = (t.files || []).map((x) => x.name);
    const got = sg.namedFiles ? sg.namedFiles(g) : [sg.namedFile(g)];
    const miss = want.filter((w) => !got.map((x) => String(x).split(/[\\/]/).pop().toLowerCase()).includes(w.toLowerCase()));
    console.log(`${miss.length ? "MISS" : "ok  "} ${t.id.padEnd(18)} want ${want.join(",")} | found ${JSON.stringify(got)} | wantedFile ${nf.wantedFile ? nf.wantedFile(g) : ""}`);
  }
}
