/**
 * Which row of the Pay History sheet is this person?
 *
 * The timesheet knows people by their Square name and the sheet by whatever
 * the owner types there, which is a first name, a nickname, or both. No imports
 * and no network, so the matching can be run against the real names.
 */

/**
 * People whose Square name and sheet name are not alike enough to match by
 * themselves, written out: Square name (lower case) → the name as it stands in
 * the sheet. Used only if the sheet really has that name, so a row that has been
 * renamed or removed there is reported as unmatched instead of going missing.
 */
const SHEET_NAME_ALIASES: Record<string, string> = {
  "md sayedur rahman sayed": "Sayed",
};

const squash = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

export function matchSheetEmployee(displayName: string, sheetEmployees: string[]): string | null {
  const norm = squash(displayName);
  if (!norm) return null;

  const alias = SHEET_NAME_ALIASES[norm];
  if (alias) {
    const found = sheetEmployees.find((emp) => squash(emp) === squash(alias));
    if (found) return found;
  }

  for (const emp of sheetEmployees) {
    const el = emp.toLowerCase();
    if (el === norm) return emp;
    const paren = /\(([^)]+)\)/.exec(emp);
    if (paren && norm.includes(paren[1].trim().toLowerCase())) return emp;
    const nick = emp.split(/[\s(]/)[0]?.trim().toLowerCase();
    const first = norm.split(/\s+/)[0];
    if (nick && (nick === first || norm.startsWith(nick))) return emp;
  }
  return null;
}
