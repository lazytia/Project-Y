import {
  initializeApp,
  deleteApp,
  getApps,
  getApp,
} from "firebase/app";
import {
  getAuth as fbGetAuth,
  createUserWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { doc, setDoc, serverTimestamp, Timestamp } from "firebase/firestore";
import { getDb, getFirebaseApp } from "./firebase";
import { usernameToEmail, validateUsername } from "./username";

const SECONDARY_APP_NAME = "staff-admin";
const MIN_PASSWORD_LENGTH = 6;

export type CreateStaffInput = {
  username: string;
  password: string;
  startDate: Date;
};

/**
 * Create a Firebase Auth account for a new staff member and seed their
 * staff_onboarding document with the chosen start date.
 *
 * Runs the createUser call through a *secondary* named Firebase app so that
 * Firebase Auth doesn't replace the owner's current session with the new
 * staff member's session. The secondary app is cleaned up afterwards.
 */
export async function createStaffAccount(
  input: CreateStaffInput,
): Promise<{ uid: string }> {
  const usernameError = validateUsername(input.username);
  if (usernameError) throw new Error(usernameError);
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (!(input.startDate instanceof Date) || Number.isNaN(input.startDate.getTime())) {
    throw new Error("Pick a valid start date.");
  }

  const primaryOptions = getFirebaseApp().options;
  const existingSecondary = getApps().find((a) => a.name === SECONDARY_APP_NAME);
  const secondary =
    existingSecondary ?? initializeApp(primaryOptions, SECONDARY_APP_NAME);

  try {
    const secAuth = fbGetAuth(secondary);
    const cred = await createUserWithEmailAndPassword(
      secAuth,
      usernameToEmail(input.username),
      input.password,
    );
    const uid = cred.user.uid;
    // Drop the secondary session immediately — we only needed it to create the user.
    await signOut(secAuth).catch(() => {});

    const normalizedUsername = input.username.trim().toLowerCase();
    await setDoc(
      doc(getDb(), "staff_onboarding", uid),
      {
        uid,
        username: normalizedUsername,
        email: usernameToEmail(normalizedUsername),
        role: "staff",
        startDate: Timestamp.fromDate(input.startDate),
        step: 0,
        completedStep: 0,
        status: "not_started",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    return { uid };
  } finally {
    // Best-effort cleanup so subsequent calls re-init from scratch.
    try {
      await deleteApp(getApp(SECONDARY_APP_NAME));
    } catch {
      // Already deleted or never created — ignore.
    }
  }
}
