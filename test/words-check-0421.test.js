// Web builders run the same words check as texts and emails (M11 M38): a promise is caught at Build and Test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureCatalog } from "../server/builders/web/catalog.js";
import { buildBuilder, testBuilder, wordsIssues } from "../server/builders/web/flow.js";

test("wordsIssues flags a promise and a leftover placeholder, and stays quiet on plain copy", () => {
  const bad = wordsIssues({ files: [{ path: "ad.txt", text: "We guarantee we will remove all your negative items. Pay up front. [NAME]" }] }, { about: "credit repair" });
  assert.ok(bad.some((i) => i.blocking && /words-croa/.test(i.id)), JSON.stringify(bad.map((i) => i.id)));
  assert.ok(bad.some((i) => i.id === "words-raw_marker"));
  assert.deepEqual(wordsIssues({ files: [{ path: "ad.txt", text: "Fresh bread every morning. Visit us on Main Street." }] }, { about: "bakery" }), []);
  assert.deepEqual(wordsIssues({ files: [{ path: "TOOLS.txt", text: "[NAME] guarantee" }] }, {}), []);
  assert.ok(wordsIssues({ files: [{ path: "index.html", text: "<style>.a{}</style><p>No kids allowed here</p>" }] }, {}).some((i) => i.blocking));
});

test("Build and Test of an ad carry the words issues", () => {
  ensureCatalog();
  const out = buildBuilder("ad-copy", { confirm: true, name: "Smith Housing", about: "Apartments for rent. No kids, adults only.", platform: "google", compliance: { noPromises: true, followLaws: true, notAdvice: true } }, { tier: "pro" });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.ok(out.draft.issues.some((i) => i.kind === "words" && i.blocking), JSON.stringify(out.draft.issues.map((i) => i.id)));
  const t = testBuilder(out.draft);
  assert.ok(t.issues.some((i) => i.kind === "words"));
});
