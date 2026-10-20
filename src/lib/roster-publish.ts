/* ──────────────────────────────────────────────────────────────────────
 * Who a roster publish has something to tell.
 *
 * Publishing used to tell the whole team every time: the people with shifts,
 * the people with none ("you have no shifts this week"), and again everybody
 * on every re-publish, whether or not their own week had moved. Editing a
 * roster you had already published and pressing Publish again woke the whole
 * team's phones for one person's changed start time.
 *
 * Each person's week is now compared with what they were last shown, and only
 * the people it concerns are told — that is, those whose own shifts differ.
 * ──────────────────────────────────────────────────────────────────── */

/** The three fields that make a shift: which day, which service, what time they start. */
export type ShiftLike = { iso: string; meal: string; start: string };

/**
 * What a publish means for one person.
 *
 * - `new`: they now have shifts they were not shown before.
 * - `updated`: they had shifts and those have changed (added, removed or moved).
 * - `removed`: they had shifts and now have none.
 * - `none`: never shown this week and has nothing in it — nothing to tell.
 * - `unchanged`: what they were last shown is what they would be shown now.
 */
export type RosterChange = "new" | "updated" | "removed" | "none" | "unchanged";

const shiftKey = (s: ShiftLike) => `${s.iso}|${s.meal}`;

/**
 * Compare what a person was last shown with what is about to be published.
 *
 * `previous` is null when this week has never been published to them, which is
 * different from an empty list: the person who was published "no shifts" and
 * still has none is unchanged, while one the week was never published to still
 * needs a published copy written, so their screen reads "no shifts" rather than
 * "not published yet".
 */
export function classifyRosterChange(
  previous: readonly ShiftLike[] | null,
  next: readonly ShiftLike[],
): RosterChange {
  if (previous === null) return next.length > 0 ? "new" : "none";

  // One shift per person per day per service, so the day and service identify
  // a shift and only the start time can differ.
  const before = new Map(previous.map((s) => [shiftKey(s), s.start]));
  const same = previous.length === next.length && next.every((s) => before.get(shiftKey(s)) === s.start);
  if (same) return "unchanged";

  if (next.length === 0) return "removed";
  return previous.length === 0 ? "new" : "updated";
}

/** The changes that are worth telling somebody about. */
export type NotifiableChange = Exclude<RosterChange, "none" | "unchanged">;

/** True for the changes that are worth a notification. */
export function rosterChangeNotifies(change: RosterChange): change is NotifiableChange {
  return change === "new" || change === "updated" || change === "removed";
}

/**
 * The words the person is told. English, like the other notices stored on a
 * staff document: they are written once, by whoever publishes, not per reader.
 */
export function rosterNotice(
  change: NotifiableChange,
  rangeLabel: string,
  shiftCount: number,
): { title: string; detail: string } {
  const shifts = `${shiftCount} shift${shiftCount === 1 ? "" : "s"}`;
  switch (change) {
    case "new":
      return {
        title: "Roster published",
        detail: `Your roster for ${rangeLabel} is ready — ${shifts} this week.`,
      };
    case "updated":
      return {
        title: "Roster updated",
        detail: `Your roster for ${rangeLabel} has changed — ${shifts} this week.`,
      };
    case "removed":
      return {
        title: "Roster updated",
        detail: `Your shifts for ${rangeLabel} have been removed. You have no shifts this week.`,
      };
  }
}
