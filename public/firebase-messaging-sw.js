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
// Initialize messaging so the FCM SDK is wired up (token handling etc.), but we
// deliberately do NOT use onBackgroundMessage for display — on iOS Safari PWAs
// that path is unreliable. We handle the raw `push` event ourselves below.
firebase.messaging();

// Explicit push handler. We send DATA-ONLY messages from the server, so iOS
// will not auto-display anything; we must call showNotification() here. This is
// the path that reliably fires inside an installed iOS PWA.
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  // FCM data-only messages arrive as { data: { ... } }; be tolerant of either
  // shape in case a notification-style payload sneaks through.
  const data = payload.data || payload.notification || payload || {};
  const title = data.title || "Project Y";
  const body = data.body || "";
  const url = data.url || DEFAULT_LANDING;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url },
      tag: data.tag || "onboarding-reminder",
      renotify: true,
    }),
  );
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
