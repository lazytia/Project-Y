import { getMessaging, getToken } from "firebase/messaging";
import { arrayUnion, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { getDb, getFirebaseApp } from "./firebase";

const SW_PATH = "/firebase-messaging-sw.js";

/**
 * Request notification permission, register the FCM service worker, get a
 * messaging token, and store it on the current user's staff_onboarding doc.
 *
 * Safe to call repeatedly — getToken returns the same token until it rotates.
 * No-ops when the browser doesn't support service workers / push, or when
 * the user denies permission.
 */
export async function registerFcmToken(uid: string): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (!("serviceWorker" in navigator) || !("Notification" in window)) return null;
  if (!("PushManager" in window)) return null;

  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY?.trim();
  if (!vapidKey) {
    // eslint-disable-next-line no-console
    console.warn("[fcm] NEXT_PUBLIC_FIREBASE_VAPID_KEY not set; skipping");
    return null;
  }

  // Ask for permission if not already decided.
  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }
  if (permission !== "granted") return null;

  // Register (or reuse) the SW that handles background push.
  const swReg = await navigator.serviceWorker.register(SW_PATH);
  await navigator.serviceWorker.ready;

  const messaging = getMessaging(getFirebaseApp());
  const token = await getToken(messaging, {
    vapidKey,
    serviceWorkerRegistration: swReg,
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn("[fcm] getToken failed", err);
    return null;
  });

  if (!token) return null;

  await setDoc(
    doc(getDb(), "staff_onboarding", uid),
    {
      uid,
      fcmTokens: arrayUnion(token),
      fcmTokenUpdatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  return token;
}
