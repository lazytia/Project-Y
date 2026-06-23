/**
 * Server-side helper that mirrors reservations from the yurica-system
 * booking platform into our own Firestore (project-y named DB) so the
 * data is available locally for analytics, history and any future
 * migration off the upstream platform. The original booking system is
 * the source of truth; this is a shadow copy that's safe to drop.
 *
 * Collection: reservations/{id}
 */
import { adminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

/** Loose shape returned by the booking API. We don't enforce required
 * fields here because the upstream payload is best-effort. */
type AnyReservation = Record<string, unknown> & { id?: string };

function clean<T extends Record<string, unknown>>(obj: T): T {
  // Firestore rejects `undefined` values; drop them.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

/** Write (merge) one reservation to our Firestore mirror. */
export async function mirrorReservation(r: AnyReservation): Promise<void> {
  if (!r?.id || typeof r.id !== "string") return;
  try {
    await adminDb()
      .collection("reservations")
      .doc(r.id)
      .set(
        clean({
          ...r,
          mirroredAt: FieldValue.serverTimestamp(),
          source: "yurica-system",
        }),
        { merge: true },
      );
  } catch (err) {
    console.error("[reservations-mirror] failed to write", r.id, err);
  }
}

export async function mirrorReservations(list: AnyReservation[]): Promise<void> {
  await Promise.allSettled(list.map(mirrorReservation));
}

/** Patch only the status field on a mirrored reservation. */
export async function mirrorReservationStatus(id: string, status: string): Promise<void> {
  try {
    await adminDb()
      .collection("reservations")
      .doc(id)
      .set(
        {
          status,
          statusMirroredAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
  } catch (err) {
    console.error("[reservations-mirror] failed to update status", id, err);
  }
}
