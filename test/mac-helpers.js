// 0.4.23 helper: boot the app with the Mac style on. Pure helper (not a test file).
import { bootPage } from "./pw-helpers.js";

export async function bootMac(opts = {}) {
  const t = await bootPage(opts);
  if (!t) return null;
  await t.page.evaluate(() => { localStorage.setItem("cc.mac", "1"); });
  await t.page.reload({ waitUntil: "domcontentloaded" });
  await t.page.addStyleTag({ content: "#cc-startup,#cc-look-offer,#demo-bar,#cc-desktop-prompt,.cc-tour-invite{display:none!important}" });
  await t.page.waitForFunction(() => window.CC && window.CC.S && window.CC.go, null, { timeout: 20000 });
  await t.page.waitForFunction(() => window.CC.mac && Object.keys(window.CC.mac.parts).length >= window.CC.mac.PARTS.length, null, { timeout: 30000 });
  return t;
}
