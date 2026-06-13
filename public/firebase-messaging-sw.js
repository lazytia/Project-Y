/* Firebase Cloud Messaging service worker for Project Y. */
/* eslint-disable no-undef */

importScripts(
  "https://www.gstatic.com/firebasejs/11.0.2/firebase-app-compat.js",
);
importScripts(
  "https://www.gstatic.com/firebasejs/11.0.2/firebase-messaging-compat.js",
);

const APP_ORIGIN = self.location.origin;
const DEFAULT_LANDING = "/onboarding";

// Resolve Firebase config from a same-origin endpoint so we don't have to
// hardcode credentials. The SW is registered on every load so this is cheap.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const initPromise = fetch("/api/firebase-config")
  .then((r) => r.json())
  .then((config) => {
    firebase.initializeApp(config);
    const messaging = firebase.messaging();

    messaging.onBackgroundMessage((payload) => {
      const notification = payload.notification ?? {};
      const data = payload.data ?? {};
      const title = notification.title ?? "Project Y";
      const options = {
        body: notification.body ?? "",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: {
          url: data.url || DEFAULT_LANDING,
        },
        tag: data.tag || "project-y",
        renotify: true,
      };
      self.registration.showNotification(title, options);
    });
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[firebase-sw] init failed", err);
  });

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl =
    (event.notification.data && event.notification.data.url) || DEFAULT_LANDING;
  const fullUrl = APP_ORIGIN + targetUrl;

  event.waitUntil(
    initPromise.then(() =>
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
    ),
  );
});
