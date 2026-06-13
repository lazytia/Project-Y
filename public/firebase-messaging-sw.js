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

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

// The main thread posts the public Firebase config once the SW is ready
// (NEXT_PUBLIC_* env vars are baked into the client bundle but not exposed
// to the server runtime, so a static JSON endpoint isn't reliable here).
let initResolve;
const initPromise = new Promise((resolve) => {
  initResolve = resolve;
});

function initFirebase(config) {
  try {
    if (!firebase.apps.length) firebase.initializeApp(config);
    const messaging = firebase.messaging();
    // FCM compat SDK auto-shows the notification when `notification` is present
    // in the payload, so onBackgroundMessage is a no-op fallback for data-only
    // messages.
    messaging.onBackgroundMessage((payload) => {
      const notification = payload.notification ?? {};
      const data = payload.data ?? {};
      const title = notification.title ?? "Project Y";
      self.registration.showNotification(title, {
        body: notification.body ?? "",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: { url: data.url || DEFAULT_LANDING },
        tag: data.tag || "project-y",
        renotify: true,
      });
    });
    initResolve(messaging);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[firebase-sw] init failed", err);
  }
}

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "FIREBASE_CONFIG" && event.data.config) {
    initFirebase(event.data.config);
  }
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
