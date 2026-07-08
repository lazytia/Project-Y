import { initializeApp, getApps, getApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import { initializeAuth, getAuth as fbGetAuth, browserLocalPersistence, type Auth } from "firebase/auth";
import { getFirestore as fbGetFirestore, type Firestore } from "firebase/firestore";

const explicitConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;
let _db: Firestore | null = null;

function app(): FirebaseApp {
  if (_app) return _app;
  if (getApps().length > 0) {
    _app = getApp();
    return _app;
  }
  // In Firebase App Hosting, FIREBASE_WEBAPP_CONFIG is auto-injected and read
  // by initializeApp() when called with no args. Locally, fall back to env vars.
  _app = explicitConfig.apiKey ? initializeApp(explicitConfig) : initializeApp();
  return _app;
}

/**
 * The primary Firebase app instance. Exposed so admin flows (e.g. creating
 * a new user from the owner's session) can spin up a secondary named app
 * with the same config and keep the owner signed in.
 */
export function getFirebaseApp(): FirebaseApp {
  return app();
}

export function getAuth(): Auth {
  if (!_auth) {
    try {
      // browserLocalPersistence: 로그아웃 전까지 영구 로그인 유지
      _auth = initializeAuth(app(), { persistence: browserLocalPersistence });
    } catch {
      // App Hosting 등에서 이미 초기화된 경우 기존 인스턴스 반환
      _auth = fbGetAuth(app());
    }
  }
  return _auth;
}

export function getDb(): Firestore {
  if (!_db) _db = fbGetFirestore(app(), "project-y");
  return _db;
}

// Storage is a large chunk of the Firebase SDK (~40 KB gzipped) and is only
// used by a handful of routes (document uploads, HR notes, cash payments).
// Consumers must import from "@/lib/firebase-storage" so those pages pay for
// it and the main bundle — which every route pulls via AuthProvider — does
// not. Do not re-add a `getStorage` export here.
