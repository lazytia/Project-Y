import { collection, deleteField, getDocs, updateDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

type Meal = "lunch" | "dinner";

/**
 * Carry one person's roster shifts over to a new id.
 *
 * Approving a staff request creates the employee's login under a new id and
 * deletes the request's record. The chef rosters people from the day they are
 * requested, so those shifts were left under an id that now belongs to nobody:
 * the new employee started with an empty roster, and every shift of theirs
 * counted towards a head count with no name against it.
 *
 * Nothing but the person's own entries moves — the head counts, notes and
 * everyone else on the shift are left as they are — and a week with none of
 * their shifts is not written to.
 *
 * Returns how many shifts were moved.
 */
export async function moveRosterAssignments(fromUid: string, toUid: string): Promise<number> {
  if (fromUid === toUid) return 0;
  const weeks = await getDocs(collection(getDb(), "rosters_published"));
  let moved = 0;
  for (const week of weeks.docs) {
    const assignments = (week.data().assignments ?? {}) as Record<
      string,
      Partial<Record<Meal, Record<string, string>>> | undefined
    >;
    const updates: Record<string, unknown> = {};
    for (const [iso, meals] of Object.entries(assignments)) {
      for (const meal of ["lunch", "dinner"] as Meal[]) {
        const start = meals?.[meal]?.[fromUid];
        if (start === undefined) continue;
        updates[`assignments.${iso}.${meal}.${toUid}`] = start;
        updates[`assignments.${iso}.${meal}.${fromUid}`] = deleteField();
        moved += 1;
      }
    }
    if (Object.keys(updates).length > 0) await updateDoc(week.ref, updates);
  }
  return moved;
}
