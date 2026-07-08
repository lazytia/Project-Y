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
  type AuthError,
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
  /** When true, if the requested username is already taken we auto-append
   *  a numeric suffix ("chaeeun" → "chaeeun2", "chaeeun3", …) until we
   *  find a free slot. Two staff members with the same first name can
   *  then be onboarded with distinct login IDs (Firebase Auth still
   *  requires unique emails, so identical usernames are impossible). */
  allowUsernameSuffix?: boolean;
};

/**
 * Create a Firebase Auth account for a new staff member and seed their
 * staff_onboarding document with the chosen start date.
 *
 * Runs the createUser call through a *secondary* named Firebase app so that
 * Firebase Auth doesn't replace the owner's current session with the new
 * staff member's session. The secondary app is cleaned up afterwards.
 *
 * Returns both the new uid and the username that was actually used — the
 * two can differ when `allowUsernameSuffix` kicked in on a collision.
 */
export async function createStaffAccount(
  input: CreateStaffInput,
): Promise<{ uid: string; username: string }> {
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
    const baseUsername = input.username.trim().toLowerCase();
    // Try the base name first; on `email-already-in-use` retry with
    // "{base}2", "{base}3", … up to {base}99. Everything else surfaces
    // as a friendly error.
    let cred = null as Awaited<ReturnType<typeof createUserWithEmailAndPassword>> | null;
    let resolvedUsername = baseUsername;
    for (let attempt = 0; attempt < 100; attempt++) {
      const candidate = attempt === 0 ? baseUsername : `${baseUsername}${attempt + 1}`;
      try {
        cred = await createUserWithEmailAndPassword(
          secAuth,
          usernameToEmail(candidate),
          input.password,
        );
        resolvedUsername = candidate;
        break;
      } catch (err) {
        const code = (err as AuthError)?.code ?? "";
        if (code === "auth/email-already-in-use" && input.allowUsernameSuffix) {
          continue;
        }
        const friendly =
          code === "auth/email-already-in-use"
            ? `Staff ID "${input.username}" is already taken. Pick a different one.`
            : code === "auth/weak-password"
              ? "Password must be at least 6 characters."
              : code === "auth/invalid-email"
                ? "That Staff ID isn't valid. Use 3–30 lowercase letters / numbers / . _ -"
                : code === "auth/operation-not-allowed"
                  ? "Email/password sign-in is disabled in Firebase Auth. Enable it in the console."
                  : code === "auth/too-many-requests"
                    ? "Too many attempts. Wait a minute and try again."
                    : null;
        if (friendly) throw new Error(friendly);
        throw err;
      }
    }
    if (!cred) {
      throw new Error(
        `Could not find a free login ID starting with "${baseUsername}". Try a different base.`,
      );
    }
    const uid = cred.user.uid;
    // Drop the secondary session immediately — we only needed it to create the user.
    await signOut(secAuth).catch(() => {});

    await setDoc(
      doc(getDb(), "staff_onboarding", uid),
      {
        uid,
        username: resolvedUsername,
        email: usernameToEmail(resolvedUsername),
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

    return { uid, username: resolvedUsername };
  } finally {
    // Best-effort cleanup so subsequent calls re-init from scratch.
    try {
      await deleteApp(getApp(SECONDARY_APP_NAME));
    } catch {
      // Already deleted or never created — ignore.
    }
  }
}
