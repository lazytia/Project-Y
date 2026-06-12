import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth as fbGetAuth, type Auth } from "firebase/auth";
import { getFirestore as fbGetFirestore, type Firestore } from "firebase/firestore";
import { getStorage as fbGetStorage, type FirebaseStorage } from "firebase/storage";

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

function app(): FirebaseApp {
  if (_app) return _app;
  _app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  return _app;
}

export function getAuth(): Auth {
  if (!_auth) _auth = fbGetAuth(app());
  return _auth;
}

export function getDb(): Firestore {
  if (!_db) _db = fbGetFirestore(app());
  return _db;
}

export function getStorage(): FirebaseStorage {
  if (!_storage) _storage = fbGetStorage(app());
  return _storage;
}
