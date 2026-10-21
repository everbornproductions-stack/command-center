// The password tip: fixed words, two links, dismiss, and a sign-in still asks.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer, tmpDir } from "./helpers.js";

if (!process.env.CC_DATA_DIR) process.env.CC_DATA_DIR = tmpDir("cc-pwtip-");
import { loadHelp, releaseHelpOk } from "../server/help.js";
import {
  TIP_TEXT, ONE_PASSWORD_URL, BITWARDEN_URL, DISMISS_KEY,
  looksLikeLogin, isDismissed, dismiss, tipHtml, isLoginControl,
} from "../web/sign-in-tip.js";

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const EM = "\u2014";
const memory = () => {
  const box = new Map();
  return { getItem: (k) => (box.has(k) ? box.get(k) : null), setItem: (k, v) => box.set(k, String(v)) };
};
const el = (text, dataset = {}, id = "") => ({ textContent: text, dataset, id });

test("the tip uses the fixed words and the two links, and dismiss hides it", () => {
  assert.equal(TIP_TEXT.includes(EM), false);
  assert.equal(/affiliate|referral|commission/i.test(TIP_TEXT), false);
  assert.equal(ONE_PASSWORD_URL, "https://1password.com");
  assert.equal(BITWARDEN_URL, "https://bitwarden.com");
  const store = memory();
  const html = tipHtml(store);
  assert.match(html, /href="https:\/\/1password\.com"/);
  assert.match(html, /href="https:\/\/bitwarden\.com"/);
  assert.match(html, /data-pw-dismiss/);
  assert.equal(html.replace(/<[^>]+>/g, "").includes(TIP_TEXT), true);
  assert.equal(isDismissed(store), false);
  dismiss(store);
  assert.equal(store.getItem(DISMISS_KEY), "1");
  assert.equal(tipHtml(store), "");
  assert.equal(looksLikeLogin("Please sign in to the account"), true);
  assert.equal(looksLikeLogin("Write a picnic plan"), false);
  assert.equal(isLoginControl(el("Connect Google", { pwLogin: "1" })), true);
  assert.equal(isLoginControl(el("Sign in (OAuth)", { signin: "srv" })), true);
  assert.equal(isLoginControl(el("Continue with Google", { sso: "google" })), true);
  assert.equal(isLoginControl(el("Connect with API key", { conn: "key" })), false);
  assert.equal(isLoginControl(el("Dismiss", { pwDismiss: "" })), false);
  assert.equal(isLoginControl(el("Save")), false);
});

test("a sign-in is marked, a password is never echoed, and an ordinary step is not a login", async () => {
  const R = await import("../server/browser-reader.js");
  const BH = await import("../server/browser.js");
  const html = `<!doctype html><html><body>
    <form action="/site/login"><input name="user" placeholder="User name"><input type="password" name="pw" placeholder="Password"><input type="submit" value="Sign in"></form>
    <form method="post" action="/site/contact-send" aria-label="Contact form"><label for="nm">Your name</label><input id="nm" name="name"><button>Send</button></form>
    <a href="/site/about">About</a>
  </body></html>`;
  const p = R.parsePage(html, "http://shop.test/site/");
  const snap = { url: "http://shop.test/site/", title: p.title, elements: p.elements, forms: p.forms.map((f) => ({ ...f, fields: f.fields.map((x) => ({ name: x.name, type: x.type, hidden: !!x.hidden, ref: x.ref || null })) })) };
  const ref = (label) => p.elements.find((e) => e.label === label).ref;
  const sign = BH.assess({ action: "click", ref: ref("Sign in") }, snap);
  assert.equal(sign.ask.kind, "form submit");
  assert.equal(sign.ask.login, true);
  const send = BH.assess({ action: "click", ref: ref("Send") }, snap);
  assert.equal(send.ask.login, undefined);
  assert.equal(BH.assess({ action: "click", ref: ref("About") }, snap).login, undefined);
  const typed = BH.assess({ action: "type", ref: ref("Password"), text: "hunter2-secret" }, snap);
  assert.match(typed.refuse, /never types passwords/);
  assert.equal(typed.login, true);
  assert.equal(JSON.stringify(typed).includes("hunter2-secret"), false);
  const ask = BH.assess({ action: "ask", text: "Please sign in" }, { url: "http://shop.test/", elements: [], forms: [] });
  assert.equal(ask.ask.kind, "your turn");
  assert.equal(ask.ask.login, true);
  const plain = BH.assess({ action: "ask", text: "Read the heading" }, { url: "http://shop.test/about", elements: [], forms: [] });
  assert.equal(plain.ask.login, undefined);
  const src = read("server/browser.js");
  assert.match(src, /risk\.ask\.login \? "your turn" : risk\.ask\.kind/);
  assert.match(src, /loginSeen = true/);
  assert.equal(src.includes(EM), false);
});

test("Help, the guide, and the screens say the same tip", () => {
  const files = [
    "web/sign-in-tip.js",
    "web/app.js",
    "web/features/browser.js",
    "web/features/connect-setup.js",
    "web/features/handoff.js",
    "electron/browser-bar.html",
    "electron/browser-helper.cjs",
    "docs/help/what-meldmind-can-do.md",
    "docs/guide-pdf.json",
    "docs/USER-GUIDE.md",
  ];
  for (const f of files) {
    const text = read(f);
    assert.equal(text.includes(EM), false, f);
    assert.equal(/affiliate|referral code|commission/i.test(text), false, f);
  }
  const plain = (s) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/<[^>]+>/g, "");
  for (const f of ["docs/help/what-meldmind-can-do.md", "docs/guide-pdf.json", "docs/USER-GUIDE.md", "electron/browser-bar.html", "web/sign-in-tip.js"]) {
    assert.equal(plain(read(f)).includes(TIP_TEXT), true, f);
    assert.match(read(f), /https:\/\/1password\.com/);
    assert.match(read(f), /https:\/\/bitwarden\.com/);
  }
  assert.match(read("docs/help/what-meldmind-can-do.md"), /lastUpdatedVersion: 0\.4\.8/);
  assert.match(read("electron/browser-bar.html"), /id="pw"/);
  assert.match(read("electron/browser-helper.cjs"), /https:\/\/1password\.com/);
  assert.match(read("electron/browser-bar-preload.cjs"), /https:\/\/bitwarden\.com/);
  assert.match(read("web/features/browser.js"), /a\.login \? \(window\.CC\.passwordTipHtml/);
  assert.match(read("web/features/index.js"), /"sign-in-tip"/);
  const guide = JSON.parse(read("docs/guide-pdf.json"));
  assert.ok(guide.sections.some((s) => s.id === "passwords" && s.body.includes(TIP_TEXT)));
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.version, "0.4.8");
  const news = JSON.parse(read("docs/WHATS-NEW.json"));
  const gate = releaseHelpOk({ version: pkg.version, news, articles: loadHelp().articles, catalog: loadHelp().catalog });
  assert.equal(gate.ok, true, gate.problems.join("\n"));
});

test("the sign-in gate and a browser job can show the tip", async () => {
  const s = await startServer();
  try {
    const page = await s.api("/browser");
    assert.equal(page.status, 200);
    const html = await fetch(`http://127.0.0.1:${s.port}/sign-in-tip.js`).then((r) => r.text());
    assert.match(html, /Meldmind never stores your passwords/);
    const app = await fetch(`http://127.0.0.1:${s.port}/app.js`).then((r) => r.text());
    assert.match(app, /installPasswordTip\(document, localStorage\)/);
    assert.match(app, /tipHtml\(localStorage\)/);
  } finally {
    await s.stop();
  }
});
