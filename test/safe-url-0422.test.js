// 0.4.22 Aikido review (SSRF group): server/safe-url.js is the real helper page-reader's default fetcher uses.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { isPublicHttpUrl } from "../server/safe-url.js";

test("isPublicHttpUrl refuses private, link-local, sneaky names and non-web schemes", () => {
  for (const u of ["http://10.0.0.1/", "http://192.168.1.1/", "http://172.20.0.5/", "http://169.254.169.254/latest/meta-data",
    "http://127.0.0.1.nip.io/", "https://a.sslip.io/", "http://app.localtest.me/", "http://x.lvh.me/", "http://intranet/",
    "file:///etc/passwd", "javascript:alert(1)", "ftp://example.com/", "https://user:pw@example.com/", "not a url"]) {
    assert.equal(isPublicHttpUrl(u, { allowLoopback: true }), false, u);
  }
});

test("isPublicHttpUrl allows public web pages", () => {
  for (const u of ["https://example.com/path", "http://example.com/", "https://93.184.216.34/"]) assert.equal(isPublicHttpUrl(u), true, u);
});

test("loopback is allowed on the desktop and refused in hosted mode", () => {
  assert.equal(isPublicHttpUrl("http://127.0.0.1:8080/x", { allowLoopback: true }), true);
  assert.equal(isPublicHttpUrl("http://localhost:8080/x", { allowLoopback: false }), false);
  assert.equal(isPublicHttpUrl("http://[::1]:8080/x", { allowLoopback: false }), false);
});

test("page-reader's default fetcher checks the address before it fetches", async () => {
  const src = fs.readFileSync(path.join(ROOT, "server/page-reader.js"), "utf8").replace(/\r\n/g, "\n");
  assert.match(src, /import \{ isPublicHttpUrl \} from "\.\/safe-url\.js"/);
  assert.match(src, /if \(!isPublicHttpUrl\(url\)\)/);
  const PR = await import("../server/page-reader.js");
  const r = await PR.defaultFetcher("http://169.254.169.254/latest/meta-data");
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});
