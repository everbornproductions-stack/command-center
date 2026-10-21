// Phone pairing. Off by default: the desktop engine stays on 127.0.0.1.
// On: a second listener binds the PC's private IPv4, and the phone must present
// the pairing token (?pair= or the cc-pair cookie) before it can load the app.
// The token is never written to the log by this module.
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

export const FIREWALL_RULE = "Meldmind phone pairing";
export const NO_LAN = "This PC has no private network address. Join Wi-Fi, then turn phone pairing on again.";
export const BAD_LINK = "This pairing link is not valid. On the PC, open Settings, Phone and other devices, and scan the new code.";
export const PHONE_FETCH = "This phone cannot reach the PC. Use the same Wi-Fi, turn on phone pairing in Settings, and allow Meldmind on private networks in Windows Firewall.";
export const BIND_FAIL = "Phone pairing could not open the network port. It is still limited to this computer.";

export function unreachableError(ip, port) {
  return `The phone cannot reach this PC at http://${ip}:${port}/. Use the same Wi-Fi, and allow Meldmind on private networks in Windows Firewall.`;
}

export function firewallError(detail) {
  const why = String(detail || "netsh failed").replace(/\s+/g, " ").slice(0, 180);
  return `Windows did not add the private-network firewall rule (${why}). Allow Meldmind on private networks, then turn phone pairing on again.`;
}

export function isPrivateIPv4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || ""));
  if (!m) return false;
  const n = m.slice(1).map(Number);
  if (n.some((x) => x > 255)) return false;
  if (n[0] === 10) return true;
  if (n[0] === 192 && n[1] === 168) return true;
  if (n[0] === 172 && n[1] >= 16 && n[1] <= 31) return true;
  return false;
}

export function privateIPv4s(interfaces) {
  const out = [];
  for (const list of Object.values(interfaces || {})) {
    for (const i of list || []) {
      const v4 = i.family === "IPv4" || i.family === 4;
      if (!v4 || i.internal) continue;
      if (isPrivateIPv4(i.address) && !out.includes(i.address)) out.push(i.address);
    }
  }
  return out;
}

// Virtual adapters (Hyper-V, Docker, WSL, VPN tunnels) often own a 192.168 address
// the phone cannot route to. Skip those names when choosing the QR address.
const VIRTUAL_NAME = /veth|docker|br-|virbr|vmnet|vbox|virtualbox|vethernet|hyper-v|wsl|tailscale|zerotier|\btun|\btap|utun|awdl|llw|npcap|bluetooth|isatap|teredo|loopback|bridge\d|virtual|vmware/i;

export function lanCandidates(interfaces) {
  const out = [];
  const seen = new Set();
  for (const [name, list] of Object.entries(interfaces || {})) {
    if (VIRTUAL_NAME.test(String(name || ""))) continue;
    for (const i of list || []) {
      const v4 = i.family === "IPv4" || i.family === 4;
      if (!v4 || i.internal || !isPrivateIPv4(i.address) || seen.has(i.address)) continue;
      seen.add(i.address);
      out.push({ name: String(name || ""), address: i.address });
    }
  }
  const nameRank = (name) => (/wi-?fi|wlan|wireless/i.test(name) ? 0 : /^(eth|en|ethernet)/i.test(name) ? 1 : 2);
  const ipRank = (ip) => (ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : 2);
  out.sort((a, b) => nameRank(a.name) - nameRank(b.name) || ipRank(a.address) - ipRank(b.address) || a.address.localeCompare(b.address, "en"));
  return out;
}

// One address for the QR. Prefer a Wi-Fi name, then a normal Ethernet name,
// and within that a home 192.168 range, then 10.x, then 172.16-31.
export function preferredLanIPv4(interfaces) {
  return lanCandidates(interfaces)[0]?.address || null;
}

export function readInterfaces() {
  if (process.env.CC_PACKAGED !== "1" && process.env.CC_PAIR_IFACES) {
    try { return JSON.parse(process.env.CC_PAIR_IFACES); } catch { return {}; }
  }
  return os.networkInterfaces();
}

export function pairUrl(ip, port, token) {
  return `http://${ip}:${port}/?pair=${token}`;
}

// The QR uses a short path. Some phone cameras drop a query string.
export function pairPathUrl(ip, port, token) {
  return `http://${ip}:${port}/p/${token}`;
}

export function tokenFromPairPath(pathname) {
  const m = /^\/p\/([a-f0-9]{64})$/.exec(String(pathname || ""));
  return m ? m[1] : "";
}

export function pairTokenOk(presented, expected) {
  const a = Buffer.from(String(presented || ""));
  const b = Buffer.from(String(expected || ""));
  if (!b.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function newPairToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function cookieValue(header, name) {
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return ""; }
    }
  }
  return "";
}

export function pairCookie(token) {
  return `cc-pair=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`;
}

export function loopbackHost(host, port) {
  const h = String(host || "").toLowerCase();
  return h === `127.0.0.1:${port}` || h === `localhost:${port}` || h === `[::1]:${port}`;
}

export function lanHostOk(host, port, interfaces) {
  const h = String(host || "").toLowerCase();
  const ip = h.split(":")[0];
  return privateIPv4s(interfaces).includes(ip) && h === `${ip}:${port}`;
}

export function lanOriginOk(origin, port, interfaces) {
  try {
    const u = new URL(String(origin || ""));
    return u.protocol === "http:" && String(u.port) === String(port) && privateIPv4s(interfaces).includes(u.hostname);
  } catch { return false; }
}

export function isLanSocket(remoteAddress) {
  const ip = String(remoteAddress || "").replace(/^::ffff:/, "");
  return ip !== "" && ip !== "127.0.0.1" && ip !== "::1";
}

// Inbound allow for the installed exe, Private profile only. Not Public, not Domain.
export function firewallAddArgs(program) {
  const exe = String(program || "");
  if (!/^[A-Za-z]:\\[^"\r\n]+$/.test(exe)) return null;
  return ["advfirewall", "firewall", "add", "rule", `name=${FIREWALL_RULE}`, "dir=in", "action=allow", `program="${exe}"`, "profile=private", "enable=yes"];
}

export function firewallDeleteArgs() {
  return ["advfirewall", "firewall", "delete", "rule", `name=${FIREWALL_RULE}`];
}

function run(cmd, args) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let child;
    try { child = spawn(cmd, args, { windowsHide: true }); }
    catch (e) { resolve({ code: 1, stdout: "", stderr: e.message }); return; }
    child.stdout?.on("data", (d) => { stdout += d; });
    child.stderr?.on("data", (d) => { stderr += d; });
    child.on("error", (e) => resolve({ code: 1, stdout, stderr: stderr || e.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

// Packaged Windows only. Tests and macOS/Linux skip this. A failure is a message, not a throw.
export async function ensureWindowsFirewall(program = process.execPath) {
  if (process.platform !== "win32") return { ok: true, skipped: true };
  if (process.env.CC_PACKAGED !== "1") return { ok: true, skipped: true };
  const add = firewallAddArgs(program);
  if (!add) return { ok: false, skipped: false, error: firewallError("the app path is not a normal Windows path") };
  await run("netsh", firewallDeleteArgs());
  const res = await run("netsh", add);
  if (res.code !== 0) return { ok: false, skipped: false, error: firewallError(res.stderr || res.stdout) };
  return { ok: true, skipped: false };
}

export function probePort(ip, port, net) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (done) return; done = true; try { socket.destroy(); } catch {} resolve(ok); };
    const socket = net.connect({ host: ip, port });
    socket.setTimeout(1500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}
