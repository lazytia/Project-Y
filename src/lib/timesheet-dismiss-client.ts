import { collection, doc, getDocs, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

export type DismissableShift = {
  id: string;
  dateISO: string;
  teamMemberId: string;
};

/** Square Labor shifts hidden by the owner (not deleted in Square). */
export async function loadDismissedShiftIds(startISO: string, endISO: string): Promise<Set<string>> {
  const snap = await getDocs(
    query(
      collection(getDb(), "timesheet_dismissed"),
      where("dateISO", ">=", startISO),
      where("dateISO", "<=", endISO),
    ),
  );
  return new Set(snap.docs.map((d) => d.id));
}

export async function loadDismissedShiftIdsForDay(dateISO: string): Promise<Set<string>> {
  const snap = await getDocs(
    query(collection(getDb(), "timesheet_dismissed"), where("dateISO", "==", dateISO)),
  );
  return new Set(snap.docs.map((d) => d.id));
}

export async function dismissSquareShift(shift: DismissableShift, userId: string): Promise<void> {
  await setDoc(
    doc(getDb(), "timesheet_dismissed", shift.id),
    {
      shiftId: shift.id,
      dateISO: shift.dateISO,
      teamMemberId: shift.teamMemberId,
      dismissedAt: serverTimestamp(),
      dismissedBy: userId,
    },
    { merge: true },
  );
}
