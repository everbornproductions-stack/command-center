// Tables inside an answer (0.4.21, dogfood 08). Two shapes are read out of markdown: a pipe table
// (the | Name | Email | kind) and a ```csv code block. Pure: no page, no network, no state, so the
// result card and the tests run the same code. Nothing here sends anything anywhere.

// One line of a pipe table: it starts with a pipe and ends with a pipe.
const PIPE_ROW = /^\s*\|.+\|\s*$/;
// The line under the headings: only dashes, colons, spaces and pipes.
const PIPE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

// "| a | b |" -> ["a", "b"]. A pipe written as \| is a pipe inside the cell, not a column break.
function splitPipe(line) {
  const cells = String(line).trim().replace(/\\\|/g, "\u0000").split("|").map((c) => c.trim().replace(/\u0000/g, "|"));
  if (cells[0] === "") cells.shift();
  if (cells.length && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

// Records of a comma separated file, written the way RFC 4180 asks: a field with a comma, a quote
// or a line break in it is wrapped in quotes, and a quote inside a quoted field is two quotes.
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const s = String(text ?? "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c !== '"') { field += c; continue; }
      if (s[i + 1] === '"') { field += '"'; i++; continue; }
      quoted = false;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = ""; rows.push(row); row = [];
      continue;
    }
    field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

// A row that is short is padded and a row that is long is cut, so every row has the heading's width.
function fit(row, n) {
  const out = (row || []).slice(0, n);
  while (out.length < n) out.push("");
  return out;
}

function tableFrom(headers, rows) {
  if (!headers || !headers.length) return null;
  return { headers, rows: (rows || []).map((r) => fit(r, headers.length)) };
}

// Every table in the answer, in the order they are written.
export function extractTables(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const tables = [];
  let i = 0;
  while (i < lines.length) {
    const open = /^\s*(`{3,}|~{3,})\s*([A-Za-z0-9_-]*)\s*$/.exec(lines[i]);
    if (open) {
      // a fenced block is skipped whole, so pipes and commas in code are never read as a table
      const mark = open[1][0];
      const lang = open[2].toLowerCase();
      const close = new RegExp(`^\\s*${mark}{3,}\\s*$`);
      let j = i + 1;
      while (j < lines.length && !close.test(lines[j])) j++;
      if (lang === "csv") {
        const rows = parseCsv(lines.slice(i + 1, j).join("\n"));
        const t = tableFrom(rows[0], rows.slice(1));
        if (t) tables.push(t);
      }
      i = j + 1;
      continue;
    }
    if (PIPE_ROW.test(lines[i]) && i + 1 < lines.length && PIPE_ROW.test(lines[i + 1]) && PIPE_SEP.test(lines[i + 1])) {
      const headers = splitPipe(lines[i]);
      const rows = [];
      let j = i + 2;
      while (j < lines.length && PIPE_ROW.test(lines[j]) && !PIPE_SEP.test(lines[j])) { rows.push(splitPipe(lines[j])); j++; }
      const t = tableFrom(headers, rows);
      if (t) tables.push(t);
      i = j;
      continue;
    }
    i++;
  }
  return tables;
}

const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// One table as a CSV file: the headings first, then the rows, one record to a line (RFC 4180).
export function toCsv(table) {
  const headers = table?.headers || [];
  const rows = table?.rows || [];
  const lines = [];
  if (headers.length) lines.push(headers.map(csvCell).join(","));
  for (const r of rows) lines.push((r || []).map(csvCell).join(","));
  return lines.length ? `${lines.join("\r\n")}\r\n` : "";
}
