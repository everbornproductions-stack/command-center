// 0.4.21 item 9: alert and weekly report email goes out from the person's OWN sender. Mocks only, nothing is sent.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { options, pickVia, setupLine, resolveFrom, sendMail, checkFrom, isEverbornFrom, RESEND_TEST_SENDER } from "../server/report-mail.js";

const mkFetch = (log, { domains = [], ok = true, status = 200 } = {}) => async (url, init = {}) => {
  log.push({ url, init });
  if (String(url).endsWith("/domains")) return { ok: true, json: async () => ({ data: domains }) };
  return { ok, status, json: async () => ({ message: ok ? "" : "domain not verified" }) };
};
const body = (log) => JSON.parse(log.find((x) => String(x.url).endsWith("/emails")).init.body);

test("a saved From is used as typed and never the Everborn domain", async () => {
  const log = [];
  const r = await sendMail({ to: "me@example.com", subject: "S", text: "T" }, { from: "Me <alerts@mine.org>" }, { avail: { resendKey: true }, getKey: () => "re_x", fetchImpl: mkFetch(log) });
  assert.equal(r.via, "resend");
  assert.equal(body(log).from, "Me <alerts@mine.org>");
  await assert.rejects(() => resolveFrom({ from: "alerts@everbornproductions.com" }), /belongs to Everborn/);
  assert.ok(isEverbornFrom("Meldmind <alerts@mail.everbornproductions.com>"));
  assert.ok(!isEverbornFrom("a@example.com"));
});

test("no From: the user's own verified domain, else Resend's test sender (never Everborn's)", async () => {
  const log = [];
  const a = await resolveFrom({ key: "re_x", fetchImpl: mkFetch(log, { domains: [{ name: "pending.com", status: "pending" }, { name: "everbornproductions.com", status: "verified" }, { name: "mine.org", status: "verified" }] }) });
  assert.deepEqual([a.from, a.source], ["Meldmind <alerts@mine.org>", "domain"]);
  const b = await resolveFrom({ key: "re_x", fetchImpl: mkFetch([], { domains: [] }) });
  assert.deepEqual([b.from, b.source], [RESEND_TEST_SENDER, "test"]);
  assert.ok(!/everborn/i.test(RESEND_TEST_SENDER));
  const c = await resolveFrom({ key: "re_x", fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal(c.source, "test");
});

test("a refusal from Resend says what to check, with no key in the message", async () => {
  const log = [];
  await assert.rejects(
    () => sendMail({ to: "me@example.com", subject: "S", text: "T" }, { from: "a@notmine.org" }, { avail: { resendKey: true }, getKey: () => "re_SECRET", fetchImpl: mkFetch(log, { ok: false, status: 403 }) }),
    (e) => /verified in your Resend account/.test(e.message) && !e.message.includes("re_SECRET"),
  );
});

test("Gmail and Outlook send through the connected account, with the chosen way winning", async () => {
  const calls = [];
  const deps = { avail: { resendKey: true, gmail: true, outlook: true }, getKey: () => "re_x", fetchImpl: mkFetch([]), gmailSend: async (m) => { calls.push(["gmail", m]); return {}; }, outlookSend: async (m) => { calls.push(["outlook", m]); return {}; } };
  await sendMail({ to: "me@example.com", subject: "S", text: "T" }, { via: "gmail" }, deps);
  await sendMail({ to: "me@example.com", subject: "S", text: "T" }, { via: "outlook" }, deps);
  assert.deepEqual(calls.map((c) => c[0]), ["gmail", "outlook"]);
  assert.deepEqual(calls[0][1], { to: "me@example.com", subject: "S", body: "T" });
  assert.equal(pickVia({ via: "auto" }, { gmail: true }), "gmail");
  assert.equal(pickVia({ via: "gmail" }, { resendKey: true }), null, "a chosen way that is not set up is not silently swapped");
});

test("setup lines name what to add and nothing sends without a way", async () => {
  assert.match(setupLine({}, {}), /add a Resend key and a From address, or connect Gmail or Outlook/);
  assert.match(setupLine({ via: "gmail" }, {}), /Connect Gmail in Settings/);
  assert.match(setupLine({ via: "resend" }, {}), /Add your Resend key/);
  assert.match(setupLine({ via: "resend" }, { resendKey: true }), /From address/);
  await assert.rejects(() => sendMail({ to: "me@example.com", subject: "S", text: "T" }, {}, { avail: {}, fetchImpl: mkFetch([]) }), /Resend key/);
  await assert.rejects(() => sendMail({ to: "nope", subject: "S", text: "T" }, {}, {}), /address/);
  assert.equal(options({ gmail: true }).find((o) => o.id === "gmail").ready, true);
  assert.equal(checkFrom(""), "");
  assert.throws(() => checkFrom("not an address"), /plain email/);
  assert.throws(() => checkFrom("a@b.co\nBcc: x@y.z"), /plain email/);
});

test("wiring: alerts and the report use the shared sender; the old hard-coded Everborn From is gone", () => {
  const alerts = fs.readFileSync(new URL("../server/plugins/alerts.js", import.meta.url), "utf8");
  assert.ok(!/from:\s*"Meldmind <alerts@everbornproductions\.com>"/.test(alerts));
  assert.match(alerts, /sendOwnMail/);
  const rep = fs.readFileSync(new URL("../server/plugins/reports.js", import.meta.url), "utf8");
  assert.match(rep, /p === "\/send"/);
  const ms = fs.readFileSync(new URL("../server/microsoft.js", import.meta.url), "utf8");
  assert.match(ms, /v1\.0\/me\/sendMail/);
  const ui = fs.readFileSync(new URL("../web/features/alerts.js", import.meta.url), "utf8");
  assert.match(ui, /id="al-from"/);
});
