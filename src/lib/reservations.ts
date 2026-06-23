/**
 * Reservations are sourced from the yurica-system Booking platform
 * (book.yurica.com.au) via its Cloud Functions admin API. We hit our own
 * proxy at /api/reservations so the calls stay server-side (no CORS,
 * and the booking origin isn't exposed in the browser).
 */
import type { User } from "firebase/auth";

export type ReservationStatus =
  | "pending"
  | "confirmed"
  | "seated"
  | "no-show"
  | "cancelled";
export type ReservationSeating = "indoor" | "outdoor" | "bar";
export type ReservationBranch = "macquariepark" | "northsydney";
export type ReservationService = "LUNCH" | "DINNER";

type FirestoreTimestamp = { _seconds?: number; seconds?: number } | string | number | null;

export type Reservation = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  company?: string;
  specialRequest?: string;
  /** YYYY-MM-DD in venue local time. */
  date: string;
  /** 24h HH:MM. */
  time: string;
  count: number;
  branch: ReservationBranch;
  seating: ReservationSeating;
  status?: ReservationStatus;
  tableNumber?: string;
  seatingRemark?: string;
  /** When the booking was first created. */
  createdAt?: FirestoreTimestamp;
  /** When the customer most recently edited their own booking. */
  customerUpdated?: boolean;
  customerUpdatedAt?: FirestoreTimestamp;
};

/** Convert Firestore-style timestamp (or epoch / ISO string) into a Date. */
export function tsToDate(ts: FirestoreTimestamp): Date | null {
  if (ts == null) return null;
  if (typeof ts === "string") {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof ts === "number") {
    return new Date(ts);
  }
  const secs = ts._seconds ?? ts.seconds;
  if (typeof secs === "number") return new Date(secs * 1000);
  return null;
}

export type ReservationCreateInput = {
  name: string;
  phone: string;
  email: string;
  company?: string;
  date: string;
  time: string;
  count: number;
  branch: ReservationBranch;
  seating: ReservationSeating;
  specialRequest?: string;
};

export function todayISO(): string {
  return new Date().toLocaleDateString("en-CA");
}

/** Lunch: 11:30 – 14:00. Dinner: 17:00 – 21:00. */
export function serviceFor(time: string): ReservationService {
  const [h, m] = time.split(":").map(Number);
  const mins = (h ?? 12) * 60 + (m ?? 0);
  return mins < 15 * 60 ? "LUNCH" : "DINNER";
}

async function authHeader(user: User | null | undefined): Promise<HeadersInit> {
  if (!user) return {};
  const idToken = await user.getIdToken();
  return { Authorization: `Bearer ${idToken}` };
}

export async function fetchReservationsForDate(
  user: User | null | undefined,
  date: string,
  branch: ReservationBranch = "northsydney",
): Promise<Reservation[]> {
  const url = `/api/reservations?date=${encodeURIComponent(date)}&branch=${encodeURIComponent(branch)}`;
  const res = await fetch(url, { cache: "no-store", headers: await authHeader(user) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`);
  return ((data?.reservations ?? []) as Reservation[]).sort((a, b) => a.time.localeCompare(b.time));
}

export async function createReservation(
  user: User | null | undefined,
  input: ReservationCreateInput,
): Promise<{ id: string }> {
  const res = await fetch("/api/reservations", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader(user)) },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`);
  return { id: data?.id };
}

export async function setReservationStatus(
  user: User | null | undefined,
  id: string,
  status: Exclude<ReservationStatus, "pending">,
): Promise<void> {
  const res = await fetch(`/api/reservations/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeader(user)) },
    body: JSON.stringify({ status }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`);
}

export async function updateReservation(
  user: User | null | undefined,
  id: string,
  patch: Partial<ReservationCreateInput>,
): Promise<void> {
  const res = await fetch(`/api/reservations/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(await authHeader(user)) },
    body: JSON.stringify(patch),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`);
}
