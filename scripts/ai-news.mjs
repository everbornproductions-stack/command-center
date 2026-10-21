// Build one weekly AI News draft from local source snapshots, What's new, prompt votes, and highlights.
// The draft is JSON for the owner to approve. Pass --email-out to also write an HTML and text copy.
// This script does not publish and does not send email.
// It does not open provider pages unless you pass --fetch.
import fs from "node:fs";
import path from "node:path";
import { buildIssue, renderEmail, SOURCE_LIST, UNSUBSCRIBE_BASE } from "../server/ai-news.js";

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return "";
  return process.argv[i + 1] || "";
}

const fetchRemote = process.argv.includes("--fetch");
const sourcesPath = arg("--sources");
const whatsPath = arg("--whats-new") || path.join("docs", "WHATS-NEW.json");
const promptsPath = arg("--prompts");
const highlightsPath = arg("--highlights");
const outPath = arg("--out");
const emailOut = arg("--email-out");
const token = arg("--token") || "preview";

function refuseData(file) {
  if (!file) return;
  const abs = path.resolve(file);
  const blocked = path.resolve("data");
  if (abs === blocked || abs.startsWith(blocked + path.sep)) {
    console.error("Refusing to read or write the data directory.");
    process.exit(1);
  }
}

function readJson(file, fallback) {
  if (!file) return fallback;
  refuseData(file);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function loadRemoteSources(list) {
  const out = [];
  for (const source of list) {
    if (!/^https:\/\//.test(source.url)) continue;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(source.url, { signal: ctl.signal, redirect: "follow" });
      const text = await res.text();
      if (!res.ok) {
        console.error(`Skipped ${source.provider}: HTTP ${res.status}`);
        continue;
      }
      out.push({ provider: source.provider, url: source.url, text: text.slice(0, 20000) });
    } catch (e) {
      console.error(`Skipped ${source.provider}: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return out;
}

if (!outPath) {
  console.error("Pass --out draft.json. The file is a draft. It is not published.");
  process.exit(1);
}
refuseData(outPath);
refuseData(emailOut);
if (!sourcesPath && !fetchRemote) {
  console.error("Pass --sources with a JSON file of changelog snapshots. This script does not fetch pages unless you pass --fetch.");
  process.exit(1);
}

const sources = fetchRemote ? await loadRemoteSources(SOURCE_LIST) : readJson(sourcesPath, []);
const whatsNew = readJson(whatsPath, {});
const prompts = readJson(promptsPath, []);
const highlights = readJson(highlightsPath, []);
const issue = buildIssue({ sources, whatsNew, prompts, highlights });
if (issue.status !== "draft") {
  console.error("Refusing to write a file that is not a draft.");
  process.exit(1);
}
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(issue, null, 2)}\n`);
if (emailOut) {
  fs.mkdirSync(emailOut, { recursive: true });
  const mail = renderEmail(issue, { unsubscribeUrl: `${UNSUBSCRIBE_BASE}?token=${encodeURIComponent(token)}` });
  fs.writeFileSync(path.join(emailOut, "issue.html"), mail.html);
  fs.writeFileSync(path.join(emailOut, "issue.txt"), mail.text);
}
console.log(`Draft written. Not published. No email sent. ${outPath}`);
