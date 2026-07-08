import { getStorage as fbGetStorage, type FirebaseStorage } from "firebase/storage";
import { getFirebaseApp } from "./firebase";

// Kept in its own module (rather than exported from ./firebase) so that
// pages which never touch uploads — the dashboard, login, staff home,
// reservations, etc. — don't pull the firebase/storage chunk into their
// initial JS. AuthProvider loads @/lib/firebase on every route, so anything
// re-exported from there ends up in the shared bundle.

let _storage: FirebaseStorage | null = null;

export function getStorage(): FirebaseStorage {
  if (!_storage) _storage = fbGetStorage(getFirebaseApp());
  return _storage;
}
