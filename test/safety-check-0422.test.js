// Safety check (0.4.22): local scanners, grouping, masking, Fix it + rescan, the plugin routes, the Publish gate,
// and the card words. Synthetic keys are built from pieces so scanners stay quiet. No network.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { runSafetyCheck, applySafetyFix, runSafetyCheckOsv, mask } from "../server/safety-check.js";
import { cardHtml, previewLine } from "../web/safety-card.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const KEY = "sk-" + "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5";
const KEY2 = "ghp_" + "Q9w8E7r6T5y4U3i2O1p0A9s8D7f6G5h4J3k2";
const find = (r, id) => r.groups.find((g) => g.id === id);

test("a live secret is found, masked, and never appears in the output", () => {
  const r = runSafetyCheck({ files: [{ path: "server/app.js", text: `const apiKey = "${KEY}";\nconst t = "${KEY2}";\n` }], now: 0 });
  const g = find(r, "secret-live");
  assert.equal(g.count, 2);
  assert.equal(g.severity, "high");
  assert.equal(g.files[0].line, 1);
  assert.match(g.files[0].snippet, /sk-\*\*\*\*/);
  assert.equal(mask(KEY), "sk-****");
  const json = JSON.stringify(r);
  assert.equal(json.includes(KEY), false);
  assert.equal(json.includes(KEY2), false);
  assert.equal(json.includes(KEY.slice(3, 14)), false, "no part of the value past the first 3 characters");
  assert.equal(r.light, "red");
  assert.equal(r.checkedAt, new Date(0).toISOString());
});

test("placeholders are ignored with a reason, and do not turn the light red", () => {
  const r = runSafetyCheck({ files: [{ path: "src/a.js", text: `const key = "sk-your-key-goes-here-1234567890";\nconst k2 = "${"sk-" + "x".repeat(30)}";\n` }, { path: ".env.example", text: "OPENAI_API_KEY=" + KEY + "\n" }] });
  assert.equal(r.light, "green");
  assert.equal(r.groups.length, 0);
  assert.ok(r.ignored.length >= 1);
  assert.ok(r.ignored.every((g) => g.ignored && g.ignoreReason));
  assert.ok(r.ignored.some((g) => /placeholder/i.test(g.ignoreReason)));
  assert.ok(r.ignored.some((g) => /example/i.test(g.ignoreReason)));
});

test("secrets in test files and fixtures are downgraded to low and do not turn the light amber or red", () => {
  const r = runSafetyCheck({ files: [
    { path: "test/a.test.js", text: `const k = "${KEY}";` },
    { path: "fixtures/data.json", text: `{"token":"${KEY2}"}` },
    { path: "lib/x.spec.ts", text: `const k = "${KEY}";` },
  ] });
  const g = find(r, "secret-test");
  assert.equal(g.count, 3);
  assert.equal(g.severity, "low");
  assert.equal(r.groups.some((x) => x.id === "secret-live"), false);
  assert.equal(r.light, "green");
});

test("many similar hits become one group with a count and a TL;DR", () => {
  const files = Array.from({ length: 5 }, (_, i) => ({ path: `web/p${i}.js`, text: `el.innerHTML = "<b>" + name${i};\nconst ok = 1;\n` }));
  const r = runSafetyCheck({ files });
  const g = find(r, "code-html");
  assert.equal(r.groups.filter((x) => x.rule === "code-html").length, 1);
  assert.equal(g.count, 5);
  assert.equal(g.files.length, 5);
  assert.match(g.tldr, /\S/);
  assert.equal(r.light, "amber");
});

test("dependencies: undici 7.30.1 is flagged, 8.10.2 is not; the lock file wins over the range", () => {
  const bad = runSafetyCheck({ files: [{ path: "package-lock.json", text: JSON.stringify({ packages: { "": {}, "node_modules/undici": { version: "7.30.1" } } }) }] });
  const g = bad.groups.find((x) => x.rule === "dependency");
  assert.ok(g, "advisory hit");
  assert.match(g.files[0].snippet, /undici 7\.30\.1/);
  assert.match(g.files[0].snippet, /8\.10\.2/);
  assert.equal(bad.light, "amber");
  const good = runSafetyCheck({ files: [{ path: "package-lock.json", text: JSON.stringify({ packages: { "node_modules/undici": { version: "8.10.2" } } }) }] });
  assert.equal(good.groups.length, 0);
  assert.equal(good.light, "green");
  const range = runSafetyCheck({ files: [{ path: "package.json", text: JSON.stringify({ dependencies: { undici: "^7.30.1" } }) }] });
  assert.ok(range.groups.some((x) => x.rule === "dependency"));
  const both = runSafetyCheck({ files: [{ path: "package.json", text: JSON.stringify({ dependencies: { undici: "^7.30.1" } }) }, { path: "package-lock.json", text: JSON.stringify({ packages: { "node_modules/undici": { version: "8.10.2" } } }) }] });
  assert.equal(both.groups.length, 0, "the exact locked version is what counts");
  const py = runSafetyCheck({ files: [{ path: "requirements.txt", text: "requests==2.25.0\nflask==3.0.0\n" }] });
  assert.equal(py.groups.length, 1);
  assert.match(py.groups[0].title, /requests/i);
});

test("the online lookup is off by default and only gets names and versions when given", async () => {
  const files = [{ path: "package-lock.json", text: JSON.stringify({ packages: { "node_modules/leftpad": { version: "1.0.0" } } }), }, { path: "app.js", text: `const k = "${KEY}";` }];
  const seen = [];
  const r0 = await runSafetyCheckOsv({ files });
  assert.equal(r0.groups.some((g) => g.id === "dep-osv"), false);
  const r1 = await runSafetyCheckOsv({ files, osvFetch: async (qs) => { seen.push(...qs); return qs.map(() => ({ vulns: [{ id: "OSV-1", summary: "bad thing" }] })); } });
  assert.ok(r1.groups.some((g) => g.id === "dep-osv"));
  assert.deepEqual(seen, [{ ecosystem: "npm", name: "leftpad", version: "1.0.0" }]);
  assert.equal(JSON.stringify(seen).includes(KEY), false, "no code is sent");
});

test("code rules show the exact line, say may be a false alarm, and cover the listed patterns", () => {
  const text = [
    `const a = eval(userInput);`,
    `const f = new Function("a", body);`,
    `el.innerHTML = "<p>" + title + "</p>";`,
    `document.write(html);`,
    `const { exec } = require("child_process");`,
    "exec(`git log ${branch}`);",
    `const adminPassword = "hunter2";`,
    `res.setHeader("Access-Control-Allow-Origin", "*");`,
    `res.setHeader("Access-Control-Allow-Credentials", "true");`,
    `fetch("http://api.shop.org/pay", { method: "POST" });`,
  ].join("\n");
  const r = runSafetyCheck({ files: [{ path: "server/x.js", text }] });
  const ids = r.groups.map((g) => g.id).sort();
  for (const want of ["admin-password", "code-eval", "code-exec", "code-html", "cors-open", "form-http"]) assert.ok(ids.includes(want), want);
  assert.equal(find(r, "code-eval").count, 2);
  assert.equal(find(r, "code-eval").files[0].snippet, "const a = eval(userInput);");
  assert.equal(find(r, "code-eval").files[0].line, 1);
  assert.equal(find(r, "code-exec").files[0].line, 6);
  assert.ok(r.groups.filter((g) => g.rule.startsWith("code-")).every((g) => g.mayBeFalseAlarm));
  assert.equal(JSON.stringify(r).includes("hunter2"), false, "the password value is hidden");
  assert.match(find(r, "admin-password").files[0].snippet, /\*\*\*\*/);
  // safe forms are not flagged
  const calm = runSafetyCheck({ files: [{ path: "a.js", text: `el.innerHTML = "<b>hi</b>";\nel.innerHTML = \`<i>\${esc(name)}</i>\`;\nconst r = /a/.exec(s);\nconst v = eval("1+1");\n` }] });
  assert.equal(calm.groups.length, 0);
  assert.ok(calm.ignored.some((g) => /cleaned/i.test(g.ignoreReason)), "escaped values are ignored with a reason");
});

test("site checks: missing Content-Security-Policy, mixed content, http form", () => {
  const html = `<!doctype html><html><head><title>x</title></head><body><img src="http://img.shop.org/a.png"><form action="http://shop.org/buy"></form></body></html>`;
  const r = runSafetyCheck({ files: [{ path: "index.html", text: html }] });
  assert.ok(find(r, "site-csp"));
  assert.ok(find(r, "mixed-content"));
  assert.ok(find(r, "form-http"));
  const withCsp = runSafetyCheck({ files: [{ path: "index.html", text: html.replace("<head>", `<head><meta http-equiv="Content-Security-Policy" content="default-src 'self'">`) }] });
  assert.equal(find(withCsp, "site-csp"), undefined);
  const lang = runSafetyCheck({ files: [{ path: "i.html", text: `<html><head><meta http-equiv="Content-Security-Policy" content="x"></head><body></body></html>` }] });
  assert.equal(lang.light, "green", "a missing viewport or lang is not a safety issue");
});

test("a clean project is green; red only comes from a live secret", () => {
  const clean = runSafetyCheck({ files: [{ path: "app.js", text: "const key = process.env.API_KEY;\nconsole.log('hi');\n" }, { path: "README.md", text: "# hi" }] });
  assert.equal(clean.light, "green");
  assert.match(clean.summary, /No problems/);
  assert.equal(runSafetyCheck({ files: [] }).light, "green");
  const amber = runSafetyCheck({ files: [{ path: "a.js", text: "eval(x);" }] });
  assert.equal(amber.light, "amber");
  assert.equal(runSafetyCheck({ files: [{ path: "a.js", text: `const k = "${KEY}";` }] }).light, "red");
});

test("Fix it moves a live secret to an environment variable, adds .env.example, and the rescan is clean", () => {
  const files = [{ path: "server/app.js", text: `const apiKey = "${KEY}";\nconst h = { Authorization: "Bearer ${KEY2}" };\n` }, { path: "index.html", text: `<html><head></head><body></body></html>` }];
  const out = applySafetyFix({ files, fixId: "all" });
  const app = out.changed.find((c) => c.path === "server/app.js").text;
  assert.match(app, /const apiKey = process\.env\.API_KEY;/);
  assert.match(app, /"Bearer " \+ process\.env\.[A-Z_0-9]+ \+ ""/);
  assert.equal(app.includes(KEY), false);
  const ex = out.changed.find((c) => c.path === ".env.example").text;
  assert.match(ex, /^API_KEY=$/m);
  assert.match(out.changed.find((c) => c.path === "index.html").text, /Content-Security-Policy/);
  assert.equal(out.result.light, "green");
  assert.equal(out.left, 0);
  assert.equal(out.message, "Fixed, rescanned: 0 left");
  assert.match(out.note, /change it at its website, because it may already be seen/);
  assert.equal(JSON.stringify(out.result).includes(KEY), false);
  // a non-JS file gets a clearly marked placeholder
  const py = applySafetyFix({ files: [{ path: "config.py", text: `TOKEN = "${KEY2}"\n` }], fixId: "secrets" });
  assert.match(py.changed.find((c) => c.path === "config.py").text, /REPLACE_WITH_/);
  assert.equal(py.result.light, "green");
  // http to https only for well known hosts
  const web = applySafetyFix({ files: [{ path: "i.html", text: `<html><head><meta http-equiv="Content-Security-Policy" content="x"></head><body><script src="http://cdn.jsdelivr.net/a.js"></script><img src="http://img.shop.org/a.png"></body></html>` }], fixId: "https" });
  const t = web.changed.find((c) => c.path === "i.html").text;
  assert.match(t, /https:\/\/cdn\.jsdelivr\.net/);
  assert.match(t, /http:\/\/img\.shop\.org/);
  assert.match(web.message, /1 left/);
});

let s, dir;
before(async () => { s = await startServer(); dir = s.dir; });
after(async () => { await s?.stop(); });

test("plugin: check and fix a project folder, patched files are written back, the last result is kept per project", async () => {
  const proj = path.join(dir, "projects", "site1");
  fs.mkdirSync(path.join(proj, "src"), { recursive: true });
  fs.writeFileSync(path.join(proj, "src", "app.js"), `const apiKey = "${KEY}";\n`);
  fs.writeFileSync(path.join(proj, "index.html"), "<html><head></head><body>hi</body></html>");
  const c = await s.api("/safety/check", { method: "POST", body: { projectId: "site1" } });
  assert.equal(c.status, 200);
  assert.equal(c.json.light, "red");
  assert.equal(JSON.stringify(c.json).includes(KEY), false);
  const last = await s.api("/safety/last?projectId=site1");
  assert.equal(last.json.light, "red");
  assert.equal(last.json.hasLive, true);
  const f = await s.api("/safety/fix", { method: "POST", body: { projectId: "site1", fixId: "all" } });
  assert.equal(f.status, 200);
  assert.equal(f.json.written, true);
  assert.equal(f.json.message, "Fixed, rescanned: 0 left");
  assert.ok(f.json.note);
  assert.equal(JSON.stringify(f.json).includes(KEY), false);
  assert.match(fs.readFileSync(path.join(proj, "src", "app.js"), "utf8"), /process\.env\.API_KEY/);
  assert.match(fs.readFileSync(path.join(proj, ".env.example"), "utf8"), /API_KEY=/);
  assert.match(fs.readFileSync(path.join(proj, "index.html"), "utf8"), /Content-Security-Policy/);
  assert.equal((await s.api("/safety/last?projectId=site1")).json.light, "green");
  // files sent by the page: nothing is written, texts come back
  const g = await s.api("/safety/fix", { method: "POST", body: { files: [{ path: "a.js", text: `const k = "${KEY2}";` }], fixId: "secrets" } });
  assert.equal(g.json.written, false);
  assert.match(g.json.files.find((x) => x.path === "a.js").text, /process\.env/);
  assert.equal((await s.api("/safety/check", { method: "POST", body: {} })).status, 400);
  const empty = await s.api("/safety/check", { method: "POST", body: { projectId: "nope" } });
  assert.equal(empty.json.light, "green");
});

test("Publish: a live secret in the words needs Publish anyway; a clean post is not blocked", async () => {
  const clean = await s.api("/publish/preview", { method: "POST", body: { channel: "slack", title: "Hi", text: "Our new shop is open." } });
  assert.equal(clean.json.safety.light, "green");
  const ok = await s.api("/publish/post", { method: "POST", body: { channel: "slack", previewId: clean.json.previewId, confirmed: true } });
  assert.notEqual(ok.json.code, "safety_red");
  const risky = await s.api("/publish/preview", { method: "POST", body: { channel: "slack", title: "Hi", text: `Use this key: ${KEY}` } });
  assert.equal(risky.json.safety.light, "red");
  assert.equal(JSON.stringify(risky.json).includes(KEY), false);
  const blocked = await s.api("/publish/post", { method: "POST", body: { channel: "slack", previewId: risky.json.previewId, confirmed: true } });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.code, "safety_red");
  const again = await s.api("/publish/post", { method: "POST", body: { channel: "slack", previewId: risky.json.previewId, confirmed: true, publishAnyway: true } });
  assert.notEqual(again.json.code, "safety_red", "Publish anyway goes on to the normal path");
  // the setting turns the step off
  await s.api("/settings", { method: "POST", body: { safetyCheck: false } });
  assert.equal((await s.api("/safety/status")).json.enabled, false);
  const off = await s.api("/publish/preview", { method: "POST", body: { channel: "slack", title: "Hi", text: `Use this key: ${KEY}` } });
  assert.equal(off.json.safety, null);
  await s.api("/settings", { method: "POST", body: { safetyCheck: true } });
});

test("card words, the false alarm line, the Publish wiring, Help and Settings text", () => {
  const r = runSafetyCheck({ files: [{ path: "a.js", text: `const x = eval(q);\nconst k = "${KEY}";` }] });
  const html = cardHtml(r);
  assert.match(html, /Safety check/);
  assert.match(html, /TL;DR/);
  assert.match(html, /may be a false alarm/i);
  assert.match(html, /data-sf-fix="all"/);
  assert.match(html, /Rescan/);
  assert.match(html, /No code leaves your PC/);
  assert.equal(html.includes(KEY), false);
  assert.match(previewLine({ light: "red", summary: "x" }), /Safety check/);
  for (const t of [html, read("web", "features", "safety.js"), read("docs", "help", "safety-and-sending.md")]) assert.equal(/[—–]/.test(t), false, "no em or en dashes");
  const web = read("web", "features", "safety.js");
  assert.match(web, /Safety check before publish/);
  assert.match(web, /Publish anyway/);
  assert.match(web, /Download anyway/);
  assert.match(read("web", "features", "publish.js"), /publishAnyway/);
  assert.match(read("web", "features", "result-hero.js"), /CC\.safety\?\.beforeShare/);
  assert.match(read("web", "perf", "registry.js"), /id: "safety"/);
  assert.match(read("docs", "help", "safety-and-sending.md"), /Safety check before publish/);
  assert.match(read("server", "plugins", "publish.js"), /safety_red/);
});
