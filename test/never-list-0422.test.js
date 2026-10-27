// Item NEVERLIST (0.4.22): app control never drives a shell, a terminal, an SSH client, a wallet,
// a small mail or chat app, a system console or a money app, and a website door never opens on a
// host that points back at this computer. One list, one plain refusal sentence, no dashes.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpDir, ROOT } from "./helpers.js";

const DIR = tmpDir("cc-never-list-");
process.env.CC_DATA_DIR = DIR;
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));

const Discovery = await import("../server/apps.js");
const Control = await import("../server/control-apps.js");
const Agents = await import("../server/external-agents.js");

function setTier(tier) {
  store.putDoc("license", { tier, status: "active", lastOkAt: Date.now(), checkedAt: Date.now(), key: "TEST-KEY" });
}
function resetApps() {
  for (const app of Control.loadState().apps) Agents.unregisterExternalAgent(`app-${app.id}`);
  setTier("extreme");
  store.putDoc("control.apps", { apps: [], using: null, stopped: {}, plans: {} });
}
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");

after(() => {
  for (const app of Control.loadState().apps) Agents.unregisterExternalAgent(`app-${app.id}`);
});

// Every name the persona report lists (item 33, "Never-list additions"), as an app card name.
const NEVER_NAMES = [
  // shells and terminals
  "cmd", "powershell", "pwsh", "wt", "Windows Terminal", "bash", "wsl", "zsh", "Terminal", "iTerm",
  // SSH clients
  "ssh", "putty", "winscp", "mobaxterm",
  // crypto wallets
  "MetaMask", "Exodus", "Ledger Live", "Trust Wallet", "Electrum", "Coinbase Wallet",
  // small mail and chat apps
  "Outlook classic", "Thunderbird", "Signal", "WhatsApp desktop", "Telegram", "Discord", "Slack",
  // system consoles
  "regedit", "mmc", "services.msc", "taskmgr", "gpedit", "Device Manager", "Registry Editor",
  "Console", "Activity Monitor",
  // money apps
  "banking app", "PayPal", "Venmo", "Cash App", "Zelle", "Wise", "QuickBooks desktop payments",
];

function refusalOf(name) {
  const app = Control.addApp({ name, kind: "desktop", capabilities: ["analysis"] });
  try {
    Control.setAllowed(app.id, true);
    return null;
  } catch (err) {
    return err;
  }
}

test("app control refuses every name on the never-list, with the one plain sentence", () => {
  resetApps();
  for (const name of NEVER_NAMES) {
    const err = refusalOf(name);
    assert.ok(err, `${name} must be refused`);
    assert.equal(err.status, 403, `${name} is a refusal, not a crash`);
    assert.equal(err.code, "never_list", name);
    assert.equal(
      err.message,
      `Meldmind does not control ${name}. It could move money or change your computer, so it is always off.`,
      name,
    );
    assert.equal(/[\u2014\u2013-]/.test(err.message), false, `no dashes in the refusal for ${name}`);
    assert.equal(/licence/i.test(err.message), false, name);
  }
  // the same list, matched case-insensitively on the exe name and on the window title
  const exe = Control.addApp({ name: "Helper", kind: "desktop", capabilities: ["analysis"], exe: "powershell.exe" });
  assert.throws(
    () => Control.setAllowed(exe.id, true),
    (e) => e.code === "never_list" && /powershell\.exe/.test(e.message),
    "the exe name is checked too",
  );
  const ok = Control.addApp({ name: "Helper Two", kind: "desktop", capabilities: ["analysis"], exe: "Helper.exe" });
  assert.doesNotThrow(() => Control.setAllowed(ok.id, true));
  // a window title is checked as well, so the drive itself is refused with the same sentence
  const shot = Control.runJob(ok.id, { tree: { foreground: "Helper.exe", title: "Windows PowerShell" } });
  assert.equal(shot.status, "refused");
  assert.equal(
    shot.reason,
    "Meldmind does not control Windows PowerShell. It could move money or change your computer, so it is always off.",
  );
});

test("a normal program is not on the never-list and whole words keep it that way", () => {
  resetApps();
  for (const name of ["Notepad", "Calculator", "Chrome"]) {
    const app = Control.addApp({ name, kind: "desktop", capabilities: ["analysis"] });
    assert.doesNotThrow(() => Control.setAllowed(app.id, true), name);
    assert.equal(Discovery.neverListHit(name), null, name);
  }
  // "Slack" does not block an app called "Stackable", and a short name never matches inside a word
  for (const name of ["Stackable", "CmdLine", "Showtime", "TaskmgrHelper"]) {
    assert.equal(Discovery.neverListHit(name), null, name);
  }
  assert.ok(Discovery.neverListHit("Slack"));
  assert.ok(Discovery.neverListHit("SLACK"), "case does not matter");
  assert.ok(Discovery.neverListHit("wt.exe"));
});

test("there is one list: app control does not carry a second copy of it", () => {
  for (const file of ["server/control-apps.js", "server/desktop-doors.js", "server/app-catalog.js"]) {
    const src = read(file);
    assert.equal(/metamask|trust wallet|mobaxterm/i.test(src), false, `${file} must use the shared list`);
  }
  assert.match(read("server/apps.js"), /neverRefusal/);
  assert.match(read("server/control-apps.js"), /neverListHit/);
});
