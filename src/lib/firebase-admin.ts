import { getApps, initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

/**
 * Server-side Firebase Admin SDK singleton.
 *
 * In Firebase App Hosting / Cloud Run the workload identity is set up so
 * that `applicationDefault()` resolves automatically — no service account
 * key needs to be packaged with the app. Locally, set
 * `GOOGLE_APPLICATION_CREDENTIALS` to a service-account JSON if you need
 * to hit the admin APIs while developing.
 */
function ensureApp() {
  if (getApps().length > 0) return getApps()[0];
  // FIREBASE_SERVICE_ACCOUNT_JSON allows overriding with an explicit credential
  // (used for local dev). Otherwise fall back to ADC.
  const inlineCred = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (inlineCred) {
    return initializeApp({ credential: cert(JSON.parse(inlineCred)) });
  }
  return initializeApp({ credential: applicationDefault() });
}

export function adminMessaging() {
  return getMessaging(ensureApp());
}

/** Admin Firestore — connected to the named "project-y" database. */
export function adminDb() {
  const db = getFirestore(ensureApp(), "project-y");
  return db;
}

/** Admin Auth — used to verify Firebase ID tokens sent from clients. */
export function adminAuth() {
  return getAuth(ensureApp());
}
