// One public username for the account. Chat, shared prompts, builders, and AI News all read it.
// The licence email stays on the server. This module never returns it.

import { doc, putDoc } from "./store.js";
import { licenseState } from "./license.js";
import * as Chat from "./community-chat.js";
import * as Cloud from "./community-cloud.js";

const PROFILE = "account.profile";
const NAMES = "account.names";
const LEGACY = "community.profile";

export function licenceEmail() {
  try { return Chat.cleanEmail(licenseState().email); }
  catch { return ""; }
}

function rawLicenceKey() {
  const row = doc("license", () => undefined);
  return typeof row?.key === "string" ? row.key : "";
}

function namesDoc() {
  const raw = doc(NAMES, () => ({ names: {} })) || { names: {} };
  const names = {};
  for (const [rawKey, rawWho] of Object.entries(raw.names || {})) {
    const key = String(rawKey).trim().toLowerCase();
    const who = String(rawWho || "").trim().toLowerCase();
    if (key && who) names[key] = who;
  }
  return names;
}

function mirror(profile) {
  putDoc(LEGACY, {
    email: profile.email && profile.email !== "local" ? profile.email : "",
    username: profile.username,
    displayName: profile.username,
    joinedAt: profile.joinedAt || Date.now(),
    usernameChangedAt: profile.usernameChangedAt || 0,
  });
}

function bindLicence(profile) {
  const lic = licenceEmail();
  if (!lic || !profile.username) return profile;
  if (profile.email === lic) return profile;
  if (profile.email && profile.email !== "local") return profile;
  const names = namesDoc();
  names[profile.username.toLowerCase()] = lic;
  putDoc(NAMES, { names });
  const next = { ...profile, email: lic };
  putDoc(PROFILE, next);
  mirror(next);
  return next;
}

export function readProfile() {
  let saved = doc(PROFILE, () => ({}));
  if (!saved?.username && !saved?.displayName) {
    const legacy = doc(LEGACY, () => undefined);
    if (legacy?.username || legacy?.displayName) {
      saved = {
        email: Chat.cleanEmail(legacy.email),
        username: String(legacy.username || legacy.displayName || "").trim(),
        usernameChangedAt: Number(legacy.usernameChangedAt) || 0,
        joinedAt: Number(legacy.joinedAt) || 0,
      };
      putDoc(PROFILE, saved);
    }
  }
  const profile = {
    email: Chat.cleanEmail(saved?.email) || (saved?.email === "local" ? "local" : ""),
    username: String(saved?.username || saved?.displayName || "").trim(),
    usernameChangedAt: Number(saved?.usernameChangedAt) || 0,
    joinedAt: Number(saved?.joinedAt) || 0,
  };
  if (saved?.email === "local") profile.email = "local";
  return bindLicence(profile);
}

export function nameMap(extra = {}) {
  const names = namesDoc();
  for (const [rawKey, rawWho] of Object.entries(extra || {})) {
    const key = String(rawKey).trim().toLowerCase();
    const who = Chat.cleanEmail(rawWho);
    if (key && who && !names[key]) names[key] = who;
  }
  const profile = readProfile();
  if (profile.username) names[profile.username.toLowerCase()] = profile.email || "local";
  return names;
}

export function usernameOf() {
  return readProfile().username || "";
}

export function publicAccount(extra = {}) {
  const profile = readProfile();
  const changedAt = profile.usernameChangedAt || 0;
  return {
    username: profile.username || "",
    suggestion: profile.username ? "" : Chat.suggestUsername(nameMap(extra)),
    cooldownUntil: profile.username && changedAt ? changedAt + Chat.USERNAME_COOLDOWN_MS : 0,
    needsLicence: !licenceEmail(),
  };
}

export async function saveAccountUsername(rawName, { requireLicence = false, extraNames = {} } = {}) {
  const lic = licenceEmail();
  if (requireLicence && !lic) return { ok: false, status: 400, error: "Add a licence first. Community chat uses the email on your licence." };
  const profile = readProfile();
  const identity = lic || "local";
  const sameAccount = !profile.email || profile.email === identity || profile.email === "local" || (lic && profile.email === lic);
  const result = Chat.claimUsername({
    username: rawName,
    email: lic,
    names: nameMap(extraNames),
    current: sameAccount ? profile.username : "",
    changedAt: sameAccount ? profile.usernameChangedAt : 0,
    localOk: !requireLicence,
  });
  if (!result.ok) return result;
  if (result.same) return { ok: true, username: result.username, cooldownUntil: result.cooldownUntil || 0 };
  if (lic) {
    const key = rawLicenceKey();
    if (key) {
      const pushed = await Cloud.pushUsername({ p_key: key, p_username: result.username });
      const remote = pushed.body;
      if (!pushed.offline && remote && remote.ok === false && (remote.taken === true || /taken/i.test(String(remote.message || "")))) {
        return { ok: false, status: 409, error: "That username is taken. Pick another." };
      }
    }
  }
  const names = nameMap(extraNames);
  names[result.username.toLowerCase()] = lic || "local";
  putDoc(NAMES, { names });
  const changedAt = Date.now();
  const next = {
    email: lic || "local",
    username: result.username,
    usernameChangedAt: changedAt,
    joinedAt: profile.joinedAt || changedAt,
  };
  putDoc(PROFILE, next);
  mirror(next);
  return { ok: true, username: result.username, cooldownUntil: changedAt + Chat.USERNAME_COOLDOWN_MS };
}
