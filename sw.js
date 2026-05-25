const CACHE_NAME = "dn-notes-cache-v3"; // ⚠️ Notice the version bump!
const urlsToCache = [
  "/dn-notes/",
  "/dn-notes/index.html",
  "/dn-notes/style.css",
  "/dn-notes/app.js",
  "/dn-notes/manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    }),
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    }),
  );
});

// Handle Notification Clicks
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: "window" }).then((windowClients) => {
      for (let client of windowClients) {
        if (client.url.includes("/dn-notes/") && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow("/dn-notes/");
      }
    }),
  );
});
