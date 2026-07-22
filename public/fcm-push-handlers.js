/* FCM push handlers — loaded by /sw.js via importScripts. */
/* eslint-disable no-undef */

importScripts(
  "https://www.gstatic.com/firebasejs/11.0.2/firebase-app-compat.js",
);
importScripts(
  "https://www.gstatic.com/firebasejs/11.0.2/firebase-messaging-compat.js",
);

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

if (!firebase.apps.length) {
  firebase.initializeApp(FIREBASE_CONFIG);
}
firebase.messaging();

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
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
