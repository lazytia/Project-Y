/* Firebase Cloud Messaging service worker for Project Y. */
/* eslint-disable no-undef */

importScripts(
  "https://www.gstatic.com/firebasejs/11.0.2/firebase-app-compat.js",
);
importScripts(
  "https://www.gstatic.com/firebasejs/11.0.2/firebase-messaging-compat.js",
);

/**
 * Public Firebase web config. These values are also baked into every page
 * bundle (they are not secrets — Firebase web config is meant to be public),
 * so hardcoding them here is the same exposure surface. The SW needs them at
 * cold-start time, before any client postMessage can arrive, to handle push
 * events delivered while the app is closed.
 */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDyWf6cD2URszT3KVcikKY5C0TbrcohWIQ",
  authDomain: "project-y-d04dc.firebaseapp.com",
  projectId: "project-y-d04dc",
  storageBucket: "project-y-d04dc.firebasestorage.app",
  messagingSenderId: "383535825433",
  appId: "1:383535825433:web:734caccdcfe7713a30a088",
};

const APP_ORIGIN = self.location.origin;
const DEFAULT_LANDING = "/onboarding";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

if (!firebase.apps.length) {
  firebase.initializeApp(FIREBASE_CONFIG);
}
const messaging = firebase.messaging();

// FCM compat SDK already auto-displays the notification when payload has a
// top-level `notification` block, but if a data-only message arrives we
// still want to surface something.
messaging.onBackgroundMessage((payload) => {
  // If the message had a top-level notification block FCM already showed it
  // (calling showNotification here would create a duplicate). Only synthesise
  // one for data-only messages.
  if (payload.notification) return;
  const data = payload.data ?? {};
  self.registration.showNotification("Project Y", {
    body: data.body ?? "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || DEFAULT_LANDING },
    tag: data.tag || "project-y",
    renotify: true,
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl =
    (event.notification.data && event.notification.data.url) || DEFAULT_LANDING;
  const fullUrl = APP_ORIGIN + targetUrl;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (client.url.startsWith(APP_ORIGIN)) {
            client.navigate(fullUrl);
            return client.focus();
          }
        }
        return self.clients.openWindow(fullUrl);
      }),
  );
});
