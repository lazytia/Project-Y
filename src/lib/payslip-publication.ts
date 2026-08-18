import { adminDb } from "@/lib/firebase-admin";

/**
 * Payslip publication — the owner's release switch for one pay week.
 *
 * A pay week's numbers exist in the payroll sheet as soon as hours are
 * pushed, but they are not final until the owner has checked them. Staff
 * must not see a week before that, so the staff payslip feed shows only
 * the weeks with a published record here. No record means not published:
 * the absence of the switch is the closed state, so a week can never leak
 * by being forgotten.
 *
 * Doc id is the pay week's Monday (weekStartISO), matching the key the
 * payroll sheet parser and `rosters_published` already use.
 */
export const PAYSLIP_PUBLICATIONS_COLLECTION = "payslip_publications";

/**
 * How many pay weeks to read when listing publications. The staff payslip
 * page only offers the last 12 months, so a year of weeks plus headroom is
 * everything that can be displayed.
 */
export const PUBLICATION_WEEKS_LIMIT = 60;

export type PayslipPublication = {
  weekStartISO: string;
  weekEndISO: string;
  published: boolean;
  /** ISO timestamp of the most recent publish. Null while unpublished. */
  publishedAt: string | null;
  publishedByUid: string | null;
  publishedByEmail: string | null;
  /** Employees in the sheet block at publish time — shown as a receipt. */
  employeeCount: number | null;
};

function toPublication(id: string, d: Record<string, unknown>): PayslipPublication {
  return {
    weekStartISO: typeof d.weekStartISO === "string" ? d.weekStartISO : id,
    weekEndISO: typeof d.weekEndISO === "string" ? d.weekEndISO : "",
    published: d.published === true,
    publishedAt: typeof d.publishedAt === "string" ? d.publishedAt : null,
    publishedByUid: typeof d.publishedByUid === "string" ? d.publishedByUid : null,
    publishedByEmail: typeof d.publishedByEmail === "string" ? d.publishedByEmail : null,
    employeeCount: typeof d.employeeCount === "number" ? d.employeeCount : null,
  };
}

/** Publication record for one pay week, or null when it was never published. */
export async function readPayslipPublication(
  weekStartISO: string,
): Promise<PayslipPublication | null> {
  const snap = await adminDb()
    .collection(PAYSLIP_PUBLICATIONS_COLLECTION)
    .doc(weekStartISO)
    .get();
  if (!snap.exists) return null;
  return toPublication(snap.id, (snap.data() ?? {}) as Record<string, unknown>);
}

/**
 * The set of pay weeks staff are allowed to see.
 *
 * Doc ids are weekStartISO (YYYY-MM-DD), so ordering by `__name__` desc gives
 * the newest weeks first without needing a composite index — and lets the
 * `published` flag be filtered in memory, so a week that was published and
 * then withdrawn drops out with no index maintenance.
 */
export async function fetchPublishedWeekStarts(): Promise<Set<string>> {
  const snap = await adminDb()
    .collection(PAYSLIP_PUBLICATIONS_COLLECTION)
    .orderBy("__name__", "desc")
    .limit(PUBLICATION_WEEKS_LIMIT)
    .get();
  const out = new Set<string>();
  for (const doc of snap.docs) {
    const d = (doc.data() ?? {}) as Record<string, unknown>;
    if (d.published === true) out.add(doc.id);
  }
  return out;
}

/** Write the switch for one pay week. Publishing and withdrawing both land here. */
export async function writePayslipPublication(input: {
  weekStartISO: string;
  weekEndISO: string;
  published: boolean;
  byUid: string;
  byEmail: string | null;
  employeeCount: number | null;
}): Promise<PayslipPublication> {
  const now = new Date().toISOString();
  const record: PayslipPublication = {
    weekStartISO: input.weekStartISO,
    weekEndISO: input.weekEndISO,
    published: input.published,
    // Withdrawing clears the timestamp so "published on …" can never be
    // shown next to a week staff cannot open.
    publishedAt: input.published ? now : null,
    publishedByUid: input.byUid,
    publishedByEmail: input.byEmail,
    employeeCount: input.employeeCount,
  };
  await adminDb()
    .collection(PAYSLIP_PUBLICATIONS_COLLECTION)
    .doc(input.weekStartISO)
    .set({ ...record, updatedAt: now }, { merge: true });
  return record;
}
