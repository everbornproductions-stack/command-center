import test from "node:test";
import assert from "node:assert";
import { titleOf, filterChats, groupByDay } from "../web/mac/data/history.js";
import { bootMac } from "./mac-helpers.js";

test("titleOf extracts title or falls back correctly", () => {
  assert.strictEqual(titleOf({ title: "My Chat" }), "My Chat");
  assert.strictEqual(titleOf({ title: "   " }), "Untitled chat");
  assert.strictEqual(titleOf(null), "Untitled chat");
  assert.strictEqual(titleOf({ messages: [{ text: "Hello world from assistant" }] }), "Hello world from assistant");
});

test("filterChats searches titles and messages case-insensitively", () => {
  const chats = [
    { id: "1", title: "Build a website", messages: [{ text: "Using HTML and CSS" }] },
    { id: "2", title: "Python script", messages: [{ text: "Data analysis" }] },
    { id: "3", title: "Cooking recipe", messages: [{ text: "Pasta carbonara" }] },
  ];
  const res1 = filterChats(chats, "python");
  assert.strictEqual(res1.length, 1);
  assert.strictEqual(res1[0].id, "2");

  const res2 = filterChats(chats, "html");
  assert.strictEqual(res2.length, 1);
  assert.strictEqual(res2[0].id, "1");

  const res3 = filterChats(chats, "");
  assert.strictEqual(res3.length, 3);
});

test("groupByDay categorizes chats into Today, Yesterday, This week, Earlier", () => {
  const now = new Date("2026-10-26T12:00:00Z").getTime();
  const todayTime = new Date("2026-10-26T09:00:00Z").getTime();
  const yesterdayTime = new Date("2026-10-25T15:00:00Z").getTime();
  const weekTime = new Date("2026-10-22T10:00:00Z").getTime();
  const earlierTime = new Date("2026-10-10T10:00:00Z").getTime();

  const chats = [
    { id: "c1", updatedAt: todayTime, title: "Today chat" },
    { id: "c2", updatedAt: yesterdayTime, title: "Yesterday chat" },
    { id: "c3", updatedAt: weekTime, title: "Week chat" },
    { id: "c4", updatedAt: earlierTime, title: "Earlier chat" },
  ];

  const grouped = groupByDay(chats, now);
  assert.strictEqual(grouped.length, 4);
  assert.strictEqual(grouped[0].label, "Today");
  assert.strictEqual(grouped[0].items.length, 1);
  assert.strictEqual(grouped[1].label, "Yesterday");
  assert.strictEqual(grouped[2].label, "This week");
  assert.strictEqual(grouped[3].label, "Earlier");
});

test("history drawer browser test", async () => {
  const boot = await bootMac();
  if (!boot) {
    console.log("Skipping browser test (Playwright/browser unavailable)");
    return;
  }
  const { page } = boot;
  try {
    // Open history drawer via bus
    await page.evaluate(() => {
      window.CC.mac.bus.emit("open", { panel: "history" });
    });

    // Wait for drawer to be open and visible
    await page.waitForSelector("#mac-history-drawer.open", { timeout: 10000 });

    // Verify empty state message or history header is visible
    const headerTitle = await page.$eval(".mac-hist-title", (el) => el.textContent.trim());
    assert.strictEqual(headerTitle, "History");

    // Press Escape to close
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("#mac-history-drawer.open"), null, { timeout: 5000 });

  } finally {
    await boot.close();
  }
});
