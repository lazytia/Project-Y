/**
 * Adapter that turns Square Platter (location SQUARE_PLATTER_LOCATION_ID)
 * orders into the CateringOrder shape consumed by /operations/catering-orders.
 *
 * Square doesn't expose a "catering" concept — Platter orders come in as
 * PICKUP / DELIVERY / DIGITAL fulfillments with sparse customer metadata.
 * We extract whatever the UI can show and degrade gracefully when fields
 * are absent (no customer attached, free-form item notes, etc.).
 */
import { squareClient, squareEnv } from "@/lib/square";
import type {
  CateringMenuLine,
  CateringOrder,
  CateringOrderStatus,
} from "@/lib/catering-orders";

type SqMoney = { amount?: number | bigint; currency?: string };
type SqAddress = {
  addressLine1?: string;
  addressLine2?: string;
  addressLine3?: string;
  locality?: string;
  administrativeDistrictLevel1?: string;
  postalCode?: string;
};
type SqRecipient = {
  displayName?: string;
  emailAddress?: string;
  phoneNumber?: string;
  address?: SqAddress;
};
type SqFulfillment = {
  type?: string;
  state?: string;
  pickupDetails?: { pickupAt?: string; note?: string; recipient?: SqRecipient };
  deliveryDetails?: { deliverAt?: string; note?: string; recipient?: SqRecipient };
  shipmentDetails?: { recipient?: SqRecipient };
};
type SqLineItem = {
  uid?: string;
  name?: string;
  variationName?: string;
  quantity?: string;
  note?: string;
  totalMoney?: SqMoney;
};
type SqOrder = {
  id?: string;
  state?: string;
  createdAt?: string;
  totalMoney?: SqMoney;
  customerId?: string;
  fulfillments?: SqFulfillment[];
  lineItems?: SqLineItem[];
};

function tz(): string {
  return squareEnv.timezone || "Australia/Sydney";
}

function isoDateInTZ(iso: string | undefined, timeZone: string): string {
  if (!iso) return new Date().toLocaleDateString("en-CA", { timeZone });
  return new Date(iso).toLocaleDateString("en-CA", { timeZone });
}

function timeInTZ(iso: string | undefined, timeZone: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function moneyToDollars(m: SqMoney | undefined): number {
  if (!m?.amount) return 0;
  const cents = typeof m.amount === "bigint" ? Number(m.amount) : m.amount;
  return Math.round(cents) / 100;
}

function mapStatus(state: string | undefined): CateringOrderStatus {
  switch ((state ?? "").toUpperCase()) {
    case "CANCELED":
    case "CANCELLED":
      return "CANCELLED";
    case "DRAFT":
    case "OPEN":
      return "PENDING";
    case "COMPLETED":
    default:
      return "CONFIRMED";
  }
}

function pickFulfillment(o: SqOrder): SqFulfillment | undefined {
  const list = o.fulfillments ?? [];
  // Prefer DELIVERY → PICKUP → first.
  return (
    list.find((f) => f.type === "DELIVERY") ??
    list.find((f) => f.type === "PICKUP") ??
    list[0]
  );
}

function fulfillmentTimeIso(f: SqFulfillment | undefined): string | undefined {
  return f?.deliveryDetails?.deliverAt ?? f?.pickupDetails?.pickupAt;
}

function recipient(f: SqFulfillment | undefined): SqRecipient | undefined {
  return (
    f?.deliveryDetails?.recipient ??
    f?.pickupDetails?.recipient ??
    f?.shipmentDetails?.recipient
  );
}

function addressLines(addr: SqAddress | undefined): string[] {
  if (!addr) return [];
  const line1 = [addr.addressLine1, addr.addressLine2, addr.addressLine3]
    .filter(Boolean)
    .join(" ");
  const line2 = [addr.locality, addr.administrativeDistrictLevel1, addr.postalCode]
    .filter(Boolean)
    .join(" ");
  return [line1, line2].filter((l) => l.length > 0);
}

function clientNameFor(o: SqOrder): string {
  const r = recipient(pickFulfillment(o));
  if (r?.displayName) return r.displayName;
  // Fall back to the first line-item name so the calendar shows
  // something meaningful even for walk-in PICKUP orders.
  const li = o.lineItems?.find((l) => l.name);
  if (li?.name) return li.name;
  return `Order #${(o.id ?? "").slice(-4).toUpperCase()}`;
}

function notesFor(o: SqOrder): string[] {
  const out: string[] = [];
  const f = pickFulfillment(o);
  const fNote = f?.deliveryDetails?.note ?? f?.pickupDetails?.note;
  if (fNote) out.push(fNote);
  // Free-form notes attached to a line item often carry the full
  // platter breakdown (especially for DIGITAL/wholesale orders).
  for (const li of o.lineItems ?? []) {
    if (li.note) out.push(li.note);
  }
  return out;
}

function menuFor(o: SqOrder): CateringMenuLine[] {
  const lines: CateringMenuLine[] = [];
  for (const li of o.lineItems ?? []) {
    if (!li.name) continue;
    const qty = li.quantity ? parseInt(li.quantity, 10) : 1;
    const name = li.variationName && li.variationName !== "Regular"
      ? `${li.name} (${li.variationName})`
      : li.name;
    lines.push({ name, qty: Number.isFinite(qty) ? qty : 1 });
  }
  return lines;
}

function guestsFor(o: SqOrder): number {
  // No real "pax" field — sum up line-item quantities as a stand-in.
  return (o.lineItems ?? []).reduce((sum, li) => {
    const q = li.quantity ? parseInt(li.quantity, 10) : 1;
    return sum + (Number.isFinite(q) ? q : 1);
  }, 0);
}

export function toCateringOrder(o: SqOrder): CateringOrder | null {
  if (!o.id) return null;
  const f = pickFulfillment(o);
  const whenIso = fulfillmentTimeIso(f) ?? o.createdAt;
  const r = recipient(f);
  const timezone = tz();
  return {
    id: o.id,
    clientName: clientNameFor(o),
    status: mapStatus(o.state),
    deliveryDateISO: isoDateInTZ(whenIso, timezone),
    deliveryTime: timeInTZ(whenIso, timezone),
    guestsCount: guestsFor(o),
    totalAmount: moneyToDollars(o.totalMoney),
    contactName: r?.displayName,
    contactPhone: r?.phoneNumber,
    contactEmail: r?.emailAddress,
    deliveryAddressLines: addressLines(r?.address),
    notes: notesFor(o),
    menu: menuFor(o),
  };
}

/**
 * Pull every Platter order in a date window (default: 60 days back, 180
 * forward) and return them in the calendar's shape.
 */
export async function listPlatterCateringOrders(opts?: {
  daysBack?: number;
  daysForward?: number;
}): Promise<CateringOrder[]> {
  const platterId = squareEnv.platterLocationId;
  if (!platterId) throw new Error("SQUARE_PLATTER_LOCATION_ID not set.");
  const daysBack = opts?.daysBack ?? 60;
  const daysForward = opts?.daysForward ?? 180;
  const startAt = new Date(Date.now() - daysBack * 86_400_000).toISOString();
  const endAt = new Date(Date.now() + daysForward * 86_400_000).toISOString();

  const collected: SqOrder[] = [];
  let cursor: string | undefined;
  do {
    const resp = await squareClient.orders.search({
      locationIds: [platterId],
      cursor,
      query: {
        filter: {
          dateTimeFilter: { createdAt: { startAt, endAt } },
          stateFilter: { states: ["OPEN", "COMPLETED", "DRAFT"] },
        },
        sort: { sortField: "CREATED_AT", sortOrder: "DESC" },
      },
      limit: 200,
    });
    for (const o of resp.orders ?? []) collected.push(o as SqOrder);
    cursor = resp.cursor ?? undefined;
  } while (cursor);

  const mapped: CateringOrder[] = [];
  for (const o of collected) {
    const co = toCateringOrder(o);
    if (co) mapped.push(co);
  }
  // Sort by delivery date ascending so the page's "next order" logic is happy.
  mapped.sort((a, b) => a.deliveryDateISO.localeCompare(b.deliveryDateISO));
  return mapped;
}

export async function getPlatterCateringOrder(
  orderId: string,
): Promise<CateringOrder | null> {
  // Square's orders.get is the cheapest single-doc fetch.
  const resp = await squareClient.orders.get({ orderId });
  const o = resp.order as SqOrder | undefined;
  return o ? toCateringOrder(o) : null;
}

type CateringOrderInput = {
  clientName: string;
  deliveryDateISO: string;
  deliveryTime: string;
  guestsCount?: number;
  totalAmount: number;
  notes?: string;
};

/**
 * Convert local YYYY-MM-DD + "11:30 AM" (or "11:30") in the venue's TZ to
 * an absolute ISO string Square will accept on pickupAt.
 */
function combineLocalDateTime(dateISO: string, timeText: string, timeZone: string): string {
  const t = timeText.trim().toUpperCase();
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/.exec(t);
  let hours = 12;
  let minutes = 0;
  if (m) {
    hours = parseInt(m[1], 10);
    minutes = parseInt(m[2], 10);
    const ampm = m[3];
    if (ampm === "PM" && hours !== 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;
  }
  // Build a Date that *would* be the local time in UTC, then shift it so
  // the same wall-clock reads in the target TZ. This avoids pulling in
  // a TZ library for a single conversion.
  const yyyy = dateISO.slice(0, 4);
  const mm = dateISO.slice(5, 7);
  const dd = dateISO.slice(8, 10);
  const naive = new Date(`${yyyy}-${mm}-${dd}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00Z`);
  // Compute the TZ offset (minutes) for that moment by reading what wall
  // clock the target TZ thinks the naive UTC moment is.
  const tzWall = new Date(naive.toLocaleString("en-US", { timeZone })).getTime();
  const offset = tzWall - naive.getTime();
  return new Date(naive.getTime() - offset).toISOString();
}

function buildOrderBody(input: CateringOrderInput) {
  const platterId = squareEnv.platterLocationId;
  if (!platterId) throw new Error("SQUARE_PLATTER_LOCATION_ID not set.");
  const timezone = tz();
  const pickupAt = combineLocalDateTime(input.deliveryDateISO, input.deliveryTime, timezone);
  const cents = Math.round((input.totalAmount ?? 0) * 100);
  return {
    locationId: platterId,
    state: "OPEN" as const,
    lineItems: [
      {
        name: input.clientName,
        quantity: "1",
        basePriceMoney: { amount: BigInt(cents), currency: "AUD" as const },
        note: input.notes || undefined,
      },
    ],
    fulfillments: [
      {
        type: "PICKUP" as const,
        state: "PROPOSED" as const,
        pickupDetails: {
          pickupAt,
          recipient: { displayName: input.clientName },
          note: input.guestsCount ? `${input.guestsCount} guests` : undefined,
        },
      },
    ],
  };
}

export async function createPlatterCateringOrder(
  input: CateringOrderInput,
): Promise<CateringOrder> {
  const resp = await squareClient.orders.create({
    idempotencyKey: `catering-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    order: buildOrderBody(input),
  });
  const o = resp.order as SqOrder | undefined;
  if (!o) throw new Error("Square did not return a created order.");
  const mapped = toCateringOrder(o);
  if (!mapped) throw new Error("Could not map newly created order.");
  return mapped;
}

export async function updatePlatterCateringOrder(
  orderId: string,
  patch: Partial<CateringOrderInput>,
): Promise<CateringOrder> {
  // Fetch the existing order to keep its version number — Square requires
  // it on every update.
  const current = await squareClient.orders.get({ orderId });
  const existing = current.order as (SqOrder & { version?: number | bigint }) | undefined;
  if (!existing) throw new Error("Order not found.");
  const existingFull = toCateringOrder(existing);
  if (!existingFull) throw new Error("Could not read existing order.");

  const merged: CateringOrderInput = {
    clientName: patch.clientName ?? existingFull.clientName,
    deliveryDateISO: patch.deliveryDateISO ?? existingFull.deliveryDateISO,
    deliveryTime: patch.deliveryTime ?? existingFull.deliveryTime,
    guestsCount: patch.guestsCount ?? existingFull.guestsCount,
    totalAmount: patch.totalAmount ?? existingFull.totalAmount,
    notes: patch.notes ?? existingFull.notes.join("\n"),
  };

  // Square's update requires you to send the fields you want to change
  // and identify what to replace via fieldsToClear. To keep this simple
  // and resilient (Square rejects partial replacements of fulfillments),
  // we cancel + recreate, which mirrors the "edit" UX exactly.
  await cancelPlatterCateringOrder(orderId);
  return createPlatterCateringOrder(merged);
}

export async function cancelPlatterCateringOrder(orderId: string): Promise<void> {
  const current = await squareClient.orders.get({ orderId });
  const existing = current.order as (SqOrder & { version?: number | bigint }) | undefined;
  if (!existing) return;
  const platterId = squareEnv.platterLocationId;
  if (!platterId) throw new Error("SQUARE_PLATTER_LOCATION_ID not set.");
  const version =
    typeof existing.version === "bigint"
      ? Number(existing.version)
      : (existing.version ?? 0);
  await squareClient.orders.update({
    orderId,
    order: { locationId: platterId, state: "CANCELED", version },
  });
}
