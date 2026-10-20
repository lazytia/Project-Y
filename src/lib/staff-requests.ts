import { doc, getDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { tsToDate } from "@/lib/staff-display";

/* ──────────────────────────────────────────────────────────────────────
 * What an employee has asked the owner for, in one list.
 *
 * Holiday and availability requests are filed onto the employee's own
 * staff_onboarding document, each in its own array, and each form reads only
 * its own array back. Nothing showed the two together, so the Requests screen
 * that both forms hang off had no record of anything that had been sent.
 * ──────────────────────────────────────────────────────────────────── */

export type RequestStatus = "pending" | "approved" | "declined";

type RequestBase = {
  id: string;
  status: RequestStatus;
  /** When it was filed. Null on records that predate the field. */
  createdAt: Date | null;
};

export type HolidayRecord = RequestBase & {
  kind: "holiday";
  startDate: Date | null;
  endDate: Date | null;
};

export type AvailabilityRecord = RequestBase & {
  kind: "availability";
  effectiveDate: Date | null;
};

export type RequestRecord = HolidayRecord | AvailabilityRecord;

type Stored = {
  id?: unknown;
  status?: unknown;
  createdAt?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  effectiveDate?: unknown;
};

/** A request with no recognisable status is still waiting, as the holiday form already treats it. */
function statusOf(raw: unknown): RequestStatus {
  return raw === "approved" || raw === "declined" ? raw : "pending";
}

function listOf(raw: unknown): Stored[] {
  return Array.isArray(raw) ? (raw.filter((r) => r && typeof r === "object") as Stored[]) : [];
}

/** The date a record is about: when the holiday starts, when the availability takes effect. */
function subjectDate(r: RequestRecord): Date | null {
  return r.kind === "holiday" ? r.startDate : r.effectiveDate;
}

/**
 * Every request on an employee's document, newest filed first.
 *
 * Nothing is dropped: a record missing its dates still says that a request was
 * made and what became of it, which is the point of a history. Records with no
 * filing time (older ones) are placed by the date they are about instead, and
 * by nothing at all, last, when that is missing too.
 */
export function parseOwnRequests(data: Record<string, unknown>): RequestRecord[] {
  const out: RequestRecord[] = [];

  listOf(data.holidayRequests).forEach((r, i) => {
    out.push({
      kind: "holiday",
      id: typeof r.id === "string" && r.id ? r.id : `holiday-${i}`,
      status: statusOf(r.status),
      createdAt: tsToDate(r.createdAt),
      startDate: tsToDate(r.startDate),
      endDate: tsToDate(r.endDate),
    });
  });

  listOf(data.availabilityRequests).forEach((r, i) => {
    out.push({
      kind: "availability",
      id: typeof r.id === "string" && r.id ? r.id : `availability-${i}`,
      status: statusOf(r.status),
      createdAt: tsToDate(r.createdAt),
      effectiveDate: tsToDate(r.effectiveDate),
    });
  });

  const sortKey = (r: RequestRecord) => (r.createdAt ?? subjectDate(r))?.getTime() ?? 0;
  return out.sort((a, b) => sortKey(b) - sortKey(a));
}

/** Read the signed-in employee's own requests. Throws on a read failure, so the caller can say so. */
export async function fetchOwnRequests(uid: string): Promise<RequestRecord[]> {
  const snap = await getDoc(doc(getDb(), "staff_onboarding", uid));
  return parseOwnRequests((snap.data() ?? {}) as Record<string, unknown>);
}
