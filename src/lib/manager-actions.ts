/**
 * Manager-side actions on staff requests.
 *
 * holidayRequests / availabilityRequests are stored as arrays inside the
 * staff member's staff_onboarding doc. Firestore's arrayUnion can't update
 * an existing element, so we read the array, replace the matching item,
 * and write the whole array back. At the same time we append a row to the
 * staff member's `notifications` array so they see the decision on their
 * dashboard.
 */
import {
  doc,
  getDoc,
  updateDoc,
  arrayUnion,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { getDb } from "./firebase";

export type Decision = "approved" | "declined";

type RawRequest = {
  id: string;
  status: "pending" | "approved" | "declined";
  startDate?: Timestamp;
  endDate?: Timestamp;
  effectiveDate?: Timestamp;
  [key: string]: unknown;
};

function fmtRangeShort(start: Date, end: Date): string {
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  const right = end.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  if (sameMonth) {
    return `${start.getDate()} – ${right}`;
  }
  return `${start.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
  })} – ${right}`;
}

function fmtShort(d: Date): string {
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

async function decideRequest(
  staffUid: string,
  managerUid: string,
  field: "holidayRequests" | "availabilityRequests",
  requestId: string,
  decision: Decision,
): Promise<void> {
  const ref = doc(getDb(), "staff_onboarding", staffUid);
  const snap = await getDoc(ref);
  const data = snap.data() ?? {};
  const arr = (data[field] ?? []) as RawRequest[];
  // Snapshot of the staff member's current availability so the detail
  // page can show "before vs after" for availability-change decisions.
  const currentAvailability = data.availability ?? {};
  let updated: RawRequest | null = null;
  const next = arr.map((r) => {
    if (r.id !== requestId) return r;
    updated = {
      ...r,
      status: decision,
      decidedAt: Timestamp.now(),
      decidedBy: managerUid,
    };
    if (field === "availabilityRequests") {
      updated.previousAvailability = currentAvailability;
    }
    return updated;
  });
  if (!updated) {
    throw new Error("Request not found.");
  }

  // Build a notification row describing the decision.
  const notification = buildNotification(field, updated, decision);

  await updateDoc(ref, {
    [field]: next,
    notifications: arrayUnion(notification),
    updatedAt: serverTimestamp(),
  });

  // Fire-and-forget push notification to the staff's phone. We don't block
  // the manager UI on this — the in-app notifications card is the source of
  // truth, FCM is best-effort.
  try {
    void fetch("/api/staff/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uid: staffUid,
        title: notification.title,
        body: notification.detail,
        url: "/staff",
      }),
    });
  } catch {
    /* swallow — push is best-effort */
  }
}

function buildNotification(
  field: "holidayRequests" | "availabilityRequests",
  req: RawRequest,
  decision: Decision,
): {
  id: string;
  kind: string;
  title: string;
  detail: string;
  createdAt: Timestamp;
  /** Source request type — lets the detail page find the original. */
  requestType: "holiday" | "availability";
  /** Source request id within the staff doc. */
  requestId: string;
  // Holiday fields stored inline so the detail page never needs to look up
  // the original request (the array find can fail if the id drifts).
  startDate?: Timestamp | null;
  endDate?: Timestamp | null;
  // Availability fields stored inline for the same reason.
  effectiveDate?: Timestamp | null;
  requested?: Record<string, unknown> | null;
  previousAvailability?: Record<string, unknown> | null;
} {
  const id = `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  if (field === "holidayRequests") {
    const start = req.startDate?.toDate?.();
    const end = req.endDate?.toDate?.();
    const range = start && end ? fmtRangeShort(start, end) : "your dates";
    return {
      id,
      kind: decision === "approved" ? "holiday-approved" : "holiday-declined",
      title:
        decision === "approved"
          ? "Holiday request approved"
          : "Holiday request declined",
      detail:
        decision === "approved"
          ? `Your holiday request for ${range} has been approved by management.`
          : `Your holiday request for ${range} was declined. Please speak to your manager if you have questions.`,
      createdAt: Timestamp.now(),
      requestType: "holiday",
      requestId: req.id,
      startDate: req.startDate ?? null,
      endDate: req.endDate ?? null,
    };
  }
  // availability
  const eff = req.effectiveDate?.toDate?.();
  const effText = eff ? fmtShort(eff) : "the requested date";
  return {
    id,
    kind:
      decision === "approved"
        ? "availability-approved"
        : "availability-declined",
    title:
      decision === "approved"
        ? "Availability change approved"
        : "Availability change declined",
    detail:
      decision === "approved"
        ? `Your availability change effective ${effText} has been approved.`
        : `Your availability change effective ${effText} was declined. Please speak to your manager if you have questions.`,
    createdAt: Timestamp.now(),
    requestType: "availability",
    requestId: req.id,
    effectiveDate: req.effectiveDate ?? null,
    requested: (req.requested as Record<string, unknown> | undefined) ?? null,
    previousAvailability:
      (req.previousAvailability as Record<string, unknown> | undefined) ?? null,
  };
}

export type PublishShift = {
  /** ISO date (YYYY-MM-DD) of the shift. */
  iso: string;
  meal: "lunch" | "dinner";
  /** "HH:MM" 24h start time. */
  start: string;
};

/**
 * Publish one staff member's week: writes their shift list under
 * roster.{weekStartISO} on their staff_onboarding doc and appends a
 * notification so they're told their work dates. Best-effort FCM push,
 * same as decideRequest.
 */
export async function publishStaffRoster(
  staffUid: string,
  weekStartISO: string,
  weekRangeLabel: string,
  shifts: PublishShift[],
): Promise<void> {
  const ref = doc(getDb(), "staff_onboarding", staffUid);
  const id = `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const count = shifts.length;
  const notification = {
    id,
    kind: "roster-published",
    title: "Roster published",
    detail:
      count > 0
        ? `Your roster for ${weekRangeLabel} is ready — ${count} shift${count === 1 ? "" : "s"} this week.`
        : `The roster for ${weekRangeLabel} has been published. You have no shifts this week.`,
    createdAt: Timestamp.now(),
    requestType: "roster",
    weekStartISO,
    shifts,
  };

  await updateDoc(ref, {
    [`roster.${weekStartISO}`]: {
      weekStartISO,
      publishedAt: Timestamp.now(),
      shifts,
    },
    notifications: arrayUnion(notification),
    updatedAt: serverTimestamp(),
  });

  try {
    void fetch("/api/staff/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uid: staffUid,
        title: notification.title,
        body: notification.detail,
        url: "/staff/schedule/roster",
      }),
    });
  } catch {
    /* swallow — push is best-effort */
  }
}

export function decideHolidayRequest(
  staffUid: string,
  managerUid: string,
  requestId: string,
  decision: Decision,
) {
  return decideRequest(staffUid, managerUid, "holidayRequests", requestId, decision);
}

export function decideAvailabilityRequest(
  staffUid: string,
  managerUid: string,
  requestId: string,
  decision: Decision,
) {
  return decideRequest(staffUid, managerUid, "availabilityRequests", requestId, decision);
}
