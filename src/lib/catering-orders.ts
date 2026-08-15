import type { User } from "firebase/auth";

/**
 * Catering Orders — sourced from Square Platter via /api/catering-orders.
 *
 * The server adapter (src/lib/catering-square.ts) handles the messy
 * Square shape; this file is the shared type contract + client fetchers.
 */

export type CateringOrderStatus = "CONFIRMED" | "PENDING" | "CANCELLED" | "COMPLETED";

export type CateringOrderMethod = "WEBSITE" | "PHONE" | "EMAIL" | "OTHER";
export type CateringFulfillmentType = "PICKUP" | "DELIVERY";
export type CateringPaymentStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID";

export type CateringMenuLine = {
  /** Optional group header on the detail view ("Donburi", "Ramen", ...). */
  category?: string;
  name: string;
  qty: number;
  /** Per-unit price in dollars, if known (used when computing totals). */
  unitPrice?: number;
};

/** Shape posted by the new full-page form to /api/catering-orders. */
export type CateringOrderForm = {
  clientName: string;
  companyName?: string;
  contactPhone?: string;
  contactEmail?: string;
  orderMethod: CateringOrderMethod;
  fulfillmentType: CateringFulfillmentType;
  deliveryDateISO: string;
  deliveryTime: string;
  /** Optional override of the kitchen ready-by time ("10:45 AM"). */
  readyByTime?: string;
  deliveryAddress?: string;
  items: Array<{ name: string; qty: number; unitPrice: number }>;
  dietaryNotes?: string;
  utensilsCount?: number;
  paymentStatus?: CateringPaymentStatus;
};

export type CateringOrder = {
  id: string;
  clientName: string;
  status: CateringOrderStatus;
  /** Local YYYY-MM-DD in the venue's timezone. */
  deliveryDateISO: string;
  /** Human label, e.g. "11:30 AM". */
  deliveryTime: string;
  guestsCount: number;
  /** Dollars (we round on display). */
  totalAmount: number;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  deliveryAddressLines: string[];
  notes: string[];
  menu: CateringMenuLine[];
  fulfillmentType?: CateringFulfillmentType;
  companyName?: string;
  orderMethod?: CateringOrderMethod;
  paymentStatus?: CateringPaymentStatus;
  utensilsCount?: number;
  dietaryNotes?: string;
  readyByTime?: string;
};

async function authHeader(user: User | null | undefined): Promise<HeadersInit> {
  if (!user) return {};
  const idToken = await user.getIdToken();
  return { Authorization: `Bearer ${idToken}` };
}

export async function fetchCateringOrders(
  user: User | null | undefined,
  signal?: AbortSignal,
): Promise<CateringOrder[]> {
  const res = await fetch("/api/catering-orders", {
    cache: "no-store",
    headers: await authHeader(user),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`);
  return (data?.orders ?? []) as CateringOrder[];
}

export async function fetchCateringOrder(
  user: User | null | undefined,
  id: string,
  signal?: AbortSignal,
): Promise<CateringOrder | null> {
  const res = await fetch(`/api/catering-orders/${encodeURIComponent(id)}`, {
    cache: "no-store",
    headers: await authHeader(user),
    signal,
  });
  if (res.status === 404) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`);
  return (data?.order ?? null) as CateringOrder | null;
}

/** Fetch the owner's note for an order (stored in Firestore only). */
export async function fetchOwnerNote(
  user: User | null | undefined,
  orderId: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(`/api/catering-orders/${encodeURIComponent(orderId)}/note`, {
    cache: "no-store",
    headers: await authHeader(user),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return "";
  return (data?.ownerNote ?? "") as string;
}

/** Save the owner's note (Firestore only — never touches Square). */
export async function saveOwnerNote(
  user: User | null | undefined,
  orderId: string,
  note: string,
): Promise<void> {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(await authHeader(user)),
  };
  const res = await fetch(`/api/catering-orders/${encodeURIComponent(orderId)}/note`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ ownerNote: note }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`);
}

export type CateringSchedule = { deliveryDateISO: string; deliveryTime: string };

/** Read the owner's date/time override, or null when Square's slot still stands. */
export async function fetchCateringSchedule(
  user: User | null | undefined,
  orderId: string,
  signal?: AbortSignal,
): Promise<CateringSchedule | null> {
  const res = await fetch(`/api/catering-orders/${encodeURIComponent(orderId)}/schedule`, {
    cache: "no-store",
    headers: await authHeader(user),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  return (data?.schedule ?? null) as CateringSchedule | null;
}

/**
 * Owner-only schedule override (Firestore only — Square is never mutated).
 * `deliveryTime` is sent as a 24h "HH:MM" value straight from
 * <input type="time">; the server turns it into the human label.
 */
export async function saveCateringSchedule(
  user: User | null | undefined,
  orderId: string,
  schedule: { deliveryDateISO: string; deliveryTime: string },
): Promise<CateringSchedule> {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(await authHeader(user)),
  };
  const res = await fetch(`/api/catering-orders/${encodeURIComponent(orderId)}/schedule`, {
    method: "PUT",
    headers,
    body: JSON.stringify(schedule),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`);
  return data.schedule as CateringSchedule;
}

/** Drop the override so the order falls back to Square's own date/time. */
export async function clearCateringSchedule(
  user: User | null | undefined,
  orderId: string,
): Promise<CateringSchedule | null> {
  const res = await fetch(`/api/catering-orders/${encodeURIComponent(orderId)}/schedule`, {
    method: "DELETE",
    headers: await authHeader(user),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`);
  return (data.schedule ?? null) as CateringSchedule | null;
}

/**
 * "11:30 AM" → "11:30", the value <input type="time"> expects.
 * Tolerates the narrow no-break space Intl puts before AM/PM.
 * Returns "" when the label can't be parsed (e.g. Square's "—").
 */
export function toTimeInputValue(label: string | undefined): string {
  const raw = (label ?? "").trim();
  const ampm = /^(\d{1,2}):(\d{2})\s*([AaPp])\.?[Mm]?\.?$/.exec(raw);
  if (ampm) {
    const hour = (parseInt(ampm[1], 10) % 12) + (ampm[3].toLowerCase() === "p" ? 12 : 0);
    return `${String(hour).padStart(2, "0")}:${ampm[2]}`;
  }
  const h24 = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (h24) return `${h24[1].padStart(2, "0")}:${h24[2]}`;
  return "";
}

/**
 * "14:30" → "2:30 PM". Mirrors the format `catering-square.ts` produces for
 * Square-sourced times so an edited order reads identically to an untouched one.
 */
export function toTimeLabel(value: string | undefined): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value ?? "").trim());
  if (!m) return "";
  const hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  if (hour > 23 || minute > 59) return "";
  return new Date(Date.UTC(2000, 0, 1, hour, minute)).toLocaleTimeString("en-US", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** YYYY-MM-DD in local timezone. */
export function todayISO(): string {
  return new Date().toLocaleDateString("en-CA");
}

/** Whole days from today → target date (negative if target is in the past). */
export function daysUntil(targetISO: string, fromISO: string = todayISO()): number {
  const a = new Date(`${fromISO}T00:00:00`);
  const b = new Date(`${targetISO}T00:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * Catering convention: "D-N" = N days BEFORE the delivery date.
 * D-1 means delivery is tomorrow, D-0 means today.
 */
export function dCountdownLabel(targetISO: string, fromISO: string = todayISO()): string {
  const n = daysUntil(targetISO, fromISO);
  if (n < 0) return `D+${Math.abs(n)}`;
  return `D-${n}`;
}
