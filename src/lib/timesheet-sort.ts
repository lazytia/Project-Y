type TeamMemberLike = { firstName?: string; lastName?: string };

export function timesheetStaffDisplayName(
  id: string,
  tm: TeamMemberLike | undefined,
): string {
  const first = (tm?.firstName ?? "").trim();
  const last = (tm?.lastName ?? "").trim();
  if (first || last) return `${first}${last ? " " + last : ""}`;
  return id.slice(0, 6);
}

/** Keep each staff member's shifts together; order staff A–Z, shifts by start. */
export function sortShiftsByStaffThenStart<T extends { teamMemberId: string; startAt: string }>(
  shifts: T[],
  teamMembers: Record<string, TeamMemberLike>,
): T[] {
  return [...shifts].sort((a, b) => {
    const nameA = timesheetStaffDisplayName(a.teamMemberId, teamMembers[a.teamMemberId]);
    const nameB = timesheetStaffDisplayName(b.teamMemberId, teamMembers[b.teamMemberId]);
    const byName = nameA.localeCompare(nameB, "en-AU");
    if (byName !== 0) return byName;
    return a.startAt.localeCompare(b.startAt);
  });
}
