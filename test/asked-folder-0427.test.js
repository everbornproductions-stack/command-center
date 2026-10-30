// 0.4.27 (dogfood batch 1): a file the person asks for at a full path is also copied there, the answer says
// where it went, and an AI's own "Status: not saved" line is not shown when the app did save it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { askedFolder, copyToAskedFolder } from "../server/asked-folder.js";
import { stripSaveClaims } from "../server/step-guard.js";

const home = "C:\\Users\\pat";

test("the folder named in the request is found, and app or system folders are refused", () => {
  assert.equal(askedFolder("Save it as C:\\Users\\pat\\Desktop\\x\\leads.csv", { home }), "C:\\Users\\pat\\Desktop\\x");
  assert.equal(askedFolder("Save both files in C:\\Users\\pat\\Desktop\\x", { home }), "C:\\Users\\pat\\Desktop\\x");
  assert.equal(askedFolder("Save both files in C:\\Users\\pat\\Desktop\\x as a.py and b.csv", { home }), "C:\\Users\\pat\\Desktop\\x");
  assert.equal(askedFolder("Save it in C:\\Users\\pat\\Desktop\\x.", { home }), "C:\\Users\\pat\\Desktop\\x");
  assert.equal(askedFolder("save to C:\\Windows\\System32\\a.txt", { home }), "");
  assert.equal(askedFolder("save to C:\\Users\\pat\\AppData\\Roaming\\a.txt", { home }), "");
  assert.equal(askedFolder("save to C:\\Users\\someoneelse\\a.txt", { home }), "");
  assert.equal(askedFolder("write a poem", { home }), "");
});

test("copies go into the asked folder and never overwrite", () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "af-src-"));
  const dst = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "af-dst-")), "new", "deep");
  const f = path.join(src, "leads.csv");
  fs.writeFileSync(f, "a,b\n1,2\n");
  const one = copyToAskedFolder(dst, [{ name: "leads.csv", path: f }]);
  assert.equal(one[0].name, "leads.csv");
  assert.equal(fs.readFileSync(path.join(dst, "leads.csv"), "utf8"), "a,b\n1,2\n");
  const two = copyToAskedFolder(dst, [{ name: "leads.csv", path: f }]);
  assert.equal(two[0].name, "leads-2.csv");
  assert.deepEqual(copyToAskedFolder("", [{ name: "x", path: f }]), []);
  assert.deepEqual(copyToAskedFolder(dst, [{ name: "gone.csv", path: path.join(src, "gone.csv") }]), []);
});

test("an AI's own 'not saved' status line is dropped; the app says what really happened", () => {
  const out = stripSaveClaims("# leads\n\n**Status: not saved.** I couldn't write the file.\n\nThe list is below.");
  assert.ok(!/not saved/i.test(out), out);
  assert.match(out, /The list is below/);
});

test("the mission finish step copies to the asked folder and names it in the answer", () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, "..", "server", "mission.js"), "utf8");
  assert.match(src, /import \{ askedFolder, copyToAskedFolder \} from "\.\/asked-folder\.js"/);
  assert.match(src, /const asked = askedFolder\(goal\)/);
  assert.match(src, /tail\.push\(c\.error \|\| `Saved \$\{c\.name\} in \$\{mission\.askedFolder\.folder\}`\)/);
});
