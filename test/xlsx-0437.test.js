// 0.4.37 (dogfood 0435): two spreadsheets the AI got right that Meldmind did not save right.
//  - food-truck-xlsx: Claude drew the sheet as cells ("| | A | B |" over rows "| **1** |") with formulas (=C9*$B$3);
//    it was taken for a layout description and nothing was saved.
//  - release-plan: the final answer was one ```csv block with formulas, but the saver only knew pipe tables and built the
//    file from the step's ten schema tables, with no formulas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tablesFromAnswer, parseCell } from "../server/office-files.js";
import { saveEveryNamedFile } from "../server/save-named-files.js";

const GRID = [
  "**File: truck-sales.xlsx** (single sheet: \"Sales\")",
  "",
  "| | A | B | C | D | E | F | G |",
  "|---|---|---|---|---|---|---|---|",
  "| **1** | **Item Prices** | | | | | | |",
  "| **2** | Item | Price (USD) | | | | | |",
  "| **3** | Taco | 3.50 | | | | | |",
  "| **4** | Burrito | 9.00 | | | | | |",
  "| **5** | Drink | 2.00 | | | | | |",
  "| **7** | **Sales Log** | | | | | | |",
  "| **8** | Date | Location | Tacos Sold | Burritos Sold | Drinks Sold | Revenue | Running Total |",
  "| **9** | 2024-06-01 | Downtown Park | 120 | 25 | 80 | =C9*$B$3+D9*$B$4+E9*$B$5 | =SUM($F$9:F9) |",
  "| **10** | 2024-06-02 | Brewery Row | 95 | 18 | 70 | =C10*$B$3+D10*$B$4+E10*$B$5 | =SUM($F$9:F10) |",
].join("\n");

test("a sheet drawn as cells with row numbers is the sheet, and each value lands in the cell it names", () => {
  const sheets = tablesFromAnswer(GRID);
  assert.equal(sheets.length, 1);
  const rows = sheets[0].rows;
  assert.equal(rows.length, 10, "rows 1 to 10, the missing row 6 kept empty");
  assert.equal(rows[2][0], "Taco"); assert.equal(rows[2][1], "3.50", "B3 is the taco price the formulas use");
  assert.ok(rows[5].every((c) => c === ""), "row 6 is empty");
  assert.equal(rows[8][5], "=C9*$B$3+D9*$B$4+E9*$B$5", "F9 holds the revenue formula");
  assert.deepEqual(parseCell(rows[8][6]), { f: "SUM($F$9:F9)", bold: false });
});

test("a table that only describes a layout is still not taken for the sheet", () => {
  const layout = "| Row | A | B | C |\n|---|---|---|---|\n| Header | Date | Item | Total |\n| Data | dates | names | =SUM |";
  assert.deepEqual(tablesFromAnswer(layout), []);
});

test("the saver builds a spreadsheet from a final answer's csv block, not from a step's schema tables", () => {
  const csv = "Here is the plan.\n\n```csv\nTask,Due Date,Owner,Status,Days Until Due\nArtwork,2026-11-20,Artist,Not Started,=B2-TODAY()\nUpload,2026-11-27,Manager,Not Started,=B3-TODAY()\n```\n";
  const schema = "## Schema\n\n| Column | Type |\n|---|---|\n| Task | Text |\n| Due | Date |\n\n## Phase 1\n\n| Task | Status |\n|---|---|\n| Artwork | In Progress |";
  const saved = [];
  const save = ({ name, text }) => { saved.push(text); return { ok: true, name, requested: name, path: "", bytes: text.length }; };
  saveEveryNamedFile({ goal: "Make an Excel release plan", names: ["single-release-plan.xlsx"], deliverable: csv, tasks: [{ id: "t1", status: "done", output: schema }], save, office: true });
  assert.equal(saved.length, 1);
  assert.match(saved[0], /=B2-TODAY\(\)/, "built from the final answer's csv with its formulas");
});
