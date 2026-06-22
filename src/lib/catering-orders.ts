import type { User } from "firebase/auth";

/**
 * Catering Orders — sourced from Square Platter via /api/catering-orders.
 *
 * The server adapter (src/lib/catering-square.ts) handles the messy
 * Square shape; this file is the shared type contract + client fetchers.
 */

export type CateringOrderStatus = "CONFIRMED" | "PENDING" | "CANCELLED";

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

export async function fetchCateringOrders(user: User | null | undefined): Promise<CateringOrder[]> {
  const res = await fetch("/api/catering-orders", {
    cache: "no-store",
    headers: await authHeader(user),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`);
  return (data?.orders ?? []) as CateringOrder[];
}

export async function fetchCateringOrder(
  user: User | null | undefined,
  id: string,
): Promise<CateringOrder | null> {
  const res = await fetch(`/api/catering-orders/${encodeURIComponent(id)}`, {
    cache: "no-store",
    headers: await authHeader(user),
  });
  if (res.status === 404) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`);
  return (data?.order ?? null) as CateringOrder | null;
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
