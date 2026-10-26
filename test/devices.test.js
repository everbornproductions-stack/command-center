// Per-person licences: a key is one person, two computers, and a tester code is one email.
// The migration is a file only. These tests never open a database and never use a real key.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir, ROOT } from "./helpers.js";

process.env.CC_DATA_DIR = tmpDir("cc-devices-");
process.env.CC_MODE = "";
const { deviceLimitMessage, deviceRpcMessage } = await import("../server/license.js");

const sql = fs.readFileSync(path.join(ROOT, "supabase", "migrations", "20261021_per_person_licences.sql"), "utf8");
const between = (start, end) => sql.slice(sql.indexOf(start), sql.indexOf(end));

test("device limit message matches the sentence a new computer sees", () => {
  assert.equal(deviceLimitMessage(2), "This key is already on 2 computers. Remove one in Settings > Devices.");
  assert.equal(deviceLimitMessage(1), "This key is already on 1 computer. Remove one in Settings > Devices.");
  assert.equal(deviceRpcMessage(new Error("Could not find the function public.list_license_devices in the schema cache")), "The computer list is not available on the license server yet.");
});

test("migration: cap is 2 per person, a new computer past the cap is not stored, codes can lock to one email", () => {
  assert.match(sql, /MIGRATION FILE ONLY/);
  assert.match(sql, /alter column max_devices set default 2/);
  assert.match(sql, /set max_devices = 2 where max_devices = 3/);
  assert.match(sql, /Does not change Square, billing, or prices/);
  assert.doesNotMatch(sql, /square-webhook|SQUARE_/);
  assert.equal(sql.includes("\u2014"), false);

  const verify = between("function public.verify_license", "function public.redeem_promo");
  const rejectAt = verify.indexOf("Remove one in Settings > Devices.");
  const insertAt = verify.indexOf("insert into public.devices");
  assert.ok(rejectAt > 0 && insertAt > rejectAt, "the cap refusal returns before a new computer is stored");
  assert.match(verify, /if n >= v_cap then/);
  assert.doesNotMatch(verify, /30 days/);
  assert.match(verify, /seat_email/);
  assert.match(verify, /license_id = l\.id/);
  assert.doesNotMatch(verify, /workspace_members/);
  assert.match(verify, /v_devs >= 4/);
  assert.match(verify, /v_ips >= 4/);
  assert.match(verify, /interval '24 hours'/);
  assert.match(sql, /Extreme team seat is a separate licence/);
  assert.match(sql, /create table if not exists public\.license_reviews/);

  const redeem = between("function public.redeem_promo", "function public.list_license_devices");
  assert.match(redeem, /This code is for a different email/);
  assert.match(redeem, /nullif\(btrim\(pc\.email\), ''\)/);
  assert.match(redeem, /max_uses/);
  assert.match(redeem, /, 2\);/);

  assert.match(sql, /revoke all on function public\.create_tester_code\(text, text, text\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.create_tester_code\(text, text, text\) to service_role/);
  assert.match(sql, /max_uses, uses, email/);
  assert.match(sql, /v_role is distinct from 'service_role'/);
  assert.doesNotMatch(sql, /grant execute on function public\.create_tester_code\(text, text, text\) to anon/);
});

test("settings devices panel removes only after a click, and the tour names it", () => {
  const ui = fs.readFileSync(path.join(ROOT, "web", "features", "devices.js"), "utf8");
  const tour = fs.readFileSync(path.join(ROOT, "web", "features", "tour.js"), "utf8");
  const features = fs.readFileSync(path.join(ROOT, "web", "perf", "registry.js"), "utf8");
  assert.match(ui, /id="settings-devices"/);
  assert.match(ui, /Settings > Devices|Devices/);
  assert.match(ui, /\/license\/devices\/remove/);
  assert.match(ui, /if \(!confirm\(q\)\) return/);
  assert.match(ui, /This computer drops to Free/);
  assert.match(features, /"devices"/);
  assert.match(tour, /#settings-devices/);
  assert.match(tour, /2 computers, a PC and a laptop/);
  for (const file of [ui, tour]) assert.equal(file.includes("\u2014"), false);
});

test("server: no license server means an empty computer list", async () => {
  const s = await startServer();
  try {
    const r = await s.api("/license/devices");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.devices, []);
    assert.match(r.json.message, /No license server/);
    const rm = await s.api("/license/devices/remove", { method: "POST", body: { deviceId: "dev1" } });
    assert.equal(rm.status, 400);
  } finally { await s.stop(); }
});

test("server: the cap message stays on the key, and remove uses the stored key only", async () => {
  const msg = deviceLimitMessage(2);
  const seen = [];
  const s = await startServer({
    cloud: {
      rpc: (fn, body) => {
        seen.push({ fn, body });
        if (fn === "verify_license") {
          return { ok: false, tier: "free", status: "device_limit", email: "ada@example.com", max_devices: 2, devices: 2, message: msg };
        }
        if (fn === "list_license_devices") {
          return { rows: [
            { device_id: "dev1", name: "HOME-PC", platform: "win32", last_seen: "2026-10-21T12:00:00.000Z", this_computer: true },
            { device_id: "laptop", name: "Laptop", platform: "darwin", last_seen: "2026-10-20T12:00:00.000Z", this_computer: false },
          ] };
        }
        if (fn === "remove_license_device") return { ok: true, message: "Removed" };
        return {};
      },
    },
    seed: (dir) => fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({ key: "EVB-AAAA-BBBB-CCCC", deviceId: "dev1", tier: null, status: null })),
  });
  try {
    const act = await s.api("/license", { method: "POST", body: { key: "EVB-AAAA-BBBB-CCCC" } });
    assert.equal(act.status, 200);
    assert.equal(act.json.tier, "free");
    assert.equal(act.json.message, msg);
    assert.equal(act.json.maxDevices, 2);

    const list = await s.api("/license/devices");
    assert.equal(list.status, 200);
    assert.equal(list.json.devices.length, 2);
    assert.equal(list.json.devices.find((d) => d.deviceId === "dev1").thisComputer, true);
    const listed = seen.filter((h) => h.fn === "list_license_devices");
    assert.ok(listed.every((h) => h.body.p_key === "EVB-AAAA-BBBB-CCCC"));

    const rm = await s.api("/license/devices/remove", { method: "POST", body: { deviceId: "laptop", key: "EVB-ZZZZ-ZZZZ-ZZZZ" } });
    assert.equal(rm.status, 200);
    assert.equal(rm.json.message, "Removed");
    const removed = seen.filter((h) => h.fn === "remove_license_device");
    assert.equal(removed.length, 1);
    assert.equal(removed[0].body.p_key, "EVB-AAAA-BBBB-CCCC");
    assert.equal(removed[0].body.p_device_id, "laptop");
    assert.equal(rm.json.license.tier, "free");

    const self = await s.api("/license/devices/remove", { method: "POST", body: { deviceId: "dev1" } });
    assert.equal(self.status, 200);
    assert.match(self.json.message, /This computer was removed/);
    assert.equal(self.json.hasKey, false);
    assert.equal(self.json.license.key, null);
  } finally { await s.stop(); }
});

test("server: a locked promo code redeems only for its email", async () => {
  const s = await startServer({
    cloud: {
      rpc: (fn, body) => {
        if (fn === "redeem_promo") {
          if (body.p_email !== "ada@example.com") return { key: null, tier: null, message: "This code is for a different email" };
          return { key: "EVB-AAAA-BBBB-CCCC", tier: "pro", message: "ok" };
        }
        if (fn === "verify_license") return { ok: true, tier: "pro", status: "active", email: "ada@example.com", max_devices: 2, message: "ok" };
        return {};
      },
    },
  });
  try {
    const bad = await s.api("/license", { method: "POST", body: { code: "TEST-ABCD-EFGH", email: "other@example.com" } });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error, /different email/);
    const good = await s.api("/license", { method: "POST", body: { code: "TEST-ABCD-EFGH", email: "ada@example.com" } });
    assert.equal(good.status, 200);
    assert.equal(good.json.tier, "pro");
    assert.equal(good.json.email, "ada@example.com");
  } finally { await s.stop(); }
});

test("server: a missing device function says the list is not on the server yet", async () => {
  const s = await startServer({
    cloud: { rpc: (fn) => (fn === "list_license_devices" ? { httpStatus: 404, message: "Could not find the function" } : { ok: true, tier: "pro", status: "active", email: "ada@example.com", message: "ok" }) },
    seed: (dir) => fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({ key: "EVB-AAAA-BBBB-CCCC", deviceId: "dev1" })),
  });
  try {
    const r = await s.api("/license/devices");
    assert.equal(r.status, 200);
    assert.match(r.json.message, /not available on the license server yet/);
    assert.deepEqual(r.json.devices, []);
  } finally { await s.stop(); }
});
