// When the Cloudflare Worker wakes the hub container for schedules (worker/hub-clock.js).
// A fake host stands in for Durable Object storage, the alarm and the container. No Cloudflare, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as K from "../worker/hub-clock.js";

const MIN = 60000;
const NOW = Date.UTC(2026, 9, 30, 17, 7, 0);

function fakeHost({ store = {}, reply = null, fail = null } = {}) {
  const h = {
    store: { ...store }, armed: null, arms: 0, ticks: 0,
    get: async (k) => h.store[k],
    put: async (k, v) => { h.store[k] = v; },
    armedAt: async () => h.armed,
    arm: async (at) => { h.armed = Math.floor(at / 1000) * 1000; h.arms += 1; },
    disarm: async () => { h.armed = null; },
    tick: async () => {
      h.ticks += 1;
      if (fail) throw new Error(fail);
      return reply || new Response(JSON.stringify({ ok: true, runs: 0, nextDue: null }), { status: 200, headers: { "content-type": "application/json" } });
    },
  };
  return h;
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("planCron: first run and the daily refresh tick; otherwise the container stays asleep", () => {
  assert.equal(K.planCron({ now: NOW }).action, "tick");
  assert.equal(K.planCron({ lastTickAt: NOW - K.REFRESH_MS, nextDue: null, now: NOW }).action, "tick");
  assert.equal(K.planCron({ lastTickAt: NOW - 60 * MIN, nextDue: null, now: NOW }).action, "sleep");
  assert.deepEqual(K.planCron({ lastTickAt: NOW - 60 * MIN, nextDue: NOW + 40 * MIN, now: NOW }), { action: "arm", at: NOW + 40 * MIN, why: "waiting for the next schedule" });
  // an armed wake-up a few seconds late is left to the alarm; one that is clearly missed ticks
  assert.equal(K.planCron({ lastTickAt: NOW - 60 * MIN, nextDue: NOW - 30000, now: NOW }).action, "arm");
  assert.equal(K.planCron({ lastTickAt: NOW - 60 * MIN, nextDue: NOW - 5 * MIN, now: NOW }).action, "tick");
});

test("the 15-minute cron does not start the container when nothing is due", async () => {
  const h = fakeHost({ store: { lastTickAt: NOW - 60 * MIN, nextDue: NOW + 3 * 3600000 } });
  for (let i = 0; i < 8; i += 1) await K.onCron(h, NOW + i * 15 * MIN);
  assert.equal(h.ticks, 0, "two hours of cron checks, no container start");
  assert.equal(h.armed, NOW + 3 * 3600000, "a wake-up is set for the schedule");
  assert.equal(h.arms, 1, "it is set once, not re-set on every cron");
  const idle = fakeHost({ store: { lastTickAt: NOW - 60 * MIN, nextDue: null } });
  await K.onCron(idle, NOW);
  assert.equal(idle.ticks, 0);
  assert.equal(idle.armed, null);
});

test("a tick stores the next due time from the hub and arms the wake-up for it", async () => {
  const next = NOW + 53 * MIN;
  const h = fakeHost({ reply: json({ ok: true, runs: 2, nextDue: next }) });
  const out = await K.onCron(h, NOW);
  assert.equal(out.action, "tick");
  assert.deepEqual(out.result, { ok: true, runs: 2, nextDue: next });
  assert.equal(h.ticks, 1);
  assert.equal(h.store.nextDue, next);
  assert.equal(h.store.lastTickAt, NOW);
  assert.equal(h.armed, next);
  // nothing scheduled anywhere: the wake-up is cleared
  const none = fakeHost({ store: { nextDue: NOW + MIN }, reply: json({ ok: true, runs: 0, nextDue: null }) });
  none.armed = NOW + MIN;
  await K.runTick(none, NOW);
  assert.equal(none.store.nextDue, null);
  assert.equal(none.armed, null);
});

test("a failed tick retries in an hour, never on every cron", async () => {
  for (const h of [fakeHost({ reply: json({ error: "unauthorized" }, 401) }), fakeHost({ fail: "container did not start" })]) {
    const errors = [];
    const orig = console.error;
    console.error = (m) => errors.push(String(m));
    try { await K.onCron(h, NOW); } finally { console.error = orig; }
    assert.equal(h.ticks, 1);
    assert.equal(h.store.nextDue, NOW + K.RETRY_MS);
    assert.equal(h.armed, NOW + K.RETRY_MS);
    assert.match(errors.join("\n"), /next try in an hour/);
    for (let i = 1; i <= 3; i += 1) await K.onCron(h, NOW + i * 15 * MIN);
    assert.equal(h.ticks, 1, "the next three cron checks leave the container asleep");
  }
});

test("a schedule change moves the wake-up earlier, never later", async () => {
  const h = fakeHost({ store: { lastTickAt: NOW - MIN, nextDue: NOW + 120 * MIN } });
  h.armed = NOW + 120 * MIN;
  assert.equal(await K.onHint(h, String(NOW + 10 * MIN), NOW), NOW + 10 * MIN);
  assert.equal(h.armed, NOW + 10 * MIN);
  assert.equal(await K.onHint(h, String(NOW + 500 * MIN), NOW), NOW + 10 * MIN, "a later hint keeps the earlier wake-up");
  assert.equal(h.armed, NOW + 10 * MIN);
  assert.equal(await K.onHint(h, "not a time", NOW), NOW + 10 * MIN);
  assert.equal(h.ticks, 0, "a hint never starts the container by itself");
  // a stored time that is long past is replaced by the hint
  assert.equal(K.mergeHint(NOW - 60 * MIN, NOW + 5 * MIN, NOW), NOW + 5 * MIN);
  assert.equal(K.mergeHint(null, NOW + 5 * MIN, NOW), NOW + 5 * MIN);
  assert.equal(K.mergeHint(null, "", NOW), null);
});

test("the tick request uses CC_HUB_URL and the secret from the environment", () => {
  const r = K.tickRequest({ CC_HUB_URL: "https://hub.example.test/", CC_TICK_SECRET: "s3" });
  assert.equal(r.url, "https://hub.example.test/api/internal/schedules/tick");
  assert.equal(r.method, "POST");
  assert.equal(r.headers.get("x-cc-tick-secret"), "s3");
  assert.equal(K.tickRequest({}).url, "http://hub.internal/api/internal/schedules/tick");
  assert.equal(K.tickRequest({}).headers.get("x-cc-tick-secret"), "");
});
