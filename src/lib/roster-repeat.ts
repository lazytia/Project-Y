/* ──────────────────────────────────────────────────────────────────────
 * The roster's start times, and repeating one week's roster onto the next.
 *
 * Both are plain functions of data rather than parts of the roster screen, so
 * they can be checked against what is actually stored.
 * ──────────────────────────────────────────────────────────────────── */

export type Meal = "lunch" | "dinner";

/** staffUid → "HH:MM" start time. */
export type ShiftAssignments = Record<string, string>;

/** assignments[ISO date]["lunch" | "dinner"][uid] = "HH:MM" start time. */
export type WeekAssignments = Record<string, Record<Meal, ShiftAssignments>>;

export const LUNCH_STARTS = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00"];
export const DINNER_STARTS = ["16:00", "16:30", "17:00", "17:30", "18:00", "18:30", "19:00"];

/** Index of Saturday in a roster week, which runs Monday to Saturday. */
export const SATURDAY_IDX = 5;
/** Saturday also has afternoon starts, between the two services, on top of the usual ones. */
export const SATURDAY_AFTERNOON_STARTS = ["14:00", "14:30", "15:00", "15:30"];

/**
 * The start times offered for a service on a given day (0 = Monday), earliest first.
 *
 * Offered under both services on a Saturday: the afternoon starts sit between
 * lunch and dinner and could belong to either, and which one a person is
 * rostered under is the roster's call, not something to guess here.
 */
export function startTimesFor(meal: Meal, dayIdx: number): string[] {
  const usual = meal === "lunch" ? LUNCH_STARTS : DINNER_STARTS;
  return dayIdx === SATURDAY_IDX ? [...usual, ...SATURDAY_AFTERNOON_STARTS].sort() : usual;
}

export type RepeatPlan = {
  /** The roster for the target week, by ISO date. Every target day is present, empty or not. */
  assignments: WeekAssignments;
  /** Head count per service for each target day, matching `assignments`. */
  counts: Record<string, { lunch: number; dinner: number }>;
  /** How many shifts came across. */
  copied: number;
  /** Shifts that were left off because the person is away that day. */
  away: { uid: string; dayIndex: number }[];
};

/**
 * Work out last week's roster as it would stand on this week.
 *
 * Each day of last week lands on the same weekday of this one (the two date
 * lists are matched by position), with the same people at the same start times.
 * Two kinds of entry do not come across:
 *
 * - somebody who is no longer on the team, who would be a name nobody can see
 *   or edit; and
 * - somebody who is away on the day it would put them on, reported in `away` so
 *   the gap is explained rather than silent.
 *
 * A temporary-staff slot (`tr_…`) is a placeholder and carries over as it is.
 * The plan always covers the whole target week, so applying it replaces the week
 * and a day that was empty last week leaves the same day empty this week.
 */
export function planRepeatLastWeek(input: {
  lastWeek: WeekAssignments | undefined;
  lastDates: readonly string[];
  thisDates: readonly string[];
  isOnTeam: (uid: string) => boolean;
  isAway: (uid: string, dayIndex: number) => boolean;
}): RepeatPlan {
  const { lastWeek, lastDates, thisDates, isOnTeam, isAway } = input;
  const assignments: WeekAssignments = {};
  const counts: RepeatPlan["counts"] = {};
  const away: RepeatPlan["away"] = [];
  let copied = 0;

  thisDates.forEach((iso, dayIndex) => {
    const rostered: Record<Meal, ShiftAssignments> = { lunch: {}, dinner: {} };
    for (const meal of ["lunch", "dinner"] as Meal[]) {
      const from = lastWeek?.[lastDates[dayIndex]]?.[meal] ?? {};
      for (const [uid, start] of Object.entries(from)) {
        if (!uid.startsWith("tr_")) {
          if (!isOnTeam(uid)) continue;
          if (isAway(uid, dayIndex)) {
            away.push({ uid, dayIndex });
            continue;
          }
        }
        rostered[meal][uid] = start;
        copied += 1;
      }
    }
    assignments[iso] = rostered;
    counts[iso] = {
      lunch: Object.keys(rostered.lunch).length,
      dinner: Object.keys(rostered.dinner).length,
    };
  });

  return { assignments, counts, copied, away };
}
