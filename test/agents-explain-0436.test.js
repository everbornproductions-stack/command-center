// 0.4.36 (Chris: "using agents is kind of confusing? what do they actually do and work on? when using them what
// happens?"): the Agents page opens with a plain explanation that can be folded and stays folded.
import test from "node:test";
import assert from "node:assert/strict";
import { bootMac } from "./mac-helpers.js";
import { findBrowser } from "./pw-helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";
const EM = String.fromCharCode(0x2014);

test("the Agents page starts with what agents do and what happens, and remembers a fold", { skip }, async () => {
  const t = await bootMac({ width: 1366, height: 800, mode: "expert" });
  try {
    await t.page.evaluate(() => { try { localStorage.removeItem("cc.agents.explained"); } catch {} window.CC.go("agents"); });
    await t.page.waitForSelector("#ag-explain", { timeout: 20000 });
    const info = await t.page.evaluate(() => {
      const d = document.getElementById("ag-explain");
      const create = document.getElementById("ag-create"); const emp = document.getElementById("emp-panel");
      return { open: d.open, first: !!create && !!(d.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING) && (!emp || !!(d.compareDocumentPosition(emp) & Node.DOCUMENT_POSITION_FOLLOWING)), text: d.textContent };
    });
    assert.equal(info.open, true, "open on the first visit");
    assert.equal(info.first, true, "above Create your own agent and Your AI employees");
    for (const w of ["What agents do", "what happens when you use one", "Nothing is sent, posted or bought without your click", "Your AI employees", "My agents", "Outside agents"]) assert.ok(info.text.includes(w), w);
    assert.ok(!info.text.includes(EM));
    await t.page.evaluate(() => { document.querySelector("#ag-explain summary").click(); });
    await t.page.waitForFunction(() => localStorage.getItem("cc.agents.explained") === "folded", null, { timeout: 5000 });
    await t.page.evaluate(() => { window.CC.go("command"); window.CC.go("agents"); });
    await t.page.waitForSelector("#ag-explain", { timeout: 20000 });
    assert.equal(await t.page.evaluate(() => document.getElementById("ag-explain").open), false, "stays folded");
  } finally { await t.close(); }
});
