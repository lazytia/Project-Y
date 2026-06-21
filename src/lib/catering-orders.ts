import { collection, doc, getDoc, getDocs, orderBy, query } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

/**
 * Catering Orders — Firestore-backed event jobs surfaced on
 * /operations/catering-orders.
 *
 * Collection: catering_orders (named DB "project-y")
 * Document ID: free-form (e.g. "one-rail-2026-07-15").
 */

export type CateringOrderStatus = "CONFIRMED" | "PENDING" | "CANCELLED";

export type CateringMenuLine = {
  /** Optional group header on the detail view ("Donburi", "Ramen", ...). */
  category?: string;
  name: string;
  qty: number;
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
};

export async function fetchCateringOrders(): Promise<CateringOrder[]> {
  const snap = await getDocs(
    query(collection(getDb(), "catering_orders"), orderBy("deliveryDateISO", "asc")),
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CateringOrder, "id">) }));
}

export async function fetchCateringOrder(id: string): Promise<CateringOrder | null> {
  const snap = await getDoc(doc(getDb(), "catering_orders", id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<CateringOrder, "id">) };
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
