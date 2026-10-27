// 0.4.21 "type it, get the finished thing": the engine behind making a picture, video or voice from chat.
// Demo mode, practice providers only. No real key, no real URL.
//  - the intent rules recognise a request and keep ordinary questions as chat
//  - plan() gives a price and a generator prompt and spends nothing; practice runs are free
//  - run() returns a finished (practice) image saved to the hub with a name made from the request
//  - a change links the new image as a version of the old one
//  - a video or voice request becomes a job that finishes with a file
//  - without a practice mode or a key the answer is a plain message with one next button
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, waitBudget } from "./helpers.js";
import { makeIntent, followupIntent, priceLine, nameFromPrompt } from "../web/make-intent.js";

test("make intent: recognises a request to make something and leaves questions alone", () => {
  const yes = [
    ["a woman on a beach", "image"], ["make an image of a red fox in the snow", "image"], ["create a logo for my bakery", "image"],
    ["draw a cat on a roof", "image"], ["give me a poster of a lighthouse", "image"],
    ["a 5 second video of waves", "video"], ["make a short video of a dog running", "video"],
    ["read this out loud: Hello and welcome", "audio"], ["generate a voiceover for my ad saying welcome to our store", "audio"],
    ["make me a song about summer", "music"],
  ];
  for (const [t, k] of yes) assert.equal(makeIntent(t)?.kind, k, t);
  const no = ["a good recipe for chili", "how do I make a logo", "write an email to my boss", "make a website for my bakery", "what is a logo", "hello there", "explain a picture of a cell", "a friend with a problem on Monday"];
  for (const t of no) assert.equal(makeIntent(t), null, t);
  assert.equal(makeIntent("a 5 second video of waves").seconds, 5);
  assert.equal(makeIntent("a woman on a beach").subject, "a woman on a beach");
  assert.deepEqual(followupIntent("another one"), { type: "another" });
  assert.equal(followupIntent("make it sunset")?.type, "change");
  assert.equal(followupIntent("make the sky darker")?.type, "change");
  assert.equal(followupIntent("what is the sky"), null);
  assert.equal(followupIntent("make me a long story about a dragon and a knight who met in a bar and then left town"), null, "too long to be an edit");
});

test("make intent: price wording and names", () => {
  assert.equal(priceLine(0.042), "About 4 cents. Making it now.");
  assert.equal(priceLine(0.003), "Less than 1 cent. Making it now.");
  assert.equal(priceLine(0), "Free practice run. Making it now.");
  assert.equal(priceLine(1.5), "About $1.50. Making it now.");
  assert.equal(nameFromPrompt("a woman on a beach."), "A woman on a beach");
  assert.ok(!/[–—]/.test(priceLine(0.5)));
});

test("make: plan costs nothing, run gives a finished practice image named from the request", async () => {
  const s = await startServer();
  try {
    assert.equal((await s.api("/demo", { method: "POST", body: { on: true } })).json.demo, true);
    const pl = await s.api("/make/plan", { method: "POST", body: { kind: "image", request: "a woman on a beach" } });
    assert.equal(pl.status, 200, pl.text);
    assert.equal(pl.json.practice, true);
    assert.equal(pl.json.usd, 0);
    assert.equal(pl.json.provider, "demo-image");
    assert.match(pl.json.generatorPrompt, /woman on a beach/i);
    assert.notEqual(pl.json.generatorPrompt, "a woman on a beach", "the generator prompt is written for the maker");
    const before = (await s.api("/images")).json.items.length;
    assert.equal(before, 0, "plan made nothing");
    const r1 = await s.api("/make/run", { method: "POST", body: { kind: "image", request: "a woman on a beach", generatorPrompt: pl.json.generatorPrompt } });
    assert.equal(r1.status, 200, r1.text);
    assert.equal(r1.json.state, "done");
    assert.equal(r1.json.name, "A woman on a beach");
    const file = await s.api(r1.json.fileUrl);
    assert.equal(file.status, 200);
    // the hub lists it under a real name
    const hub = (await s.api("/mindmedia?project=all")).json;
    const items = hub.items || hub.flatItems || [];
    const mine = items.find((i) => i.id === r1.json.assetId);
    assert.ok(mine, "the new image is in MindMedia");
    assert.equal(mine.name, "A woman on a beach");
    // a change: the new image is a version of the old one
    const r2 = await s.api("/make/run", { method: "POST", body: { kind: "image", request: "a woman on a beach, make it sunset", change: "make it sunset", previousPrompt: pl.json.generatorPrompt, parentAssetId: r1.json.assetId } });
    assert.equal(r2.status, 200, r2.text);
    assert.notEqual(r2.json.id, r1.json.id);
    assert.match(r2.json.generatorPrompt, /sunset/i);
    assert.match(r2.json.generatorPrompt, /beach/i);
    const hub2 = (await s.api("/mindmedia?project=all")).json;
    const it2 = (hub2.items || hub2.flatItems || []).find((i) => i.id === r2.json.assetId);
    assert.equal(it2?.parentId, r1.json.assetId, "versions are linked");
  } finally { await s.stop(); }
});

test("make: a video and a voice become jobs that finish with a file", async () => {
  const s = await startServer({ env: { CC_MEDIA_POLL_MS: "50" } });
  try {
    assert.equal((await s.api("/demo", { method: "POST", body: { on: true } })).json.demo, true);
    for (const [kind, request] of [["video", "waves on a beach"], ["audio", "Hello and welcome"]]) {
      const r = await s.api("/make/run", { method: "POST", body: { kind, request, seconds: 5 } });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.state, "working");
      assert.equal(r.json.practice, true);
      const deadline = Date.now() + waitBudget(15000);
      let st;
      do { await new Promise((x) => setTimeout(x, 150)); st = (await s.api(`/make/job/${r.json.jobId}`)).json; } while (st.state === "working" && Date.now() < deadline);
      assert.equal(st.state, "done", JSON.stringify(st));
      assert.ok(st.fileUrl, "a file to show");
      assert.equal((await s.api(st.fileUrl)).status, 200);
    }
  } finally { await s.stop(); }
});

test("make: no maker and no practice mode gives a plain message with one next button", async () => {
  const s = await startServer();
  try {
    for (const kind of ["image", "video", "audio"]) {
      const r = await s.api("/make/plan", { method: "POST", body: { kind, request: "a woman on a beach" } });
      assert.equal(r.status, 409, r.text);
      assert.equal(r.json.code, "no_provider");
      assert.ok(r.json.next?.label, "one next button");
      assert.ok(!/[\u2013\u2014]/.test(r.json.error));
    }
    const run = await s.api("/make/run", { method: "POST", body: { kind: "image", request: "a woman on a beach" } });
    assert.equal(run.status, 409, "nothing is made and nothing is spent");
    assert.equal((await s.api("/images")).json.items.length, 0);
  } finally { await s.stop(); }
});
