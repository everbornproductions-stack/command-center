// Workstream B (0.4.9): local share links, risky words, masking, the security PDF,
// one Contrarian hooks template, and the plain-language controls. No real key.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { localOnlyHost, riskyHits, maskNotice } from "../web/copy-guard.js";
import { plainLabel, handoffRowNote } from "../web/plain.js";
import { securityPdf, SECURITY_LINES } from "../server/security-pdf.js";
import { TEMPLATES } from "../server/prompts/catalog.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const EM = "\u2014";

test("a link built from this PC is local-only, and a public host is not", () => {
  for (const host of ["localhost", "127.0.0.1", "::1", "pc.local", "10.1.2.3", "192.168.1.9", "172.16.0.4", "172.31.255.1"]) {
    assert.equal(localOnlyHost(host), true, host);
  }
  assert.equal(localOnlyHost("app.example.com"), false);
  assert.equal(localOnlyHost("8.8.8.8"), false);
  assert.equal(localOnlyHost("172.15.0.1"), false);
  assert.equal(localOnlyHost("172.32.0.1"), false);
});

test("never-say phrases are flagged, and guarantee only when credit repair is on", () => {
  const neverSay = "cheap miracle\nguaranteed income";
  const off = riskyHits("We guarantee a result and a cheap miracle.", { neverSay, scf: false });
  assert.ok(off.some((h) => h.word === "cheap miracle"));
  assert.equal(off.some((h) => h.word === "guarantee"), false);
  const on = riskyHits("We guarantee a result.", { neverSay, scf: true });
  assert.ok(on.some((h) => h.word === "guarantee"));
  assert.equal(riskyHits("A normal weekly plan.", { neverSay, scf: true }).length, 0);
});

test("the line under the box names SSNs and account numbers", () => {
  assert.equal(maskNotice(""), "Before sending, SSNs and account numbers are masked.");
  assert.match(maskNotice("SSN 123-45-6789"), /SSNs/);
  assert.match(maskNotice("account 123456789"), /account numbers/);
});

test("plain labels and the handoff row say what happens", () => {
  assert.match(plainLabel("mcp"), /MCP \(a plug-in connection\)/);
  assert.match(plainLabel("oauth"), /OAuth \(sign in with the service\)/);
  assert.match(plainLabel("webhook"), /Webhook \(a web address that receives a message\)/);
  assert.match(plainLabel("senderKey"), /Sender key \(a password for that address\)/);
  assert.match(plainLabel("handoff"), /Handoff \(continue in another chat\)/);
  assert.match(plainLabel("scf"), /SCF mode \(credit repair safety\)/);
  assert.match(handoffRowNote("Claude"), /Continue in Claude copies a prompt and opens that page/);
  assert.match(handoffRowNote("Claude"), /Meldmind does not type or send/);
});

test("the security summary is one PDF page and the route needs the session token", async () => {
  const buf = securityPdf();
  const text = buf.toString("latin1");
  assert.match(text, /^%PDF-1\.4/);
  assert.match(text, /\/Count 1/);
  assert.equal(text.includes(EM), false);
  assert.ok(SECURITY_LINES.some((line) => line.includes("Nothing was charged")));
  assert.ok(SECURITY_LINES.some((line) => line.includes("You can type in any language")));
  const s = await startServer();
  try {
    const open = await s.raw({ path: "/api/help/security.pdf" });
    assert.equal(open.status, 401);
    const pdf = await s.raw({ path: "/api/help/security.pdf", headers: { "x-cc-token": s.token } });
    assert.equal(pdf.status, 200);
    assert.match(pdf.headers["content-type"] || "", /application\/pdf/);
    assert.match(pdf.text, /^%PDF/);
    assert.match(pdf.text, /\/Count 1/);
    const help = await s.api("/help");
    assert.ok(help.json.articles.some((a) => a.id === "security" && a.title === "Security and your data"));
  } finally { await s.stop(); }
});

test("only one template is named Contrarian hooks", () => {
  const named = TEMPLATES.filter((row) => row.name === "Contrarian hooks");
  assert.equal(named.length, 1);
  assert.equal(named[0].id, "contrarian-hooks");
  assert.equal(read("server", "prompts", "pack-more.js").includes("contrarian-view-hooks"), false);
});

test("the screens say the workstream B lines, with no em dash", () => {
  const files = {
    share: read("web", "features", "share.js"),
    schedules: read("web", "features", "schedules.js"),
    app: read("web", "app.js"),
    search: read("web", "features", "search.js"),
    receipt: read("web", "features", "receipt.js"),
    ratings: read("web", "features", "ratings.js"),
    help: read("web", "features", "help.js"),
    prompts: read("web", "features", "prompts.js"),
    market: read("web", "features", "marketplace.js"),
    css: read("web", "styles.css"),
    guide: read("docs", "USER-GUIDE.md"),
    readme: read("README.md"),
  };
  assert.match(files.share, /This link only works on this PC/);
  assert.match(files.share, /Copy the text/);
  assert.match(files.share, /meldmind-share\.md/);
  assert.match(files.share, /aria-label="How long the link lasts"/);
  assert.doesNotMatch(files.share, /toast\("Share link copied"\)[\s\S]{0,80}localOnlyHost/);
  assert.match(files.schedules, /Weekdays at 5 pm/);
  assert.match(files.schedules, /Fridays at 4 pm/);
  assert.match(files.schedules, /aria-label="Days"/);
  assert.match(files.schedules, /catchUp: true/);
  assert.match(files.app, /Click Stop to cancel/);
  assert.match(files.app, /aria-label="Stop"/);
  assert.match(files.app, />Stop</);
  assert.match(files.app, /Still working\.\.\./);
  assert.match(files.app, /id="mask-line" role="note"/);
  assert.match(files.app, /Nothing was charged/);
  assert.match(files.search, /Did not search the web/);
  assert.match(files.receipt, /Nothing was charged/);
  assert.match(files.ratings, /Meldmind now prefers/);
  assert.match(files.help, /You can type in any language/);
  assert.match(files.help, /apiBlobUrl\("\/help\/security\.pdf"\)/);
  assert.match(files.help, /meldmind-security\.pdf/);
  assert.doesNotMatch(files.help, /href="\/api\/help\/security\.pdf"/);
  assert.match(files.prompts, /Real estate and mortgage modes are coming/);
  assert.match(files.market, /Loading Marketplace/);
  assert.match(files.css, /\.hint \{ font-size: 13px/);
  assert.match(files.css, /\.small \{ font-size: 13px/);
  assert.match(files.guide, /^# Meldmind user guide/);
  assert.match(files.guide, /Meldmind-Setup-/);
  assert.doesNotMatch(files.guide, /Command AI/);
  assert.doesNotMatch(files.guide, /Command-AI-Setup/);
  assert.match(files.readme, /The product name is Meldmind/);
  assert.doesNotMatch(files.readme, /Everborn Command Center/);
  assert.match(files.readme, /a "Meldmind" folder/);
  for (const [name, text] of Object.entries(files)) assert.equal(text.includes(EM), false, name);
  for (const file of ["security.md", "using-meldmind.md"]) {
    assert.equal(read("docs", "help", file).includes(EM), false, file);
  }
});
