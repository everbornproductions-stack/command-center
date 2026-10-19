// Phase 1: brand kit. Pure validation (logo bytes, colours, text limits) plus the running server.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer } from "./helpers.js";
import { normalize, validateLogo, brandCss, DEFAULTS, LIMITS } from "../server/plugins/brand.js";

// 1x1 transparent PNG
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const svg = (inner) => "data:image/svg+xml;base64," + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`).toString("base64");

test("validateLogo: accepts real PNG and clean SVG; rejects wrong type, mismatched bytes, scripts, oversize", () => {
  assert.equal(validateLogo(PNG), PNG);
  assert.equal(validateLogo(` ${PNG} `), PNG, "trimmed");
  assert.ok(validateLogo(svg('<circle cx="5" cy="5" r="4"/>')));
  assert.throws(() => validateLogo("data:text/html;base64,PGh0bWw+"), /PNG, JPEG, WebP or SVG/);
  assert.throws(() => validateLogo("https://example.com/logo.png"), /data: URL/);
  assert.throws(() => validateLogo("data:image/png;base64,"), /data: URL|empty/);
  // declared PNG, bytes are text
  assert.throws(() => validateLogo("data:image/png;base64," + Buffer.from("hello world, not a png").toString("base64")), /do not match/);
  assert.throws(() => validateLogo("data:image/jpeg;base64," + Buffer.from("iVBORw0KGgo=", "base64").toString("base64")), /do not match/);
  assert.throws(() => validateLogo(svg("<script>alert(1)</script>")), /scripts/);
  assert.throws(() => validateLogo(svg('<circle onload="x()"/>')), /scripts/);
  assert.throws(() => validateLogo(svg('<a href="javascript:x()"><circle/></a>')), /scripts/);
  assert.throws(() => validateLogo(svg("<foreignObject><body/></foreignObject>")), /scripts/);
  assert.throws(() => validateLogo("data:image/svg+xml;base64," + Buffer.from("<div>no svg</div>").toString("base64")), /no <svg>/);
  const big = "data:image/png;base64," + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(LIMITS.logoBytes)]).toString("base64");
  assert.throws(() => validateLogo(big), /too large/);
});

test("normalize: text limits, colours, partial updates, logo clear", () => {
  const k = normalize({ name: "  Acme   Roasters ", tagline: "Fresh\u0000beans", primary: "#ABC", secondary: null }, DEFAULTS);
  assert.equal(k.name, "Acme Roasters"); assert.equal(k.tagline, "Fresh beans"); assert.equal(k.primary, "#aabbcc"); assert.equal(k.secondary, null);
  assert.ok(k.updatedAt > 0);
  assert.equal(normalize({ tagline: "x" }, k).name, "Acme Roasters", "partial update keeps the name");
  assert.equal(normalize({ logo: PNG }, k).logo, PNG);
  assert.equal(normalize({ logo: null }, { ...k, logo: PNG }).logo, null);
  assert.equal(normalize({ logo: "" }, { ...k, logo: PNG }).logo, null);
  assert.equal(normalize({ primary: "" }, k).primary, null);
  assert.throws(() => normalize({ name: "x".repeat(LIMITS.name + 1) }, DEFAULTS), /60 characters/);
  assert.throws(() => normalize({ tagline: "x".repeat(LIMITS.tagline + 1) }, DEFAULTS), /120 characters/);
  assert.throws(() => normalize({ primary: "red" }, DEFAULTS), /primary must be/);
  assert.throws(() => normalize({ secondary: "#12345" }, DEFAULTS), /secondary must be/);
  assert.throws(() => normalize({ logo: "data:text/plain;base64,aGk=" }, DEFAULTS), /PNG, JPEG/);
  assert.throws(() => normalize("nope", DEFAULTS), /object/);
  const css = brandCss({ ...k, logo: PNG });
  assert.match(css, /--brand-primary:#aabbcc/); assert.match(css, /--brand-secondary:#aabbcc/); assert.match(css, /--brand-name:"Acme Roasters"/); assert.match(css, /--brand-has-logo:1/);
  assert.match(brandCss(DEFAULTS), /--brand-primary:#22d3ee/);
});

let s;
before(async () => { s = await startServer(); });
after(async () => { await s?.stop(); });

test("server: round trip, logo upload and removal, css route, invalid → 400 unchanged, reset", async () => {
  assert.equal((await s.api("/brand", { noToken: true })).status, 401);
  const g = await s.api("/brand");
  assert.equal(g.status, 200); assert.equal(g.json.name, ""); assert.equal(g.json.logo, null); assert.equal(g.json.limits.logoBytes, LIMITS.logoBytes);

  const p = await s.api("/brand", { method: "POST", body: { name: "Acme Roasters", tagline: "Small batch", primary: "#ff7000", secondary: "#123456" } });
  assert.equal(p.status, 200); assert.equal(p.json.name, "Acme Roasters"); assert.equal(p.json.primary, "#ff7000"); assert.equal(p.json.secondary, "#123456");

  const l = await s.api("/brand", { method: "POST", body: { logo: PNG } });
  assert.equal(l.status, 200); assert.equal(l.json.logo, PNG); assert.equal(l.json.name, "Acme Roasters", "logo update keeps the text");
  const file = path.join(s.dir, "brand.kit.json");
  assert.ok(fs.existsSync(file), "brand.kit.json written in the temp data dir");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).logo, PNG);

  const css = await s.api("/brand/css");
  assert.equal(css.status, 200);
  assert.match(String(css.headers["content-type"]), /^text\/css/);
  assert.match(css.text, /--brand-primary:#ff7000/); assert.match(css.text, /--brand-name:"Acme Roasters"/); assert.match(css.text, /--brand-has-logo:1/);

  const badLogo = await s.api("/brand", { method: "POST", body: { logo: "data:text/html;base64,PHNjcmlwdD4=" } });
  assert.equal(badLogo.status, 400); assert.equal(badLogo.json.code, "brand_invalid");
  const badColour = await s.api("/brand", { method: "POST", body: { primary: "url(javascript:1)" } });
  assert.equal(badColour.status, 400);
  const still = await s.api("/brand");
  assert.equal(still.json.logo, PNG); assert.equal(still.json.primary, "#ff7000");

  const rm = await s.api("/brand/logo", { method: "DELETE" });
  assert.equal(rm.status, 200); assert.equal(rm.json.logo, null); assert.equal(rm.json.name, "Acme Roasters");
  assert.match((await s.api("/brand/css")).text, /--brand-has-logo:0/);

  const reset = await s.api("/brand", { method: "DELETE" });
  assert.equal(reset.status, 200); assert.equal(reset.json.name, ""); assert.equal(reset.json.primary, null);
  assert.equal((await s.api("/brand/nothing")).status, 404);
  assert.ok((await s.api("/state")).json.plugins.includes("brand"));
});
