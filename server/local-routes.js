// Local AIs that do not speak HTTP. The router can pick one, and streamChat
// hands the turn here instead of a provider API. A route registers itself.
// Nothing in this file spawns a process or stores a secret.

const handlers = new Map();
const names = new Map();

export function registerLocalRoute(id, handler, name = "") {
  const key = String(id || "");
  if (!key || typeof handler !== "function") throw new Error("local route needs an id and a handler");
  handlers.set(key, handler);
  if (name) names.set(key, name);
}

export function isLocalRoute(id) {
  return handlers.has(String(id || ""));
}

export function localRouteName(id) {
  return names.get(String(id || "")) || "";
}

export function localStream(id, opts) {
  const fn = handlers.get(String(id || ""));
  if (!fn) throw new Error("That local AI is not available.");
  return fn(opts);
}
