/**
 * Paid time runs on a quarter-hour grid: every clock reading moves to the
 * nearest boundary. Clock in 2:08 and out 3:07, get paid 2:15 – 3:00.
 *
 * Nearest — rather than always rounding the start forward and the end back —
 * is the rule the office was already applying by hand. Of the corrections
 * made to this week's timesheet before it was automated, every one landed on
 * the nearest quarter (16:21 → 16:15, 14:40 → 14:45, 21:11 → 21:15); pushing
 * both ends inward would have contradicted four of them. It also stays even
 * over a run of shifts, where a one-directional rule quietly shaves a few
 * minutes off every single one.
 *
 * Only raw clock records are snapped. Once an owner types a time by hand that
 * time stands exactly as entered — the correction is the deliberate act, and
 * silently moving it would leave them arguing with the form.
 */

export const ROUNDING_MINUTES = 15;

/** For `<input type="time" step>`, which counts in seconds. */
export const ROUNDING_STEP_SECONDS = ROUNDING_MINUTES * 60;

const STEP_MS = ROUNDING_MINUTES * 60_000;
const OFFSET_RE = /(Z|[+-]\d{2}:?\d{2})$/;

function offsetMinutes(offset: string): number {
  if (!offset || offset === "Z") return 0;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(offset);
  if (!m) return 0;
  const mins = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -mins : mins;
}

/** Re-render an instant in the offset the source string carried, so callers
 *  that slice clock digits out of the ISO keep working. */
function isoInSourceOffset(ms: number, sourceIso: string): string {
  const offset = OFFSET_RE.exec(sourceIso)?.[1] ?? "Z";
  const shifted = new Date(ms + offsetMinutes(offset) * 60_000);
  return shifted.toISOString().slice(0, 19) + offset;
}

/**
 * Every real UTC offset is a whole number of quarter-hours (+10:00, +09:30,
 * +05:45 …), so snapping the instant and snapping the wall clock give the
 * same answer. Working in epoch milliseconds keeps this correct across the
 * DST switch, which a naive "HH:MM" edit would not survive.
 */
export function snapToQuarter(iso: string): string {
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return iso;
  const snapped = Math.round(ms / STEP_MS) * STEP_MS;
  return snapped === ms ? iso : isoInSourceOffset(snapped, iso);
}

/**
 * Snap both ends of a clock record. A shift shorter than half a quarter can
 * land both ends on the same boundary, or invert if the end rounds down past
 * a start that rounded up; collapse those to a zero-length window rather than
 * paying negative time.
 */
export function snapClockWindow(
  startIso: string,
  endIso: string | null,
): { startAt: string; endAt: string | null } {
  const startAt = snapToQuarter(startIso);
  if (!endIso) return { startAt, endAt: null };
  const endAt = snapToQuarter(endIso);
  const collapsed = new Date(endAt).getTime() <= new Date(startAt).getTime();
  return { startAt, endAt: collapsed ? startAt : endAt };
}
