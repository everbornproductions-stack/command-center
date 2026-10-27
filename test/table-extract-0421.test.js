// 0.4.21 dogfood 08 (tables as their own job type): an answer with a table in it is read by one pure
// module, web/table-extract.js, so the result card can draw a real table and offer Download CSV and
// Download Markdown. Pipe tables and ```csv blocks, RFC 4180 quoting, no page and no network here.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { extractTables, toCsv } from "../web/table-extract.js";
import { bootPage, findBrowser } from "./pw-helpers.js";
import { waitBudget } from "./helpers.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const skip = findBrowser() ? false : "no Chrome installed";
// how long the page gets to answer, scaled the way the other browser tests scale it
const SEND_BUDGET = waitBudget(20000);

test("a pipe table comes out with its headings and its rows", () => {
  const md = `Here is the lead list.

| Name | Email | Phone |
| ---- | :---: | ----- |
| Ada Lovelace | ada@example.com | 555-0100 |
| Grace Hopper, Jr. | grace@example.com | 555-0101 |

That is all.`;
  const tables = extractTables(md);
  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0].headers, ["Name", "Email", "Phone"]);
  assert.deepEqual(tables[0].rows, [
    ["Ada Lovelace", "ada@example.com", "555-0100"],
    ["Grace Hopper, Jr.", "grace@example.com", "555-0101"],
  ]);
});

test("a pipe written as \\| stays inside its cell, and a row is padded or cut to the headings", () => {
  const [t] = extractTables("| A | B |\n| --- | --- |\n| x \\| y | c | d | extra |");
  assert.deepEqual(t.headers, ["A", "B"]);
  assert.deepEqual(t.rows, [["x | y", "c"]], "a long row is cut to the headings");
  const [short] = extractTables("| A | B | C |\n| --- | --- | --- |\n| only |");
  assert.deepEqual(short.rows, [["only", "", ""]], "a short row is padded to the headings");
});

test("a row of pipes without the line under the headings is not a table", () => {
  assert.deepEqual(extractTables("| Name | Email |\n| Ada | ada@example.com |"), []);
  assert.deepEqual(extractTables(""), []);
  assert.deepEqual(extractTables(null), []);
  assert.deepEqual(extractTables("No table in this answer at all."), []);
});

test("a csv block gives its first record as headings and the rest as rows", () => {
  const md = `Leads:

\`\`\`csv
Lead,Email,Note
Sam Jones,sam@example.com,"Said, call after 5"
"Mo ""The Boss"" Lee",mo@example.com,"Line one
Line two"
\`\`\``;
  const tables = extractTables(md);
  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0].headers, ["Lead", "Email", "Note"]);
  assert.deepEqual(tables[0].rows, [
    ["Sam Jones", "sam@example.com", "Said, call after 5"],
    ["Mo \"The Boss\" Lee", "mo@example.com", "Line one\nLine two"],
  ]);
});

test("code that is not csv is left alone, and both shapes come back in the order they are written", () => {
  const md = [
    "| Stage | Count |", "| --- | --- |", "| New | 12 |", "",
    "```js",
    'const row = "| a | b |";',
    "```", "",
    "```csv",
    "Task,Owner",
    "Write the draft,Sam",
    "```",
  ].join("\n");
  const tables = extractTables(md);
  assert.deepEqual(tables.map((t) => t.headers), [["Stage", "Count"], ["Task", "Owner"]]);
  assert.deepEqual(tables[0].rows, [["New", "12"]]);
  assert.deepEqual(tables[1].rows, [["Write the draft", "Sam"]]);
});

test("a csv block with only headings is still a table", () => {
  const [t] = extractTables("```csv\nName,Email\n```");
  assert.deepEqual(t.headers, ["Name", "Email"]);
  assert.deepEqual(t.rows, []);
});

test("toCsv quotes what RFC 4180 says to quote and puts one record to a line", () => {
  const table = { headers: ["Name", "Note"], rows: [["Ada, A", 'Say "hi"'], ["Line", "one\ntwo"]] };
  assert.equal(toCsv(table), 'Name,Note\r\n"Ada, A","Say ""hi"""\r\nLine,"one\ntwo"\r\n');
  assert.equal(toCsv({ headers: ["A"], rows: [] }), "A\r\n");
  assert.equal(toCsv({ headers: [], rows: [] }), "", "an empty table is an empty file");
});

test("what toCsv writes reads back as the same table", () => {
  const table = { headers: ["Name", "Note"], rows: [["Ada, A", 'Say "hi"'], ["Line", "one\ntwo"]] };
  const back = extractTables(`\`\`\`csv\n${toCsv(table)}\`\`\``);
  assert.deepEqual(back, [table]);
});

test("the card saves through the app's own download helper, and the HighLevel button starts out hidden", () => {
  const src = read("web/features/export.js");
  assert.match(src, /window\.CC\.downloadBlob\(/);
  assert.match(src, /id="ex-hl" hidden/);
  assert.doesNotMatch(src, /\u2014/, "no em dash in the file");
});

test("the card draws the table, the CSV and Markdown buttons download the file, HighLevel waits for its own click", { skip, timeout: 120000 }, async () => {
  const p = await bootPage();
  if (!p) return;
  try {
    const out = await p.page.evaluate(async () => {
      await window.CC.ensureView("command");
      const f = (window.CC.features || []).find((x) => x.id === "export");
      if (!f) return { error: "the export card did not load" };
      const host = document.createElement("div");
      document.body.appendChild(host);
      const md = [
        "Here are the leads.", "",
        "| Name | Email |", "| --- | --- |", "| Ada | ada@example.com |", "",
        "```csv", "Name,Email", "Grace,grace@example.com", "```",
      ].join("\n");
      f.deliverable.render(host, { id: "run-tables", prompt: "List the leads", deliverable: md });
      const base = {
        tables: host.querySelectorAll("table").length,
        heads: [...host.querySelectorAll("th")].map((x) => x.textContent),
        cells: [...host.querySelectorAll("td")].map((x) => x.textContent),
        rawPipe: host.innerHTML.includes("| Name | Email |"),
        buttons: [...host.querySelectorAll("#ex-bar button")].map((x) => x.textContent),
        hlHidden: host.querySelector("#ex-hl")?.hidden,
      };
      const cap = {};
      const make = URL.createObjectURL, click = HTMLAnchorElement.prototype.click;
      URL.createObjectURL = (b) => { cap.blob = b; return "blob:stub"; };
      HTMLAnchorElement.prototype.click = function () { cap.name = this.download; };
      host.querySelector("#ex-csv").click();
      const csv = { text: cap.blob ? await cap.blob.text() : "", type: cap.blob?.type, name: cap.name };
      host.querySelector("#ex-md").click();
      const doc = { text: cap.blob ? await cap.blob.text() : "", name: cap.name };
      URL.createObjectURL = make; HTMLAnchorElement.prototype.click = click;
      // every call the page makes from here, so a preview can be shown to send nothing
      window.__ccCalls = [];
      const fetch0 = window.fetch;
      window.fetch = (u, o) => { window.__ccCalls.push(String(u) + " " + (o?.body || "")); return fetch0.call(window, u, o); };
      host.querySelector("#ex-hl").click();
      await new Promise((r) => setTimeout(r, 400));
      const preview = {
        sentAlready: window.__ccCalls.filter((c) => /highlevel\/(preview|run)/.test(c)).length,
        box: host.querySelector(".ex-hl")?.textContent || "",
        send: !!host.querySelector("#ex-hl-send"),
      };
      host.remove();
      return { base, csv, doc, preview };
    });
    assert.ifError(out?.error);
    assert.equal(out.base.tables, 2, "a pipe table and a csv block both come out as a real table");
    assert.deepEqual(out.base.heads, ["Name", "Email", "Name", "Email"]);
    assert.ok(out.base.cells.includes("Ada") && out.base.cells.includes("grace@example.com"));
    assert.equal(out.base.rawPipe, false, "the table is drawn, not shown as raw pipes");
    assert.deepEqual(out.base.buttons, ["Keep", "Download PDF", "Download Word", "Download CSV", "Download Markdown", "Send to HighLevel"]);
    assert.equal(out.base.hlHidden, true, "HighLevel is not connected here, so the button stays hidden");
    assert.equal(out.csv.type, "text/csv;charset=utf-8");
    assert.match(out.csv.name, /\.csv$/);
    assert.equal(out.csv.text, "Name,Email\r\nAda,ada@example.com\r\n\r\nName,Email\r\nGrace,grace@example.com\r\n");
    assert.match(out.doc.name, /\.md$/);
    assert.equal(out.doc.text.includes("| Name | Email |"), true, "the Markdown file is the answer as written");
    assert.equal(out.preview.sentAlready, 0, "the preview sends nothing");
    assert.equal(out.preview.send, true, "the rows are shown with a Send button");
    assert.match(out.preview.box, /Nothing was sent/);
    assert.match(out.preview.box, /Ada/);
    // only the second click, on Send, reaches HighLevel (it is not connected here, so it fails and says so)
    const sent = await p.page.evaluate(async (budget) => {
      const host2 = document.createElement("div");
      document.body.appendChild(host2);
      const f = (window.CC.features || []).find((x) => x.id === "export");
      f.deliverable.render(host2, { id: "run-tables", prompt: "List the leads", deliverable: "| Name | Email |\n| --- | --- |\n| Ada | ada@example.com |" });
      host2.querySelector("#ex-hl").click();
      await new Promise((r) => setTimeout(r, 200));
      window.__ccCalls.length = 0;
      host2.querySelector("#ex-hl-send").click();
      const until = Date.now() + budget;
      while (Date.now() < until && !window.__ccCalls.some((c) => c.includes("highlevel/preview"))) await new Promise((r) => setTimeout(r, 100));
      const calls = window.__ccCalls.slice();
      host2.remove();
      return calls;
    }, SEND_BUDGET);
    assert.ok(sent.some((c) => c.includes("/api/highlevel/preview")), "Send is what calls HighLevel");
    assert.equal(p.errors.filter((e) => /export|table-extract/.test(e)).length, 0, p.errors.join(" | "));
  } finally { await p.close(); }
});
