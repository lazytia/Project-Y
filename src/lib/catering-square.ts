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
  CateringFulfillmentType,
  CateringMenuLine,
  CateringOrder,
  CateringOrderForm,
  CateringOrderMethod,
  CateringOrderStatus,
  CateringPaymentStatus,
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
  uid?: string;
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
  basePriceMoney?: SqMoney;
  totalMoney?: SqMoney;
};
type SqOrder = {
  id?: string;
  state?: string;
  createdAt?: string;
  totalMoney?: SqMoney;
  customerId?: string;
  note?: string;
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
  // Top-level order note carries the new-order form's metadata blob
  // (Company/Method/Payment/Utensils/Dietary). Must come first so the
  // metadata parser sees it.
  if (o.note) out.push(o.note);
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
    const safeQty = Number.isFinite(qty) && qty > 0 ? qty : 1;
    const name = li.variationName && li.variationName !== "Regular"
      ? `${li.name} (${li.variationName})`
      : li.name;
    // Prefer basePriceMoney (per-unit); fall back to totalMoney/qty so the
    // detail/edit views can show the right total.
    const baseCents = moneyToDollars(li.basePriceMoney) * 100;
    const totalCents = moneyToDollars(li.totalMoney) * 100;
    const unitPrice = baseCents > 0
      ? baseCents / 100
      : totalCents > 0
        ? totalCents / 100 / safeQty
        : undefined;
    lines.push({ name, qty: safeQty, unitPrice });
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

function parseMetadata(rawNotes: string[]): {
  notes: string[];
  companyName?: string;
  orderMethod?: CateringOrderMethod;
  paymentStatus?: CateringPaymentStatus;
  utensilsCount?: number;
  dietaryNotes?: string;
  readyByTime?: string;
} {
  // The new-order form stores form-only fields as "Key: value" lines in the
  // Square order's note. Pull them back out and keep any other free text
  // as plain notes.
  const blob = rawNotes.join("\n");
  const out: ReturnType<typeof parseMetadata> = { notes: [] };
  const m = (re: RegExp) => blob.match(re)?.[1]?.trim();
  out.companyName = m(/Company:\s*([^\n]+)/i);
  const method = m(/Method:\s*([A-Z_]+)/i);
  if (method) out.orderMethod = method as CateringOrderMethod;
  const payment = m(/Payment:\s*([A-Z_]+)/i);
  if (payment) out.paymentStatus = payment as CateringPaymentStatus;
  const utensils = m(/Utensils:\s*(\d+)/i);
  if (utensils) out.utensilsCount = parseInt(utensils, 10);
  out.readyByTime = m(/ReadyBy:\s*([^\n]+)/i);
  out.dietaryNotes = m(/Dietary:\s*([\s\S]+?)(?:\n[A-Z][a-z]+:|$)/);
  const leftover = blob
    .split(/\r?\n/)
    .filter((line) => !/^(Company|Phone|Email|Method|Payment|Utensils|ReadyBy|Dietary):/i.test(line))
    .map((l) => l.trim())
    .filter(Boolean);
  out.notes = leftover;
  return out;
}

export function toCateringOrder(o: SqOrder): CateringOrder | null {
  if (!o.id) return null;
  const f = pickFulfillment(o);
  const whenIso = fulfillmentTimeIso(f) ?? o.createdAt;
  const r = recipient(f);
  const timezone = tz();
  const ftype: CateringFulfillmentType | undefined =
    f?.type === "DELIVERY" ? "DELIVERY" : f?.type === "PICKUP" ? "PICKUP" : undefined;
  const meta = parseMetadata(notesFor(o));
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
    notes: meta.notes,
    menu: menuFor(o),
    fulfillmentType: ftype,
    companyName: meta.companyName,
    utensilsCount: meta.utensilsCount,
    dietaryNotes: meta.dietaryNotes,
    readyByTime: meta.readyByTime,
    // Square-origin orders (no form metadata blob) all come from the
    // online ordering site and are paid up-front. Default both fields
    // here; orders made via our form set them explicitly in the blob,
    // so we trust those values when present.
    orderMethod: meta.orderMethod ?? "WEBSITE",
    paymentStatus: meta.paymentStatus ?? "PAID",
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

function buildNotesBlob(form: CateringOrderForm): string {
  const lines: string[] = [];
  if (form.companyName) lines.push(`Company: ${form.companyName}`);
  if (form.contactPhone) lines.push(`Phone: ${form.contactPhone}`);
  if (form.contactEmail) lines.push(`Email: ${form.contactEmail}`);
  if (form.orderMethod) lines.push(`Method: ${form.orderMethod}`);
  if (form.paymentStatus) lines.push(`Payment: ${form.paymentStatus}`);
  if (typeof form.utensilsCount === "number") lines.push(`Utensils: ${form.utensilsCount}`);
  if (form.readyByTime) lines.push(`ReadyBy: ${form.readyByTime}`);
  if (form.dietaryNotes) lines.push(`Dietary: ${form.dietaryNotes}`);
  return lines.join("\n");
}

function buildFulfillment(form: CateringOrderForm, metaBlob: string): Record<string, unknown> {
  const timezone = tz();
  const whenIso = combineLocalDateTime(form.deliveryDateISO, form.deliveryTime, timezone);
  const recipient = {
    displayName: form.clientName,
    emailAddress: form.contactEmail || undefined,
    phoneNumber: form.contactPhone || undefined,
    address: form.deliveryAddress
      ? { addressLine1: form.deliveryAddress }
      : undefined,
  };
  // Square silently drops order.note for OPEN orders, but fulfillment.note
  // persists reliably. Stash the whole metadata blob (including dietary)
  // there so the detail page can parse it back out.
  const note = metaBlob || undefined;
  if (form.fulfillmentType === "DELIVERY") {
    return {
      type: "DELIVERY" as const,
      state: "PROPOSED" as const,
      deliveryDetails: { deliverAt: whenIso, recipient, note },
    };
  }
  return {
    type: "PICKUP" as const,
    state: "PROPOSED" as const,
    pickupDetails: { pickupAt: whenIso, recipient, note },
  };
}

function buildRichOrderBody(form: CateringOrderForm) {
  const platterId = squareEnv.platterLocationId;
  if (!platterId) throw new Error("SQUARE_PLATTER_LOCATION_ID not set.");
  const lineItems = form.items.length > 0
    ? form.items.map((it) => ({
        name: it.name,
        quantity: String(Math.max(1, Math.round(it.qty))),
        basePriceMoney: {
          amount: BigInt(Math.round(it.unitPrice * 100)),
          currency: "AUD" as const,
        },
      }))
    : [{
        // Fallback: at least one line item so Square accepts the order.
        name: form.clientName,
        quantity: "1",
        basePriceMoney: { amount: BigInt(0), currency: "AUD" as const },
      }];
  const blob = buildNotesBlob(form);
  return {
    locationId: platterId,
    state: "OPEN" as const,
    lineItems,
    fulfillments: [buildFulfillment(form, blob)],
  };
}

export async function createPlatterCateringOrderFromForm(
  form: CateringOrderForm,
): Promise<CateringOrder> {
  const resp = await squareClient.orders.create({
    idempotencyKey: `catering-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    order: buildRichOrderBody(form),
  });
  const o = resp.order as SqOrder | undefined;
  if (!o) throw new Error("Square did not return a created order.");
  const mapped = toCateringOrder(o);
  if (!mapped) throw new Error("Could not map newly created order.");
  return mapped;
}

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
  patch: Partial<CateringOrderForm>,
): Promise<CateringOrder> {
  const current = await squareClient.orders.get({ orderId });
  const existing = current.order as (SqOrder & { version?: number | bigint }) | undefined;
  if (!existing) throw new Error("Order not found.");
  const existingFull = toCateringOrder(existing);
  if (!existingFull) throw new Error("Could not read existing order.");

  // Merge the entire form shape so metadata (method/payment/utensils/dietary/
  // readyBy/etc.) survives every edit — losing any of those on save would
  // be a data-loss bug.
  const merged: CateringOrderForm = {
    clientName: patch.clientName ?? existingFull.clientName,
    companyName: patch.companyName ?? existingFull.companyName,
    contactPhone: patch.contactPhone ?? existingFull.contactPhone,
    contactEmail: patch.contactEmail ?? existingFull.contactEmail,
    orderMethod: patch.orderMethod ?? existingFull.orderMethod ?? "OTHER",
    fulfillmentType: patch.fulfillmentType ?? existingFull.fulfillmentType ?? "PICKUP",
    deliveryDateISO: patch.deliveryDateISO ?? existingFull.deliveryDateISO,
    deliveryTime: patch.deliveryTime ?? existingFull.deliveryTime,
    readyByTime: patch.readyByTime ?? existingFull.readyByTime,
    deliveryAddress: patch.deliveryAddress ?? (existingFull.deliveryAddressLines.join(", ") || undefined),
    items: patch.items ?? existingFull.menu.map((m) => ({
      name: m.name,
      qty: m.qty,
      unitPrice: m.unitPrice ?? 0,
    })),
    dietaryNotes: patch.dietaryNotes ?? existingFull.dietaryNotes,
    utensilsCount: patch.utensilsCount ?? existingFull.utensilsCount,
    paymentStatus: patch.paymentStatus ?? existingFull.paymentStatus,
  };

  const platterId = squareEnv.platterLocationId;
  if (!platterId) throw new Error("SQUARE_PLATTER_LOCATION_ID not set.");

  const toNum = (v: number | bigint | undefined): number =>
    typeof v === "bigint" ? Number(v) : (v ?? 0);

  const timezone = tz();
  const whenIso = combineLocalDateTime(merged.deliveryDateISO, merged.deliveryTime, timezone);
  const recipientData = {
    displayName: merged.clientName,
    emailAddress: merged.contactEmail || undefined,
    phoneNumber: merged.contactPhone || undefined,
    address: merged.deliveryAddress ? { addressLine1: merged.deliveryAddress } : undefined,
  };
  const blob = buildNotesBlob(merged);

  // Identify the current fulfillment so we can update it in-place (preserving
  // the order ID) instead of cancel + recreate.
  const existingFulfillment = pickFulfillment(existing);
  const existingFulfillmentUid = existingFulfillment?.uid;
  const existingFulfillmentType = existingFulfillment?.type;
  const newFulfillmentType = merged.fulfillmentType;

  // Square does not allow mutating a fulfillment's type after creation.
  // When the type changes we cancel the old fulfillment first, then the
  // update below adds a brand-new one (no uid = new fulfillment).
  const typeChanged = Boolean(
    existingFulfillmentUid &&
    existingFulfillmentType &&
    existingFulfillmentType !== newFulfillmentType,
  );

  let version = toNum(existing.version);

  if (typeChanged && existingFulfillmentUid) {
    const cancelResp = await squareClient.orders.update({
      orderId,
      order: {
        locationId: platterId,
        version,
        fulfillments: [{
          uid: existingFulfillmentUid,
          type: existingFulfillmentType as "PICKUP" | "DELIVERY" | "SHIPMENT",
          state: "CANCELED" as const,
        }],
      },
    });
    version = toNum(
      (cancelResp.order as { version?: number | bigint } | undefined)?.version,
    );
  }

  // Update-in-place: keep the same uid so Square updates the existing
  // fulfillment rather than adding a second one. When the type changed we
  // omit the uid so Square creates a fresh fulfillment.
  const fulfillmentUid = typeChanged ? undefined : existingFulfillmentUid;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newFulfillment: Record<string, any> = newFulfillmentType === "DELIVERY"
    ? {
        uid: fulfillmentUid,
        type: "DELIVERY" as const,
        state: "PROPOSED" as const,
        deliveryDetails: {
          deliverAt: whenIso,
          recipient: recipientData,
          note: blob || undefined,
        },
      }
    : {
        uid: fulfillmentUid,
        type: "PICKUP" as const,
        state: "PROPOSED" as const,
        pickupDetails: {
          pickupAt: whenIso,
          recipient: recipientData,
          note: blob || undefined,
        },
      };

  // Replace all line items: mark every existing uid for removal, then supply
  // the new items without uids (= new in Square's sparse-update model).
  const existingLineItemUids = (existing.lineItems ?? [])
    .map((li) => li.uid)
    .filter((uid): uid is string => Boolean(uid));
  const fieldsToClear: string[] = existingLineItemUids.map(
    (uid) => `line_items[${uid}]`,
  );

  const newLineItems = merged.items.length > 0
    ? merged.items.map((it) => ({
        name: it.name,
        quantity: String(Math.max(1, Math.round(it.qty))),
        basePriceMoney: {
          amount: BigInt(Math.round(it.unitPrice * 100)),
          currency: "AUD" as const,
        },
      }))
    : [{
        name: merged.clientName,
        quantity: "1",
        basePriceMoney: { amount: BigInt(0), currency: "AUD" as const },
      }];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateFn = squareClient.orders.update as unknown as (req: Record<string, any>) => Promise<{ order?: unknown }>;
  const resp = await updateFn({
    orderId,
    order: {
      locationId: platterId,
      version,
      fulfillments: [newFulfillment],
      lineItems: newLineItems,
    },
    fieldsToClear,
  });

  const o = resp.order as SqOrder | undefined;
  if (!o) throw new Error("Square did not return an updated order.");
  const mapped = toCateringOrder(o);
  if (!mapped) throw new Error("Could not map updated order.");
  return mapped;
}

export async function cancelPlatterCateringOrder(orderId: string): Promise<void> {
  const current = await squareClient.orders.get({ orderId });
  const existing = current.order as
    | (SqOrder & { version?: number | bigint; fulfillments?: Array<SqFulfillment & { uid?: string }> })
    | undefined;
  if (!existing) return;
  // Already-cancelled orders cannot transition to CANCELED again — Square
  // 400s. The PATCH "edit" path may pass us a cancelled order when a prior
  // edit already cancelled+recreated; in that case nothing to do here.
  if (existing.state === "CANCELED") return;
  const platterId = squareEnv.platterLocationId;
  if (!platterId) throw new Error("SQUARE_PLATTER_LOCATION_ID not set.");
  const toNum = (v: number | bigint | undefined): number =>
    typeof v === "bigint" ? Number(v) : (v ?? 0);

  // Square refuses to flip an order to CANCELED while any fulfillment is
  // still PROPOSED/RESERVED. Cancel each active fulfillment first, then
  // cancel the order. We replay through orders.update each time so the
  // version number stays current.
  // Square's update only accepts PICKUP/DELIVERY/SHIPMENT fulfillment
  // updates here; DIGITAL fulfillments don't block order cancellation.
  const cancellableTypes = new Set(["PICKUP", "DELIVERY", "SHIPMENT"]);
  const activeFulfillments = (existing.fulfillments ?? []).filter(
    (f) =>
      f.uid &&
      cancellableTypes.has(f.type ?? "") &&
      f.state !== "CANCELED" &&
      f.state !== "COMPLETED" &&
      f.state !== "FAILED",
  );
  let version = toNum(existing.version);
  if (activeFulfillments.length > 0) {
    const resp = await squareClient.orders.update({
      orderId,
      order: {
        locationId: platterId,
        version,
        fulfillments: activeFulfillments.map((f) => ({
          uid: f.uid!,
          type: f.type as "PICKUP" | "DELIVERY" | "SHIPMENT",
          state: "CANCELED",
        })),
      },
    });
    version = toNum((resp.order as { version?: number | bigint } | undefined)?.version);
  }
  await squareClient.orders.update({
    orderId,
    order: { locationId: platterId, state: "CANCELED", version },
  });
}
