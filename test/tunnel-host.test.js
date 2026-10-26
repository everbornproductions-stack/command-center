// The Host and Origin pin allows only the app's own tunnel host, never a substring or any other tunnel.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { startServer, raw } from "./helpers.js";
import { cleanTunnelHost, tunnelHostOk, tunnelOriginOk } from "../server/pairing.js";

const OWN = "quiet-river-1234.trycloudflare.com";
const LOOKALIKES = [
  "evil-trycloudflare.com",
  "trycloudflare.com.evil.com",
  "x.trycloudflare.com.attacker.net",
  `user:pw@${OWN}`,
  `${OWN}@evil.example`,
  `${OWN}:8080`,
  `${OWN}:443`,
  `${OWN}.`,
  "other-tunnel-5678.trycloudflare.com",
  `sub.${OWN}`,
  `x${OWN}`,
  "trycloudflare.com",
  ".trycloudflare.com",
  "",
];

test("pure helper: exact match only", () => {
  assert.equal(tunnelHostOk(OWN, OWN), true);
  assert.equal(tunnelHostOk(OWN.toUpperCase(), OWN), true);
  for (const h of LOOKALIKES) assert.equal(tunnelHostOk(h, OWN), false, h);
  assert.equal(tunnelHostOk(OWN, ""), false, "no tunnel set means none allowed");
  assert.equal(tunnelHostOk(OWN, "evil.example.com"), false, "a configured name must be a trycloudflare.com name");
  assert.equal(tunnelHostOk("trycloudflare.com", "trycloudflare.com"), false);
  assert.equal(cleanTunnelHost("evil-trycloudflare.com"), "");
  assert.equal(tunnelOriginOk(`https://${OWN}`, OWN), true);
  for (const h of LOOKALIKES) assert.equal(tunnelOriginOk(`https://${h}`, OWN), false, h);
  assert.equal(tunnelOriginOk(`http://${OWN}`, OWN), false);
  assert.equal(tunnelOriginOk(`https://${OWN}/x`, OWN), false);
});

const wsOnce = (url, headers) => new Promise((resolve) => {
  const ws = new WebSocket(url, { headers });
  const t = setTimeout(() => { try { ws.terminate(); } catch {} resolve({ code: null, opened: false }); }, 4000);
  let opened = false;
  ws.on("open", () => { opened = true; });
  ws.on("close", (code) => { clearTimeout(t); resolve({ code, opened }); });
  ws.on("error", () => {});
});

for (const withTunnel of [false, true]) {
  test(`live server ${withTunnel ? "with" : "without"} an own tunnel host: forged Host and Origin`, async () => {
    const s = await startServer({ env: withTunnel ? { CC_TUNNEL_HOST: OWN } : {} });
    try {
      for (const h of LOOKALIKES.filter(Boolean)) {
        const r = await raw({ port: s.port, path: "/", headers: { host: h } });
        assert.equal(r.status, 421, `Host ${h}`);
        assert.ok(!String(r.text || r.body || "").includes(s.token), "no token leaked");
      }
      const own = await raw({ port: s.port, path: "/", headers: { host: OWN } });
      assert.equal(own.status, withTunnel ? 200 : 421, "own host");
      const orig = await raw({ port: s.port, path: "/api/state", headers: { host: `127.0.0.1:${s.port}`, "x-cc-token": s.token, origin: "https://evil-trycloudflare.com" } });
      assert.equal(orig.status, 403);
      const orig2 = await raw({ port: s.port, path: "/api/state", headers: { host: `127.0.0.1:${s.port}`, "x-cc-token": s.token, origin: `https://${OWN}` } });
      assert.equal(orig2.status, withTunnel ? 200 : 403);
      const ws = await wsOnce(`ws://127.0.0.1:${s.port}/ws`, { origin: "https://x.trycloudflare.com.attacker.net" });
      assert.equal(ws.code, 4403);
      const ws2 = await wsOnce(`ws://127.0.0.1:${s.port}/ws`, { origin: `https://${OWN}` });
      assert.equal(ws2.code === 4403, !withTunnel);
    } finally { await s.stop(); }
  });
}
