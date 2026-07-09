/** Resolve the authoritative last-working-day ISO string from a notice row. */
export function noticeLastWorkingDay(data: {
  finalShiftDate?: string;
  lastWorkingDay?: string;
}): string {
  const final = (data.finalShiftDate ?? "").trim();
  const legacy = (data.lastWorkingDay ?? "").trim();
  return final || legacy;
}

/** Whole-day difference from today. Positive = future, negative = past. */
export function noticeDaysFromToday(lastDay: string): number | null {
  if (!lastDay) return null;
  const [y, m, d] = lastDay.split("-").map(Number);
  if (!y || !m || !d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(y, m - 1, d);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function isReadyToTerminate(lastDay: string): boolean {
  const days = noticeDaysFromToday(lastDay);
  return days !== null && days < 0;
}

/** Notice still in the pre-termination window (no date yet, or last day not passed). */
export function isNoticeGivenActive(lastDay: string): boolean {
  if (!lastDay) return true;
  const days = noticeDaysFromToday(lastDay);
  return days === null || days >= 0;
}
