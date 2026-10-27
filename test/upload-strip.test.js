// Swipeable upload strip (0.4.21, area N): the files attached to a chat message sit in one strip that
// snaps from item to item, pictures open full screen, other files show as a small card with the name.
// No server and no browser: stripHtml is pure, the rest is read from the source.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { stripHtml, isImageFile, esc } from "../web/features/upload-strip.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

const FILES = [
  { id: "f1", name: "beach.png", mime: "image/png", kind: "image" },
  { id: "f2", name: "notes.txt", mime: "text/plain" },
  { id: "f3", name: "plan.pdf", mime: "application/pdf" },
];

test("one item per file: a picture is an img, every other file is a card with its name", () => {
  const html = stripHtml(FILES);
  assert.equal((html.match(/class="us-item/g) || []).length, FILES.length, "one item per file");
  assert.equal((html.match(/<img /g) || []).length, 1, "only the picture is an img tag");
  assert.match(html, /<img class="us-img" alt="beach\.png"/);
  assert.match(html, /notes\.txt/);
  assert.match(html, /plan\.pdf/);
  const cards = html.match(/class="us-card"/g) || [];
  assert.equal(cards.length, 2, "the two non-images are file cards");
  assert.match(html, /data-us-index="0"/, "each picture knows which file it opens");
});

test("the strip uses scroll snap and labels the strip and every item", () => {
  const html = stripHtml(FILES);
  assert.match(html, /class="us-strip scroll-snap"/, "the strip carries the scroll snap class");
  assert.match(read("web", "features", "upload-strip.js"), /scroll-snap-type: x mandatory/, "the css snaps from item to item");
  assert.equal((html.match(/snap-start/g) || []).length, FILES.length, "each item snaps into place");
  assert.match(html, /aria-label="Attachments"/, "the strip is named");
  assert.match(html, /aria-label="Picture beach\.png"/);
  assert.match(html, /aria-label="File notes\.txt"/);
  assert.match(html, /aria-label="Open picture beach\.png"/, "the thumbnail says what a tap does");
});

test("no files means no strip, and names are escaped", () => {
  assert.equal(stripHtml([]), "");
  assert.equal(stripHtml(null), "");
  assert.equal(stripHtml(undefined), "");
  const html = stripHtml([{ name: "a&b.png", mime: "image/png" }]);
  assert.match(html, /a&amp;b\.png/);
  assert.ok(!html.includes("a&b.png"), "an ampersand in a name is escaped");
  assert.equal(esc("<x>"), "&lt;x&gt;");
});

test("a picture is found by kind, mime or the file name", () => {
  assert.equal(isImageFile(FILES[0]), true);
  assert.equal(isImageFile(FILES[1]), false);
  assert.equal(isImageFile({ name: "shot.webp" }), true);
  assert.equal(isImageFile({ name: "clip.mp4" }), false);
  assert.equal(isImageFile("photo.jpg"), true);
});

test("the chat box draws the strip, and the viewer closes three ways without a confirm box", () => {
  const src = read("web", "features", "upload-strip.js");
  const orders = read("web", "features", "orders-input.js");
  assert.match(orders, /from "\.\/upload-strip\.js"/, "the chat attachment row imports the strip");
  assert.match(orders, /mountStrip\(box, held/, "the files on the message are drawn as one strip");
  assert.match(orders, /orders-box\/files/, "the thumbnails come from the attached files");
  assert.match(src, /textContent = "Close"/, "a Close button closes the overlay");
  assert.match(src, /key === "Escape"/, "Esc closes the overlay");
  assert.match(src, /e\.target === root \|\| e\.target === body/, "a tap outside the file closes the overlay");
  assert.doesNotMatch(src, /window\.confirm|confirm\(/, "no confirm box");
  assert.doesNotMatch(src, /background:\s*#[0-3][0-9a-f]{2,5}/i, "no hard-coded dark background, theme colours only");
  assert.ok(!/[–—]/.test(src), "no em dash or en dash");
  assert.ok(!/[–—]/.test(read("web", "features", "orders-input.js")), "no em dash or en dash in the chat row");
});
