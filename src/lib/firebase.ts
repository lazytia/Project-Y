import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

const firebaseConfig = {
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
let _storage: FirebaseStorage | null = null;

function getFirebaseApp(): FirebaseApp {
  if (_app) return _app;
  _app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  return _app;
}

export const auth: Auth = new Proxy({} as Auth, {
  get(_t, prop) {
    if (!_auth) _auth = getAuth(getFirebaseApp());
    return Reflect.get(_auth as object, prop);
  },
});

export const db: Firestore = new Proxy({} as Firestore, {
  get(_t, prop) {
    if (!_db) _db = getFirestore(getFirebaseApp());
    return Reflect.get(_db as object, prop);
  },
});

export const storage: FirebaseStorage = new Proxy({} as FirebaseStorage, {
  get(_t, prop) {
    if (!_storage) _storage = getStorage(getFirebaseApp());
    return Reflect.get(_storage as object, prop);
  },
});
