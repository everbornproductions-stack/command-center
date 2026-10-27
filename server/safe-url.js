// 0.4.22 (Aikido review, SSRF group): a web page the app opens on its own (a search source an AI or a
// search engine picked) must be a public http(s) address. Private, link-local (cloud metadata) and
// names that point back at this computer (nip.io and friends) are refused. 0.4.23 (audit X4): loopback is
// refused by default too, on the desktop as well; a test or a local search engine turns it on with
// CC_PAGES_LOOPBACK=1 or { allowLoopback: true }.
// The host rules are the same ones the website doors use (isRefusedDoorHost), so there is one copy.
import { isRefusedDoorHost } from "./app-drivers.js";

const isLoopbackHost = (h) => h === "localhost" || h === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);

export function isPublicHttpUrl(raw, { allowLoopback = process.env.CC_PAGES_LOOPBACK === "1" && process.env.CC_MODE !== "hosted" } = {}) {
  let u;
  try { u = new URL(String(raw || "")); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (isLoopbackHost(host)) return !!allowLoopback;
  return !isRefusedDoorHost(host);
}
