// Phase 20: artifacts side panel. Pure checks of the frame builder and the code-block finder; the running
// server in a temp data dir (create, edit to version 2 with version 1 kept, frame, export, extract, delete);
// a real Chromium (Electron, hidden window) that opens an HTML artifact through the panel code and shows the
// sandboxed frame cannot read the session token or call /api; and the Python runner (fake Pyodide always,
// the real one only when a local copy is installed, since tests never call a real URL).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { startServer, ROOT } from "./helpers.js";
import { findArtifacts, frameHtml, cspFor, chartSvg, markdownHtml, exportFile, PY_RUNNER, PYODIDE_DEFAULT } from "../server/artifacts.js";

const ANSWER = `Here is the page.

## Launch countdown
\`\`\`html
<!doctype html><html><head><title>Countdown</title></head><body><h1>Soon</h1><script>document.body.append("ok")</script></body></html>
\`\`\`

\`\`\`chart
{"type": "bar", "title": "Weekly sales", "labels": ["Mon", "Tue"], "series": [{"name": "Bread", "values": [3, 5]}]}
\`\`\`

\`\`\`python
print(sum(range(10)))
\`\`\`

\`\`\`bash
npm install something
\`\`\`

\`\`\`json
{"not": "a chart"}
\`\`\`
`;

test("artifacts: finder, frame builder, sandbox policy, chart and markdown (pure)", () => {
  const found = findArtifacts(ANSWER);
  assert.deepEqual(found.map((f) => f.kind), ["html", "chart", "python"], "bash and a non-chart JSON block are not artifacts");
  assert.equal(found[0].title, "Countdown");
  assert.equal(found[1].title, "Weekly sales");

  // the frame: CSP first in <head>, no network at all by default, never plain http (the loopback API)
  const html = frameHtml("html", found[0].content);
  const head = html.slice(html.indexOf("<head>"), html.indexOf("<title>"));
  assert.match(head, /Content-Security-Policy/, "the policy comes before the artifact's own head content");
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /form-action 'none'/);
  assert.doesNotMatch(cspFor("html"), /http:/);
  assert.match(cspFor("html", { net: true }), /connect-src https:/, "Allow internet opens https: only");
  assert.doesNotMatch(cspFor("html", { net: true }), /http:|127\.0\.0\.1|localhost/);

  // Python is lazy: only a Python frame mentions Pyodide; nothing in the panel code loads it up front
  for (const k of ["html", "svg", "markdown", "js"]) assert.doesNotMatch(frameHtml(k, k === "svg" ? "<svg xmlns='http://www.w3.org/2000/svg'></svg>" : "x = 1"), /pyodide/i, `${k} frame has no Pyodide`);
  assert.doesNotMatch(frameHtml("chart", found[1].content), /pyodide/i);
  const py = frameHtml("python", "print(1)");
  assert.ok(py.includes(PYODIDE_DEFAULT + "pyodide.js") && /new Worker/.test(py), "a Python frame loads Pyodide in a worker");
  assert.match(cspFor("python"), /connect-src https:\/\/cdn\.jsdelivr\.net/);
  assert.throws(() => frameHtml("python", "1", { pyodideUrl: "http://127.0.0.1:4747/" }), /https/);
  const web = fs.readFileSync(path.join(ROOT, "web", "features", "artifacts.js"), "utf8").replace(/^\s*\/\/.*$/gm, ""); // code only
  assert.match(web, /const SANDBOX = "allow-scripts";/);
  assert.doesNotMatch(web, /allow-same-origin/, "the frame never shares the app's origin");
  assert.doesNotMatch(web, /pyodide\.js|loadPyodide/, "the panel never loads Pyodide itself");
  assert.doesNotMatch(web, /cc-token/, "the panel never hands the token to anything");

  // a closing script tag in JavaScript or Python cannot break out of the runner
  assert.doesNotMatch(frameHtml("js", 'console.log("</script><b>x</b>")').split("<script>").pop(), /<\/script><b>/);

  const svg = chartSvg(found[1].content);
  assert.match(svg, /^<svg[\s\S]*Weekly sales[\s\S]*<rect[\s\S]*<\/svg>$/);
  assert.match(chartSvg('{"type":"pie","data":[{"label":"A","value":1},{"label":"B","value":3}]}'), /75%/);
  assert.match(chartSvg('{"type":"line","labels":["a","b"],"series":[{"name":"s","values":[1,2]}]}'), /<polyline/);
  assert.throws(() => chartSvg('{"type":"radar","labels":["a"],"series":[{"values":[1]}]}'), /not supported/);
  assert.equal(markdownHtml("# Hi\n<script>alert(1)</script>").includes("<script>"), false, "Markdown is escaped first");
  assert.match(markdownHtml("# Hi\n\n- a\n- b"), /<h1>Hi<\/h1>[\s\S]*<ul><li>a<\/li><li>b<\/li><\/ul>/);
  const f = exportFile({ title: "Weekly sales!", kind: "chart" }, { v: 3, content: found[1].content });
  assert.equal(f.filename, "weekly-sales-v3.svg");
  assert.equal(f.mime, "image/svg+xml");
});

test("artifacts: the Python runner collects output, the last value and errors (fake Pyodide)", async () => {
  const fake = (behave) => { const p = { out: null, err: null, setStdout: (o) => (p.out = o.batched), setStderr: (o) => (p.err = o.batched), loadPackagesFromImports: async () => {}, runPythonAsync: async (code) => behave(p, code) }; return p; };
  const ok = await PY_RUNNER(fake((p) => { p.out("45"); return { toJs: () => [1, 2], destroy() {} }; }), "print(sum(range(10)))");
  assert.deepEqual(ok, { ok: true, stdout: "45", stderr: "", result: "[1,2]" });
  const bad = await PY_RUNNER(fake((p) => { p.out("before"); throw new Error("NameError: name 'x' is not defined"); }), "x");
  assert.equal(bad.ok, false);
  assert.equal(bad.stdout, "before");
  assert.match(bad.error, /NameError/);
  // the worker source is this same function, so the frame runs exactly what was tested here
  assert.ok(frameHtml("python", "print(1)").includes("runPython(py,e.data.code)"));
});

const require = createRequire(import.meta.url);
let localPyodide = null;
try { localPyodide = require.resolve("pyodide"); } catch {}
test("artifacts: a simple Python script returns output through real Pyodide", { skip: localPyodide ? false : "Pyodide is not installed locally (npm i -D pyodide); tests never download it from the internet", timeout: 120000 }, async () => {
  const { loadPyodide } = await import("pyodide");
  const py = await loadPyodide();
  const r = await PY_RUNNER(py, "print(sum(range(10)))\n6 * 7");
  assert.equal(r.ok, true);
  assert.equal(r.stdout, "45");
  assert.equal(r.result, "42");
});

test("artifacts: create, edit (version 2, version 1 kept), frame, export, extract, delete", { timeout: 120000 }, async () => {
  const s = await startServer();
  try {
    assert.equal((await s.api("/artifacts", { noToken: true })).status, 401, "needs the session token like every route");
    // the frame's requests arrive with Origin: null, which the server refuses even with a token
    assert.equal((await s.api("/artifacts", { headers: { origin: "null" } })).status, 403);
    assert.equal((await s.raw({ path: "/", headers: { origin: "null" } })).status, 403, "the page with the token is refused too");

    // validation
    assert.equal((await s.api("/artifacts", { method: "POST", body: { kind: "exe", content: "x" } })).status, 400);
    assert.equal((await s.api("/artifacts", { method: "POST", body: { kind: "html", content: "   " } })).status, 400);
    assert.equal((await s.api("/artifacts", { method: "POST", body: { kind: "chart", content: "{nope" } })).status, 400);
    assert.equal((await s.api("/artifacts/settings", { method: "POST", body: { pyodideUrl: "http://127.0.0.1/py/" } })).status, 400);

    const V1 = "<!doctype html><html><head><title>Hello</title></head><body><p>one</p></body></html>";
    const V2 = V1.replace("one", "two");
    const a = (await s.api("/artifacts", { method: "POST", body: { kind: "html", title: "Hello page", content: V1, projectId: "p1" } })).json;
    assert.match(a.id, /^art_/);
    assert.equal(a.versions.length, 1);

    const fr = (await s.api(`/artifacts/${a.id}/frame`)).json;
    assert.equal(fr.sandbox, "allow-scripts");
    assert.ok(fr.html.includes("<p>one</p>"));
    assert.ok(!fr.html.includes(s.token), "the frame never contains the session token");
    assert.match(fr.html, /connect-src 'none'/);

    // edit: version 2, and version 1 stays exactly as it was
    assert.equal((await s.api(`/artifacts/${a.id}/versions`, { method: "POST", body: { content: V1 } })).status, 400, "no change, no version");
    const e = (await s.api(`/artifacts/${a.id}/versions`, { method: "POST", body: { content: V2, note: "say two" } })).json;
    assert.deepEqual(e.versions.map((x) => [x.v, x.content]), [[1, V1], [2, V2]]);
    assert.equal(e.versions[1].note, "say two");
    assert.ok((await s.api(`/artifacts/${a.id}/frame`)).json.html.includes("<p>two</p>"), "the latest version runs by default");
    assert.ok((await s.api(`/artifacts/${a.id}/frame?v=1`)).json.html.includes("<p>one</p>"), "the old version still runs");
    assert.equal((await s.api(`/artifacts/${a.id}/frame?v=9`)).status, 404);
    // re-run of an unsaved edit
    const pv = (await s.api("/artifacts/preview", { method: "POST", body: { kind: "html", content: "<b>draft</b>" } })).json;
    assert.ok(pv.html.includes("<b>draft</b>") && pv.sandbox === "allow-scripts");

    // export: a download of the chosen version
    const ex = await s.raw({ path: `/api/artifacts/${a.id}/export?v=2`, headers: { "x-cc-token": s.token } });
    assert.equal(ex.status, 200);
    assert.equal(ex.headers["content-disposition"], 'attachment; filename="hello-page-v2.html"');
    assert.equal(ex.text, V2);
    assert.equal(ex.headers["content-security-policy"], "sandbox");
    const ex1 = (await s.api(`/artifacts/${a.id}/export?v=1&format=json`)).json;
    assert.deepEqual(ex1, { filename: "hello-page-v1.html", mime: "text/html; charset=utf-8", body: V1 });

    // extract from an answer: html, chart and python; once per run
    const x1 = (await s.api("/artifacts/extract", { method: "POST", body: { text: ANSWER, runId: "run-1", projectId: "p1" } })).json.items;
    assert.deepEqual(x1.map((i) => i.kind), ["html", "chart", "python"]);
    const x2 = (await s.api("/artifacts/extract", { method: "POST", body: { text: ANSWER, runId: "run-1" } })).json.items;
    assert.deepEqual(x2.map((i) => i.id), x1.map((i) => i.id), "the same answer is not saved twice");
    const chart = x1[1];
    const cx = (await s.api(`/artifacts/${chart.id}/export?format=json`)).json;
    assert.equal(cx.filename, "weekly-sales-v1.svg");
    assert.match(cx.body, /^<svg/);
    assert.match((await s.api(`/artifacts/${x1[2].id}/frame`)).json.html, /pyodide\.js/);
    assert.equal((await s.api("/artifacts?runId=run-1")).json.items.length, 3);
    assert.equal((await s.api("/artifacts?projectId=p1")).json.items.length, 4);

    // allow internet is a setting on the artifact, not a new version
    const net = (await s.api(`/artifacts/${a.id}/versions`, { method: "POST", body: { net: true } })).json;
    assert.equal(net.net, true);
    assert.equal(net.versions.length, 2);
    assert.match((await s.api(`/artifacts/${a.id}/frame`)).json.html, /connect-src https:/);

    // it survives a restart of the document store (saved to the data folder)
    assert.ok(fs.existsSync(path.join(s.dir, "artifacts.json")));
    assert.equal((await s.api(`/artifacts/${a.id}`, { method: "DELETE" })).status, 200);
    assert.equal((await s.api(`/artifacts/${a.id}`)).status, 404);
    assert.equal((await s.api("/artifacts")).json.items.length, 3);
  } finally { await s.stop(); }
});

// A real browser engine: Electron's Chromium, hidden window, the app page with its real token.
const electronBin = (() => { try { return require("electron"); } catch { return null; } })();
test("artifacts: in a real browser the sandboxed frame cannot read the session token or call /api", { skip: electronBin && fs.existsSync(electronBin) ? (process.env.CC_SKIP_ELECTRON ? "CC_SKIP_ELECTRON set" : false) : "Electron is not installed", timeout: 120000 }, async (t) => {
  const s = await startServer();
  try {
    const probe = `<!doctype html><html><head><title>probe</title></head><body><script>(async () => {
      const r = {};
      try { r.parent = parent.document.querySelector('meta[name="cc-token"]').content; } catch (e) { r.parent = "blocked"; }
      try { r.top = top.location.href; } catch (e) { r.top = "blocked"; }
      try { r.origin = String(self.origin); } catch (e) { r.origin = "?"; }
      try { r.cookie = document.cookie; } catch (e) { r.cookie = "blocked"; }
      try { localStorage.getItem("x"); r.storage = "open"; } catch (e) { r.storage = "blocked"; }
      for (const [k, u] of [["rel", "/api/state"], ["abs", "${s.base}/api/state"], ["home", "${s.base}/"], ["health", "${s.base}/api/health"]]) {
        try { const x = await fetch(u); r[k] = "status " + x.status + " " + (await x.text()).slice(0, 80); } catch (e) { r[k] = "blocked"; }
      }
      parent.postMessage({ ccProbe: r }, "*");
    })();</script></body></html>`;
    const a = (await s.api("/artifacts", { method: "POST", body: { kind: "html", title: "probe", content: probe } })).json;
    const run = (id) => new Promise((resolve) => {
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
      const c = spawn(electronBin, [path.join(ROOT, "test", "fixtures", "artifact-probe.cjs"), s.base, id], { env, stdio: ["ignore", "pipe", "pipe"] });
      let o = "";
      c.stdout.on("data", (d) => (o += d)); c.stderr.on("data", (d) => (o += d));
      const kill = setTimeout(() => c.kill(), 60000); // a session without a desktop never gets to "ready"
      c.on("exit", () => { clearTimeout(kill); const m = o.match(/^PROBE (.*)$/m); resolve(m ? JSON.parse(m[1]) : { error: "no output: " + o.slice(-400) }); });
      c.on("error", (e) => resolve({ error: e.message }));
    });
    let r = await run(a.id);
    if (r.error && /no output|ENOENT|spawn/.test(r.error)) return t.skip(`Electron could not start here: ${r.error.slice(0, 200)}`);
    assert.equal(r.error, undefined, r.error);
    assert.equal(r.sandbox, "allow-scripts");
    assert.equal(r.fromFrame, true, "the message came from the artifact's frame");
    assert.equal(r.token, s.token, "the app page itself had the token");
    const p = r.probe, all = JSON.stringify(p);
    assert.equal(p.parent, "blocked", "cannot read the app page");
    assert.equal(p.top, "blocked");
    assert.equal(p.origin, "null", "opaque origin");
    assert.ok(!all.includes(s.token), "the token never reached the frame");
    for (const k of ["rel", "abs", "home", "health"]) assert.equal(p[k], "blocked", `${k}: ${p[k]}`);

    // with "Allow internet" on, https: is open but the local API (http) still is not
    await s.api(`/artifacts/${a.id}/versions`, { method: "POST", body: { net: true } });
    r = await run(a.id);
    assert.equal(r.error, undefined, r.error);
    assert.ok(!JSON.stringify(r.probe).includes(s.token));
    for (const k of ["rel", "abs", "home", "health"]) assert.equal(r.probe[k], "blocked", `net on, ${k}: ${r.probe[k]}`);
  } finally { await s.stop(); }
});
