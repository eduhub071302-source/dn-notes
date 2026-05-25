// 1. Import Firebase compat libraries
importScripts(
  "https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js",
);
importScripts(
  "https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js",
);

// 2. Initialize Firebase in the background
firebase.initializeApp({
  apiKey: "AIzaSyDrIpkCiUtGJMoIso8MIfo1YoFSH3FCH7A",
  authDomain: "dn-notes-73371.firebaseapp.com",
  projectId: "dn-notes-73371",
  storageBucket: "dn-notes-73371.firebasestorage.app",
  messagingSenderId: "915761462285",
  appId: "1:915761462285:web:8ffbbd34422f0da26c6944",
});

const messaging = firebase.messaging();

// 3. Handle Firebase Background Messages
messaging.onBackgroundMessage((payload) => {
  console.log("[sw.js] Received background message ", payload);
  const notificationTitle = payload.notification.title || "New Notification";
  const notificationOptions = {
    body: payload.notification.body,
    icon: "icons/icon-192.png",
    vibrate: [300, 100, 300, 100, 300],
    requireInteraction: true,
  };
  self.registration.showNotification(notificationTitle, notificationOptions);
});

// 4. Your existing Cache & App Shell Logic
const CACHE_NAME = "dn-notes-cache-v4";
const urlsToCache = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
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
