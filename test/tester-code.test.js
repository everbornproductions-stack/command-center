// Owner script: one single-use code, locked to one email, printed once after it is stored.
// Uses a fake service key and a local server. No real project, no data/ read.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { freePort, ROOT } from "./helpers.js";
import {
  assertOwner, assertServiceKey, assertProjectUrl, makeTesterCode, normalizeEmail, normalizeTier,
  redact, runTesterCode,
} from "../scripts/make-tester-code.mjs";

const scriptPath = path.join(ROOT, "scripts", "make-tester-code.mjs");

function jwt(role) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ role, ref: "local-test" })).toString("base64url");
  return `${header}.${payload}.sig`;
}

test("the script is owner-only and refuses a publishable key", () => {
  assert.throws(() => assertOwner({}), /owner-only/);
  assert.throws(() => assertOwner({ CC_DEV_OWNER: "1", CC_PACKAGED: "1" }), /packaged/);
  assert.doesNotThrow(() => assertOwner({ CC_DEV_OWNER: "1" }));
  assert.throws(() => assertServiceKey(""), /service role key/);
  assert.throws(() => assertServiceKey("sb_publishable_abcdefghijklmnop"), /publishable key/);
  assert.throws(() => assertServiceKey(jwt("anon")), /not a service role key/);
  assert.throws(() => assertServiceKey(jwt("authenticated")), /not a service role key/);
  assert.equal(assertServiceKey(jwt("service_role")), jwt("service_role"));
  assert.equal(assertServiceKey("sb_secret_abcdefghijklmnop"), "sb_secret_abcdefghijklmnop");
  assert.throws(() => assertProjectUrl(""), /CC_SUPABASE_URL/);
  assert.throws(() => assertProjectUrl("http://example.com"), /https/);
  assert.equal(assertProjectUrl("http://127.0.0.1:9/"), "http://127.0.0.1:9");
  assert.equal(normalizeEmail(" Ada@Example.com "), "ada@example.com");
  assert.throws(() => normalizeEmail("not-an-email"), /--email/);
  assert.equal(normalizeTier(""), "pro");
  assert.equal(normalizeTier("studio"), "studio");
  assert.throws(() => normalizeTier("owner"), /does not make an owner key/);
  const code = makeTesterCode(Buffer.from([0, 31, 1, 2, 3, 4, 5, 6]));
  assert.match(code, /^TEST-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
  assert.equal(code, "TEST-A9BC-DEFG");
  const src = fs.readFileSync(scriptPath, "utf8");
  assert.equal(src.includes("ezbpstloczzdlcxwliwu"), false);
  assert.equal(src.includes("data/"), false);
  assert.equal(src.includes("data\\"), false);
  assert.equal(src.includes("\u2014"), false);
  assert.match(redact(`nope ${jwt("service_role")} here`, jwt("service_role")), /\[redacted\]/);
});

test("runTesterCode stores one locked code and prints it once", async () => {
  const key = jwt("service_role");
  const printed = [];
  let calls = 0;
  const result = await runTesterCode({
    env: { CC_DEV_OWNER: "1", CC_SUPABASE_URL: "http://127.0.0.1:9", CC_SUPABASE_SERVICE_KEY: key },
    argv: ["--email", "Ada@Example.com", "--tier", "studio"],
    fetchImpl: async (url, opts) => {
      calls += 1;
      assert.match(url, /\/rest\/v1\/rpc\/create_tester_code$/);
      assert.equal(opts.headers.apikey, key);
      assert.equal(opts.headers.authorization, `Bearer ${key}`);
      const body = JSON.parse(opts.body);
      assert.equal(body.p_email, "ada@example.com");
      assert.equal(body.p_tier, "studio");
      assert.match(body.p_code, /^TEST-/);
      return { ok: true, status: 200, text: async () => JSON.stringify(body.p_code) };
    },
    print(code) { printed.push(code); },
  });
  assert.equal(calls, 1);
  assert.equal(printed.length, 1);
  assert.equal(printed[0], result.code);
  assert.equal(result.email, "ada@example.com");
  assert.equal(result.tier, "studio");
  assert.equal(printed[0].includes(key), false);

  await assert.rejects(
    () => runTesterCode({
      env: { CC_DEV_OWNER: "1", CC_SUPABASE_URL: "http://127.0.0.1:9", CC_SUPABASE_SERVICE_KEY: key },
      argv: ["--email", "ada@example.com", "--tier", "owner"],
      fetchImpl: async () => { throw new Error("should not store"); },
      print() { throw new Error("should not print"); },
    }),
    /owner key/,
  );

  await assert.rejects(
    () => runTesterCode({
      env: { CC_SUPABASE_URL: "http://127.0.0.1:9", CC_SUPABASE_SERVICE_KEY: key },
      argv: ["--email", "ada@example.com"],
      fetchImpl: async () => { throw new Error("should not store"); },
      print() { throw new Error("should not print"); },
    }),
    /owner-only/,
  );
});

test("a failed store prints nothing, and a leaked key is redacted", async () => {
  const key = jwt("service_role");
  const printed = [];
  await assert.rejects(
    () => runTesterCode({
      env: { CC_DEV_OWNER: "1", CC_SUPABASE_URL: "http://127.0.0.1:9", CC_SUPABASE_SERVICE_KEY: key },
      argv: ["--email", "ada@example.com"],
      fetchImpl: async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ message: `rejected ${key}` }) }),
      print() { printed.push("no"); },
    }),
    (err) => {
      assert.equal(printed.length, 0);
      assert.equal(String(err.message).includes(key), false);
      assert.match(err.message, /\[redacted\]/);
      return true;
    },
  );

  await assert.rejects(
    () => runTesterCode({
      env: { CC_DEV_OWNER: "1", CC_SUPABASE_URL: "http://127.0.0.1:9", CC_SUPABASE_SERVICE_KEY: key },
      argv: ["--email", "ada@example.com"],
      fetchImpl: async () => ({ ok: false, status: 404, text: async () => JSON.stringify({ message: "Could not find the function public.create_tester_code in the schema cache" }) }),
      print() { printed.push("no"); },
    }),
    /Apply the per-person migration/,
  );
  assert.equal(printed.length, 0);
});

test("the CLI prints the stored code once and never the service key", async () => {
  const key = jwt("service_role");
  const port = await freePort();
  let hits = 0;
  let stored = "";
  const server = http.createServer(async (req, res) => {
    hits += 1;
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    stored = body.p_code;
    assert.equal(body.p_email, "ada@example.com");
    assert.equal(body.p_tier, "pro");
    assert.equal(req.headers.apikey, key);
    res.writeHead(200, { "content-type": "application/json", connection: "close" });
    res.end(JSON.stringify(body.p_code));
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  const run = (extra = {}) => new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, "--email", "ada@example.com"], {
      env: {
        ...process.env,
        CC_DEV_OWNER: "1",
        CC_PACKAGED: "",
        CC_SUPABASE_URL: `http://127.0.0.1:${port}`,
        CC_SUPABASE_SERVICE_KEY: key,
        ...extra,
      },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { err += c; });
    child.on("exit", (code) => resolve({ code, out, err }));
  });
  try {
    const ok = await run();
    assert.equal(ok.code, 0, ok.err);
    assert.equal(hits, 1);
    assert.equal(ok.out.split(stored).length - 1, 1);
    assert.equal(ok.out.includes(key), false);
    assert.match(ok.out, /single use, pro/);
    const before = hits;
    const denied = await run({ CC_DEV_OWNER: "" });
    assert.equal(denied.code, 1);
    assert.equal(denied.out, "");
    assert.match(denied.err, /owner-only/);
    assert.equal(hits, before);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
