// Phone pairing: localhost only until Settings turns it on, then the PC's private
// IPv4, a pairing code, and a private-network firewall rule. No real key.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { startServer, ROOT, raw } from "./helpers.js";
import {
  BAD_LINK, NO_LAN, PHONE_FETCH, firewallAddArgs, firewallDeleteArgs, ensureWindowsFirewall,
  isPrivateIPv4, preferredLanIPv4, readInterfaces,
} from "../server/pairing.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (ok) => { try { socket.destroy(); } catch {} resolve(ok); };
    socket.setTimeout(800);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

test("private address choice, firewall args, and the Settings copy", async () => {
  assert.equal(isPrivateIPv4("192.168.1.9"), true);
  assert.equal(isPrivateIPv4("10.0.0.1"), true);
  assert.equal(isPrivateIPv4("172.16.0.1"), true);
  assert.equal(isPrivateIPv4("172.31.255.255"), true);
  assert.equal(isPrivateIPv4("172.15.0.1"), false);
  assert.equal(isPrivateIPv4("172.32.0.1"), false);
  assert.equal(isPrivateIPv4("127.0.0.1"), false);
  assert.equal(isPrivateIPv4("8.8.8.8"), false);
  assert.equal(isPrivateIPv4("169.254.1.1"), false);
  const ifaces = {
    a: [{ address: "172.30.0.2", family: "IPv4", internal: false }],
    b: [{ address: "10.1.2.3", family: "IPv4", internal: false }],
    c: [{ address: "192.168.1.20", family: "IPv4", internal: false }],
    d: [{ address: "8.8.8.8", family: "IPv4", internal: false }],
    e: [{ address: "169.254.1.1", family: "IPv4", internal: false }],
    f: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
  };
  assert.equal(preferredLanIPv4(ifaces), "192.168.1.20");
  assert.equal(preferredLanIPv4({ lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }] }), null);

  const add = firewallAddArgs("C:\\Program Files\\Meldmind\\Meldmind.exe");
  assert.ok(add);
  assert.ok(add.includes("profile=private"));
  assert.ok(add.includes('program="C:\\Program Files\\Meldmind\\Meldmind.exe"'));
  assert.equal(add.some((a) => /profile=(public|any|domain)\b/i.test(a)), false);
  assert.equal(firewallAddArgs("C:/nope.exe"), null);
  assert.equal(firewallAddArgs("C:\\bad\"path.exe"), null);
  assert.match(firewallDeleteArgs().join(" "), /Meldmind phone pairing/);
  const fw = await ensureWindowsFirewall();
  assert.equal(fw.skipped, true);
  assert.equal(fw.ok, true);

  const nsh = read("build", "firewall.nsh");
  const yml = read("electron-builder.yml");
  assert.match(nsh, /customInstall/);
  assert.match(nsh, /customUnInstall/);
  assert.match(nsh, /name="Meldmind phone pairing"/);
  assert.match(nsh, /program="\$INSTDIR\\Meldmind\.exe"/);
  assert.match(nsh, /profile=private/);
  assert.equal(/profile=(public|any)\b/i.test(nsh), false);
  assert.match(yml, /include:\s*build\/firewall\.nsh/);

  const app = read("web", "app.js");
  const server = read("server", "index.js");
  assert.match(app, /id="pair-url"/);
  assert.match(app, /id="pair-copy"/);
  assert.match(app, />Copy</);
  assert.match(app, /Phone pairing/);
  assert.ok(app.includes(PHONE_FETCH));
  assert.match(app, /Could not copy\. Select the address and copy it\./);
  assert.equal(app.includes("\u2014"), false);
  assert.match(server, /server\.listen\(PORT, HOSTED \? "0\.0\.0\.0" : "127\.0\.0\.1"/);
  assert.match(server, /lan\.listen\(PORT, ip/);
  assert.equal(read("server", "pairing.js").includes("\u2014"), false);
  assert.equal(read("docs", "help", "phone.md").includes("\u2014"), false);
});

test("pairing stays on this computer until it is turned on, then the phone must present the code", { timeout: 90000 }, async () => {
  const ip = preferredLanIPv4(readInterfaces());
  assert.ok(ip, "this machine needs a private IPv4 for the pairing test");
  const s = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try {
    assert.equal(await canConnect(ip, s.port), false, "LAN is closed while pairing is off");
    assert.equal((await s.api("/health")).status, 200);
    const sneaky = await s.api("/settings", { method: "POST", body: { phonePair: { on: true, token: "a".repeat(64) } } });
    assert.equal(sneaky.status, 200);
    assert.equal(sneaky.json.phonePair, undefined);
    assert.equal(await canConnect(ip, s.port), false, "settings cannot open the LAN port");

    const on = await s.api("/pairing", { method: "POST", body: { on: true } });
    assert.equal(on.status, 200);
    assert.equal(on.json.on, true);
    assert.equal(on.json.error, null);
    assert.equal(on.json.address, ip);
    const u = new URL(on.json.url);
    assert.equal(u.protocol, "http:");
    assert.equal(u.hostname, ip);
    assert.equal(u.port, String(s.port));
    assert.equal(u.pathname, "/");
    const token = u.searchParams.get("pair");
    assert.equal(/^[a-f0-9]{64}$/.test(token), true);
    assert.equal(s.log.includes(token), false, "the pairing code is not logged");
    // The feed is what the app shows. A Windows runner block-buffers later console lines, so the process log can miss them.
    const feed = () => s.api("/state").then((r) => r.json.recent || []);
    assert.ok((await feed()).some((e) => e.type === "log" && e.text === `Phone pairing on at ${ip}:${s.port}.`), "the feed says pairing is on");

    const home = await s.raw({ path: "/" });
    assert.equal(home.status, 200);
    assert.ok(home.text.includes('name="cc-token"'), "this computer still gets the app without the pairing code");

    const qr = await s.api("/pairing/qr.svg");
    assert.equal(qr.status, 200);
    assert.match(String(qr.headers["content-type"] || ""), /image\/svg\+xml/);
    assert.match(qr.text, /<svg/i);

    const bad = await raw({ host: ip, port: s.port, path: "/?pair=" + "ab".repeat(32) });
    assert.equal(bad.status, 401);
    assert.equal(bad.text.includes("cc-token"), false);
    assert.equal(bad.text.includes(token), false);
    assert.match(bad.text, /not valid/);
    assert.equal(bad.headers["set-cookie"], undefined);

    const page = await raw({ host: ip, port: s.port, path: `/?pair=${token}` });
    assert.equal(page.status, 200);
    assert.ok(page.text.includes('name="cc-token"'));
    assert.equal(page.text.includes(token), false, "the pairing code is not copied into the page");
    const setCookie = [].concat(page.headers["set-cookie"] || []).join(";");
    assert.match(setCookie, /cc-pair=/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(page.headers["referrer-policy"] || "", /no-referrer/);

    const bare = await raw({ host: ip, port: s.port, path: "/app.js" });
    assert.equal(bare.status, 401);
    assert.equal(bare.text.includes("cc-token"), false);
    assert.equal(bare.text, BAD_LINK);
    const script = await raw({ host: ip, port: s.port, path: "/app.js", headers: { cookie: `cc-pair=${token}` } });
    assert.equal(script.status, 200);

    const state = await raw({
      host: ip, port: s.port, path: "/api/state",
      headers: { origin: `http://${ip}:${s.port}`, "x-cc-token": s.token },
    });
    assert.equal(state.status, 200);
    const evilHost = await raw({ host: ip, port: s.port, path: "/", headers: { host: `evil.example:${s.port}` } });
    assert.equal(evilHost.status, 421);
    assert.equal(evilHost.text.includes("cc-token"), false);
    const evilOrigin = await raw({
      host: ip, port: s.port, path: "/api/state",
      headers: { origin: "https://evil.example", "x-cc-token": s.token },
    });
    assert.equal(evilOrigin.status, 403);

    const kept = await s.api("/settings", { method: "POST", body: { phonePair: { on: false, token: "b".repeat(64) }, name: "Desk" } });
    assert.equal(kept.json.name, "Desk");
    assert.equal(kept.json.phonePair.on, true);
    assert.equal(kept.json.phonePair.token, token);
    const again = await s.api("/pairing", { method: "POST", body: { on: true } });
    assert.equal(new URL(again.json.url).searchParams.get("pair"), token, "turning it on again keeps the same code");

    const held = net.connect({ host: ip, port: s.port });
    await new Promise((resolve, reject) => { held.once("connect", resolve); held.once("error", reject); });
    const dropped = new Promise((resolve) => { held.once("close", () => resolve(true)); held.once("error", () => resolve(true)); });
    const off = await s.api("/pairing", { method: "POST", body: { on: false } });
    assert.equal(await Promise.race([dropped, new Promise((resolve) => setTimeout(() => resolve(false), 2000))]), true, "an open phone connection is dropped when pairing turns off");
    try { held.destroy(); } catch {}
    assert.equal(off.json.on, false);
    assert.equal(off.json.url, null);
    assert.equal((await s.api("/pairing/qr.svg")).status, 404);
    assert.equal(await canConnect(ip, s.port), false, "LAN closes when pairing is turned off");
    assert.equal((await s.api("/health")).status, 200);
    assert.ok((await feed()).some((e) => e.type === "log" && /Phone pairing off/.test(e.text || "")), "the feed says pairing is off");

    const rotated = await s.api("/pairing", { method: "POST", body: { on: true } });
    assert.equal(rotated.json.on, true);
    assert.notEqual(new URL(rotated.json.url).searchParams.get("pair"), token);
    assert.equal(s.log.includes(new URL(rotated.json.url).searchParams.get("pair")), false);
  } finally {
    await s.stop();
  }
});

test("no private address leaves the server on this computer", { timeout: 60000 }, async () => {
  const ip = preferredLanIPv4(readInterfaces());
  const s = await startServer({
    env: {
      CC_DEV_OWNER: "1",
      CC_PAIR_IFACES: JSON.stringify({
        eth0: [{ address: "8.8.8.8", family: "IPv4", internal: false }],
        lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      }),
    },
  });
  try {
    const on = await s.api("/pairing", { method: "POST", body: { on: true } });
    assert.equal(on.status, 200);
    assert.equal(on.json.on, false);
    assert.equal(on.json.url, null);
    assert.equal(on.json.error, NO_LAN);
    assert.equal((await s.api("/health")).status, 200);
    if (ip) assert.equal(await canConnect(ip, s.port), false);
    assert.equal(s.log.includes("?pair="), false);
  } finally {
    await s.stop();
  }
});
