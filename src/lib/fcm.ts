import { getAuth } from "firebase/auth";
import { getMessaging, getToken } from "firebase/messaging";
import { arrayRemove, arrayUnion, doc, setDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { getDb, getFirebaseApp } from "./firebase";

const SW_PATH = "/sw.js";

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

  // Register (or reuse) the SW that handles background push. The SW
  // initializes Firebase on its own with the public config baked in, so we
  // don't need to forward any data here.
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
  await claimFcmToken(token);
  return token;
}

/**
 * Make this phone belong to the person signed in on it, and to nobody else.
 *
 * A token names a device, not a person, and it was only ever added: an owner who
 * signed in as each employee on her own phone left that phone registered on every
 * one of their records. Every notice meant for those employees — roster updates,
 * request decisions — then rang on her phone as well, and kept doing so after she
 * had signed out. The server takes the token off every other record. Housekeeping
 * only, so a failure here never stops the sign-in.
 */
async function claimFcmToken(token: string): Promise<void> {
  try {
    const idToken = await getAuth(getFirebaseApp()).currentUser?.getIdToken();
    if (!idToken) return;
    await fetch("/api/fcm/claim", {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
  } catch {
    /* housekeeping */
  }
}

/**
 * Take this phone off the signed-in person's record, as they sign out.
 *
 * Must run while they are still signed in, since it writes to their record. Does
 * nothing where notifications were never set up. The caller puts a time limit on
 * it: signing out is not to wait on the network for this.
 */
export async function unregisterFcmToken(uid: string): Promise<void> {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator) || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY?.trim();
  if (!vapidKey) return;

  const swReg = await navigator.serviceWorker.getRegistration(SW_PATH);
  if (!swReg) return;
  const token = await getToken(getMessaging(getFirebaseApp()), {
    vapidKey,
    serviceWorkerRegistration: swReg,
  }).catch(() => null);
  if (!token) return;
  await updateDoc(doc(getDb(), "staff_onboarding", uid), { fcmTokens: arrayRemove(token) });
}
