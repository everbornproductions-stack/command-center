// Push service worker for alerts (scope /features/). Shows the notification and focuses the app on click.
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Command AI", body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Command AI", { body: d.body || "", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", tag: d.level === "stop" ? "cc-stop" : "cc-alert", requireInteraction: d.level === "stop" }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => { const c = cs.find((x) => "focus" in x); return c ? c.focus() : self.clients.openWindow("/"); }));
});
