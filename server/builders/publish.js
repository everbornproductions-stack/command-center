// Publish adapters. Tokens stay in the vault and are passed only as a header.
// Postiz, listmonk, and Mautic are separate services. This file does not bundle them.
// Tests pass fetchImpl and a loopback address. Nothing here logs a token.

import { isLoopback, localFetch } from "../loopback-fetch.js";

export function joinUrl(base, suffix) {
  return `${String(base || "").replace(/\/+$/, "")}${suffix}`;
}

export function endpointFor(target, url) {
  const key = String(target || "").toLowerCase();
  if (key === "netlify") return joinUrl(process.env.CC_NETLIFY_API || "https://api.netlify.com", "/api/v1/sites");
  if (key === "vercel") return joinUrl(process.env.CC_VERCEL_API || "https://api.vercel.com", "/v13/deployments");
  if (key === "highlevel") return joinUrl(process.env.CC_GHL_API_URL || "https://services.leadconnectorhq.com", "/emails/");
  if (key === "postiz" || key === "listmonk" || key === "mautic") {
    if (!url) return null;
    const path = key === "postiz" ? "/api/posts" : key === "listmonk" ? "/api/campaigns" : "/api/emails";
    return joinUrl(url, path);
  }
  return null;
}

export function redactSecrets(value, secrets) {
  let out = String(value ?? "");
  for (const secret of secrets || []) {
    const token = String(secret || "");
    if (token.length > 6) out = out.split(token).join("[token]");
  }
  return out;
}

export function assertWebAddress(value) {
  let parsed;
  try { parsed = new URL(String(value || "")); }
  catch { return { ok: false, error: "That address is not a web address.", code: "bad_url" }; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "That address is not a web address.", code: "bad_url" };
  }
  if (/[?&](token|key|access_token)=/i.test(parsed.search)) {
    return { ok: false, error: "Put the token in the token box, not in the address.", code: "token_in_url" };
  }
  return { ok: true, url: parsed.toString() };
}

export async function sendPublish({ target, token, url, body, fetchImpl, secrets }) {
  const hidden = secrets || [token];
  if (!token) {
    return { ok: true, dryRun: true, status: "dry-run", sent: false, note: "No token is saved. Nothing was sent." };
  }
  const endpoint = endpointFor(target, url);
  if (!endpoint) {
    return { ok: true, dryRun: true, status: "dry-run", sent: false, note: "Add the service address first. Nothing was sent." };
  }
  const check = assertWebAddress(endpoint);
  if (!check.ok) return { ok: false, status: 400, code: check.code, sent: false, error: check.error };
  // Test servers set CC_NET_TRACE. A publish from those runs stays on this machine.
  if (process.env.CC_NET_TRACE === "1" && !isLoopback(check.url)) {
    return { ok: false, status: 400, code: "blocked", sent: false, error: "This run does not call outside services. Nothing was sent." };
  }
  const doFetch = fetchImpl || localFetch;
  let res;
  try {
    res = await doFetch(check.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body || {}),
    });
  } catch {
    return { ok: false, status: 502, code: "service", sent: false, error: "Could not reach the service. Nothing else was sent." };
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* a non-JSON body is still a reply */ }
  if (!res.ok) {
    const msg = json?.message || json?.error || `The service answered ${res.status}`;
    return { ok: false, status: 502, code: "service", sent: false, error: redactSecrets(msg, hidden).slice(0, 180) };
  }
  const link = json?.ssl_url || json?.url || json?.deployUrl || null;
  return {
    ok: true,
    dryRun: false,
    status: "sent",
    sent: true,
    note: "Sent after your click.",
    link: typeof link === "string" ? redactSecrets(link, hidden) : null,
  };
}
