self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const payload = event.data
    ? event.data.json()
    : { title: "Hermes", body: "Neue Benachrichtigung", url: "/" };

  event.waitUntil(
    self.registration.showNotification(payload.title || "Hermes", {
      body: payload.body || "",
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: payload.tag || "hermes-event",
      renotify: Boolean(payload.renotify),
      requireInteraction: Boolean(payload.requireInteraction),
      vibrate: payload.vibrate || [180, 80, 180],
      actions: [
        {
          action: "open",
          title: "Öffnen"
        }
      ],
      data: {
        url: payload.url || "/"
      }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }

      return self.clients.openWindow(url);
    })
  );
});
