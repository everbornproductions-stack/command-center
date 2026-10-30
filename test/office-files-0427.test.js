// 0.4.27 (dogfood batch 1): "save it as bakery-sales.xlsx" and "workout-plan.docx" must give real Office files,
// not a Python script that nobody runs and not text written with a .xlsx name. Temp folders only, nothing sent.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "office0427-"));
process.env.CC_DATA_DIR = DATA;
const office = await import("../server/office-files.js");
const named = await import("../server/named-file.js");
test.after(() => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ } });

// read one entry out of a zip (the writer's own format: deflate or stored, sizes in the central directory)
function unzipEntry(buf, want) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end > 0, "zip has an end record");
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const names = [];
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString("utf8");
    names.push(name);
    if (name === want) {
      const lnl = buf.readUInt16LE(off + 26), lel = buf.readUInt16LE(off + 28);
      const data = buf.slice(off + 30 + lnl + lel, off + 30 + lnl + lel + csize);
      return (method === 8 ? zlib.inflateRawSync(data) : data).toString("utf8");
    }
    p += 46 + nlen + elen + clen;
  }
  throw new Error(`${want} not in zip: ${names.join(", ")}`);
}

const python = (() => {
  for (const cmd of ["python", "python3", "py"]) {
    const r = spawnSync(cmd, ["-I", "-c", "import sys; print(sys.version_info[0])"], { encoding: "utf8", timeout: 30000 });
    if (r.status === 0 && r.stdout.trim() === "3") return cmd;
  }
  return null;
})();
const hasOpenpyxl = python ? spawnSync(python, ["-I", "-c", "import openpyxl"], { timeout: 30000 }).status === 0 : false;
// the script reads the path from argv: nothing is run from the temp folder
function py(code, file) {
  const r = spawnSync(python, ["-I", "-c", code, file], { encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, `python failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split("\n").pop());
}

const BAKERY = [
  "# Bakery Weekly Sales",
  "",
  "## Structure",
  "",
  "| Row | A | B | C | D |",
  "| :--- | :--- | :--- | :--- | :--- |",
  "| 1 | Day | Downtown | Midtown | Total |",
  "",
  "**Weekly Sales**",
  "",
  "| Day | Downtown | Midtown | Total |",
  "| :--- | ---: | ---: | ---: |",
  "| Monday | $1,450 | $980 | =SUM(B2:C2) |",
  "| Tuesday | $1,520 | $1,050 | =SUM(B3:C3) |",
  "| Wednesday | 1610 | 1120 | `=SUM(B4:C4)` |",
  "| **Weekly Total** | =SUM(B2:B4) | =SUM(C2:C4) | =SUM(D2:D4) |",
  "",
  "Downtown leads on weekdays.",
].join("\n");

test("tables are found in an answer: the sheet table, not the layout table; csv blocks win; titled tables become sheets", () => {
  const one = office.tablesFromAnswer(BAKERY);
  assert.equal(one.length, 1);
  assert.equal(one[0].name, "Weekly Sales");
  assert.deepEqual(one[0].rows[0], ["Day", "Downtown", "Midtown", "Total"]);
  assert.equal(one[0].rows.length, 5);
  const csv = office.tablesFromAnswer("Here it is.\n\n```csv\nName,Amount\n\"Smith, Jo\",12\nLee,3\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n");
  assert.equal(csv.length, 1);
  assert.deepEqual(csv[0].rows[1], ["Smith, Jo", "12"]);
  const two = office.tablesFromAnswer("## Income\n\n| Item | Amount |\n|---|---|\n| Sales | 10 |\n\n## Costs\n\n| Item | Amount |\n|---|---|\n| Flour | 4 |\n| Rent | 3 |\n");
  assert.deepEqual(two.map((s) => s.name), ["Income", "Costs"]);
  // a table inside a python script is not a table for the sheet
  assert.deepEqual(office.tablesFromAnswer("```python\nfrom openpyxl import Workbook\n# | a | b |\n# |---|---|\n# | 1 | 2 |\nwb = Workbook()\n```"), []);
  assert.deepEqual(office.parseCsv("a,b\n\"x \"\"y\"\"\",2\n"), [["a", "b"], ['x "y"', "2"]]);
});

test("xlsxFromTable makes a workbook Python can open, with numbers, text, formulas, a bold header and a frozen row", { skip: !python && "python is not installed" }, () => {
  const sheets = office.tablesFromAnswer(BAKERY);
  sheets.push({ name: "Notes: week/1", rows: [["Note"], ["Fresh bread daily"]] });
  const buf = office.xlsxFromTable({ sheets });
  const file = path.join(DATA, "bakery-direct.xlsx");
  fs.writeFileSync(file, buf);
  const z = py("import zipfile,sys,json; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({'bad': z.testzip(), 'names': z.namelist()}))", file);
  assert.equal(z.bad, null, "every entry passes its CRC check");
  assert.ok(z.names.includes("xl/workbook.xml") && z.names.includes("xl/worksheets/sheet2.xml") && z.names.includes("[Content_Types].xml"));
  const sheet = unzipEntry(buf, "xl/worksheets/sheet1.xml");
  assert.match(sheet, /<f>SUM\(B2:C2\)<\/f>/);
  assert.match(sheet, /state="frozen"/);
  assert.match(unzipEntry(buf, "xl/styles.xml"), /<b\/>/);
  if (!hasOpenpyxl) return;
  const r = py([
    "import openpyxl,sys,json",
    "wb=openpyxl.load_workbook(sys.argv[1])",
    "ws=wb.worksheets[0]",
    "print(json.dumps({'sheets': wb.sheetnames, 'head': [c.value for c in ws[1]], 'bold': ws['A1'].font.b, 'b2': ws['B2'].value, 'b4': ws['B4'].value, 'a3': ws['A3'].value, 'd2': ws['D2'].value, 'd4': ws['D4'].value, 'b5': ws['B5'].value, 'freeze': ws.freeze_panes, 'note': wb.worksheets[1]['A2'].value}))",
  ].join("\n"), file);
  assert.deepEqual(r.sheets, ["Weekly Sales", "Notes week 1"]);
  assert.deepEqual(r.head, ["Day", "Downtown", "Midtown", "Total"]);
  assert.equal(r.bold, true);
  assert.equal(r.b2, 1450);
  assert.equal(r.b4, 1610);
  assert.equal(r.a3, "Tuesday");
  assert.equal(r.d2, "=SUM(B2:C2)");
  assert.equal(r.d4, "=SUM(B4:C4)");
  assert.equal(r.b5, "=SUM(B2:B4)");
  assert.equal(r.freeze, "A2");
  assert.equal(r.note, "Fresh bread daily");
});

test("docxFromMarkdown makes a Word file with headings, lists and a real table", () => {
  const md = "# 4-Week Plan\n\nA plan for **beginners** with *easy* starts.\n\n## Week 1\n\n- Walk 20 minutes\n- Stretch\n\n1. Squats\n2. Push-ups\n\n| Day | Workout | Sets |\n|---|---|---|\n| Monday | Squats | 3 |\n| Wednesday | Push-ups | 2 |\n";
  const buf = office.docxFromMarkdown(md);
  assert.equal(buf.slice(0, 2).toString("latin1"), "PK");
  const doc = unzipEntry(buf, "word/document.xml");
  assert.match(doc, /<w:tbl>/);
  assert.match(doc, /w:pStyle w:val="Heading1"/);
  assert.match(doc, /w:pStyle w:val="Heading2"/);
  assert.match(doc, /4-Week Plan/);
  assert.match(doc, /Wednesday/);
  assert.match(doc, /<w:b\/><\/w:rPr><w:t xml:space="preserve">beginners/);
  assert.match(doc, /<w:i\/><\/w:rPr><w:t xml:space="preserve">easy/);
  assert.equal((doc.match(/<w:numPr>/g) || []).length, 4);
  assert.match(unzipEntry(buf, "word/numbering.xml"), /w:numFmt w:val="decimal"/);
  assert.match(unzipEntry(buf, "[Content_Types].xml"), /wordprocessingml\.document\.main\+xml/);
  if (python) {
    const file = path.join(DATA, "plan-direct.docx");
    fs.writeFileSync(file, buf);
    const r = py("import zipfile,sys,json; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({'bad': z.testzip(), 'tbl': '<w:tbl>' in z.read('word/document.xml').decode('utf8')}))", file);
    assert.equal(r.bad, null);
    assert.equal(r.tbl, true);
  }
});

test("saveNamedFile builds bakery-sales.xlsx from a table in the answer and writes real bytes", { skip: !python && "python is not installed" }, () => {
  const goal = "Make an Excel spreadsheet of weekly bakery sales with SUM formulas and save it as C:\\Users\\pat\\Desktop\\bakery-sales.xlsx";
  assert.equal(named.wantedFile(goal), "bakery-sales.xlsx");
  assert.match(named.officeNote(goal), /markdown table/);
  assert.match(named.officeNote("Write it as a Word document named workout-plan.docx"), /Markdown with headings/);
  assert.equal(named.officeNote("save as index.html"), "");
  const r = named.saveNamedFile({ goal, text: BAKERY, projectId: "p-office" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.name, "bakery-sales.xlsx");
  assert.equal(r.readable, false);
  assert.equal(fs.statSync(r.path).size, r.bytes);
  assert.equal(named.readSavedFile(r), "", "a binary file has no preview text");
  const z = py("import zipfile,sys,json; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({'bad': z.testzip(), 'sheet': z.read('xl/worksheets/sheet1.xml').decode('utf8')}))", r.path);
  assert.equal(z.bad, null);
  assert.match(z.sheet, /<f>SUM\(B2:B4\)<\/f>/);
  // never overwrite: a second save is bakery-sales-2.xlsx
  const again = named.saveNamedFile({ goal, text: BAKERY, projectId: "p-office" });
  assert.equal(again.name, "bakery-sales-2.xlsx");
  assert.ok(fs.existsSync(r.path) && fs.existsSync(again.path));
});

test("no table, or only a script that would build the file, is a plain Not saved line", () => {
  const goal = "Make an Excel sheet and save it as sales.xlsx";
  const none = named.saveNamedFile({ goal, text: "Here are the sales: Monday was good and Tuesday was better.", projectId: "p-office" });
  assert.deepEqual({ ok: none.ok, error: none.error }, { ok: false, error: "Not saved: there was no table to put in the spreadsheet." });
  const script = named.saveNamedFile({ goal, text: "```python\nfrom openpyxl import Workbook\nwb = Workbook()\nwb.save('sales.xlsx')\n```", projectId: "p-office" });
  assert.equal(script.ok, false);
  assert.equal(script.error, named.NO_TABLE_LINE);
  const doc = named.saveNamedFile({ goal: "Save it as workout-plan.docx", text: "```python\nfrom docx import Document\ndoc = Document()\ndoc.save('workout-plan.docx')\n```", projectId: "p-office" });
  assert.equal(doc.ok, false);
  assert.equal(doc.error, named.SCRIPT_ONLY_LINE);
  assert.ok(!/\u2014/.test(named.NO_TABLE_LINE + named.SCRIPT_ONLY_LINE + named.officeNote(goal)), "no em-dashes in user-facing text");
});

test("a whole mission for bakery-sales.xlsx: the prompts ask for a table, and the run saves a real workbook", { timeout: 300000 }, async () => {
  const http = await import("node:http");
  const { startServer, waitBudget } = await import("./helpers.js");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const SCRIPT = "```python\nfrom openpyxl import Workbook\nwb = Workbook()\nwb.save('bakery-sales.xlsx')\n```";
  const PLAN = JSON.stringify({ title: "Bakery sales sheet", assembly: "Hand over the sheet.", tasks: [
    { id: "t1", title: "Build the Excel file with SUM formulas", capability: "code", difficulty: 2, needWeb: false, deps: [], instructions: "Build bakery-sales.xlsx with daily sales and SUM totals.", deliverable: "The spreadsheet" },
  ] });
  const seen = { work: 0, assemble: 0 };
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json", connection: "close" }); res.end(JSON.stringify(j)); };
    if (/\/models$/.test(url.pathname)) return send(200, { data: [{ id: "mock" }] });
    if (!/\/chat\/completions$/.test(url.pathname)) return send(404, { error: "no route" });
    const j = JSON.parse(body);
    const sys = j.messages.find((m) => m.role === "system")?.content || "";
    const asksTable = /markdown table, one row per line/.test(sys) && /Do not write code to build the file/.test(sys);
    let out;
    if (/Reply with JSON only: \{"capability"/.test(sys)) out = `{"capability":"code","difficulty":2,"needWeb":false,"summary":"mock"}`;
    else if (/Break the goal into/.test(sys)) out = PLAN;
    else if (/You QA another AI/.test(sys)) out = `{"pass":true,"score":9,"issues":[]}`;
    else if (/You assemble/.test(sys)) { if (asksTable) seen.assemble++; out = asksTable ? BAKERY : SCRIPT; }
    else { if (asksTable) seen.work++; out = asksTable ? BAKERY : SCRIPT; }
    res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
    res.write(`data: ${JSON.stringify({ model: j.model, choices: [{ delta: { content: out } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 30, completion_tokens: 40 } })}\n\n`);
    res.write("data: [DONE]\n\n"); res.end();
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const KEYS = { xai: "xai-fakefakefakefakefake", groq: "gsk_fakefakefakefakefake", mistral: "fakemistralkeyfakemistralkey0000" };
  const s = await startServer({ env: { CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_QA_TIMEOUT_MS: "1500", CC_BASE_URL_XAI: `${base}/xai/v1`, CC_BASE_URL_GROQ: `${base}/groq/v1`, CC_BASE_URL_MISTRAL: `${base}/mistral/v1`, XAI_API_KEY: "", GROQ_API_KEY: "", MISTRAL_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", DEEPSEEK_API_KEY: "", PERPLEXITY_API_KEY: "" } });
  try {
    for (const pid of ["xai", "groq", "mistral"]) assert.equal((await s.api("/keys", { method: "POST", body: { provider: pid, key: KEYS[pid] } })).json.status.status, "green", pid);
    await s.api("/fallback/settings", { method: "POST", body: { on: false } }).catch(() => {});
    const posted = await s.api("/mission", { method: "POST", body: { goal: "Make an Excel spreadsheet of a week of bakery sales for two shops with SUM formulas and save it as bakery-sales.xlsx", mode: "economy", qa: false, budgetUsd: 1 } });
    assert.equal(posted.status, 202, posted.text);
    let run = null;
    const t0 = Date.now();
    while (!run && Date.now() - t0 < waitBudget(90000)) {
      const m = ((await s.api("/state")).json.missions || []).find((x) => x.kind === "mission" && ["done", "done-with-errors", "failed"].includes(x.status));
      if (m) run = (await s.api(`/missions/${m.id}`)).json;
      else await sleep(250);
    }
    assert.ok(run, "the mission finished\n" + s.log.slice(-600));
    assert.ok(seen.work >= 1 && seen.assemble >= 1, `step and assembler prompts both ask for a table: ${JSON.stringify(seen)}`);
    assert.equal(run.savedFile?.ok, true, JSON.stringify(run.savedFile));
    assert.equal(run.savedFile.name, "bakery-sales.xlsx");
    const buf = fs.readFileSync(run.savedFile.path);
    assert.equal(buf.slice(0, 2).toString("latin1"), "PK");
    assert.match(unzipEntry(buf, "xl/worksheets/sheet1.xml"), /<f>SUM\(B2:B4\)<\/f>/);
  } finally { await s.stop(); await new Promise((r) => srv.close(r)); }
});

test("saveNamedFile builds workout-plan.docx from markdown, dropping a build script that came with it", () => {
  const text = "# Workout Plan\n\n- Day 1: walk\n\n| Day | Plan |\n|---|---|\n| Mon | Walk |\n\n```python\nfrom docx import Document\nDocument().save('x.docx')\n```\n";
  const r = named.saveNamedFile({ goal: "Write a Word document and save it as workout-plan.docx", text, projectId: "p-office" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.name, "workout-plan.docx");
  const doc = unzipEntry(fs.readFileSync(r.path), "word/document.xml");
  assert.match(doc, /<w:tbl>/);
  assert.match(doc, /Workout Plan/);
  assert.ok(!/from docx import/.test(doc), "the script is not in the document");
});
