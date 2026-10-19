// Push service worker for alerts and job done (scope /features/). Shows the notification and focuses the app on click.
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Command AI", body: e.data && e.data.text() }; }
  const tag = typeof d.tag === "string" && /^cc-[\w-]{1,80}$/.test(d.tag) ? d.tag : d.level === "stop" ? "cc-stop" : "cc-alert";
  e.waitUntil(self.registration.showNotification(d.title || "Command AI", { body: d.body || "", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", tag, data: { url: "/" }, requireInteraction: d.level === "stop" }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  // only ever this app's own page, never a URL from the push message
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => { const c = cs.find((x) => "focus" in x); return c ? c.focus() : self.clients.openWindow("/"); }));
});
