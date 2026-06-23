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
};

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
