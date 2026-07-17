/**
 * Firestore mirror for catering orders.
 *
 * Every catering order fetched from or written to Square is also persisted
 * in the `catering_orders` collection (keyed by Square order ID) so we
 * have a full local record including edit history.
 *
 * Collection: catering_orders/{squareOrderId}
 * Sub-collection: catering_orders/{squareOrderId}/history/{auto-id}
 */
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import type { CateringOrder } from "@/lib/catering-orders";

const COLLECTION = "catering_orders";

/** Serialise a CateringOrder into a plain object safe for Firestore. */
function toDoc(order: CateringOrder) {
  return {
    squareOrderId: order.id,
    clientName: order.clientName,
    status: order.status,
    deliveryDateISO: order.deliveryDateISO,
    deliveryTime: order.deliveryTime,
    guestsCount: order.guestsCount,
    totalAmount: order.totalAmount,
    contactName: order.contactName ?? null,
    contactPhone: order.contactPhone ?? null,
    contactEmail: order.contactEmail ?? null,
    deliveryAddressLines: order.deliveryAddressLines,
    notes: order.notes,
    menu: order.menu.map((m) => ({
      name: m.name,
      qty: m.qty,
      unitPrice: m.unitPrice ?? null,
      category: m.category ?? null,
    })),
    fulfillmentType: order.fulfillmentType ?? null,
    companyName: order.companyName ?? null,
    orderMethod: order.orderMethod ?? null,
    paymentStatus: order.paymentStatus ?? null,
    utensilsCount: order.utensilsCount ?? null,
    dietaryNotes: order.dietaryNotes ?? null,
    readyByTime: order.readyByTime ?? null,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/**
 * Save (upsert) a single catering order to Firestore.
 * Called after every Square fetch/create/update.
 */
export async function syncOrderToFirestore(
  order: CateringOrder,
  action: "fetched" | "created" | "updated" | "cancelled" = "fetched",
) {
  try {
    const db = adminDb();
    const ref = db.collection(COLLECTION).doc(order.id);
    const doc = toDoc(order);

    // Upsert the main document — set createdAt only on first write.
    await ref.set(
      { ...doc, createdAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    // Overwrite updatedAt every time (merge keeps createdAt from first write).
    await ref.update({ updatedAt: FieldValue.serverTimestamp() });

    // Append to the history sub-collection so we have a full audit trail.
    await ref.collection("history").add({
      ...doc,
      action,
      timestamp: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // Best-effort — don't let Firestore failures break the API response.
    console.error("[catering-firestore] sync failed:", err);
  }
}

/**
 * Get the owner's note for a given order.
 */
export async function getOwnerNote(orderId: string): Promise<string> {
  try {
    const db = adminDb();
    const snap = await db.collection(COLLECTION).doc(orderId).get();
    if (!snap.exists) return "";
    return (snap.data()?.ownerNote as string) ?? "";
  } catch (err) {
    console.error("[catering-firestore] getOwnerNote failed:", err);
    return "";
  }
}

/**
 * Save (only) the owner's note for a given order + append to history.
 */
export async function saveOwnerNoteToFirestore(
  orderId: string,
  ownerNote: string,
): Promise<void> {
  const db = adminDb();
  const ref = db.collection(COLLECTION).doc(orderId);

  await ref.set(
    {
      ownerNote,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await ref.collection("history").add({
    action: "owner_note_updated",
    ownerNote,
    timestamp: FieldValue.serverTimestamp(),
  });
}

const HIDDEN_COLLECTION = "catering_hidden";

/**
 * Mark a Square order as "hidden" in our app only — the source of
 * truth stays in Square (owner direction: Square must never be
 * mutated by the app). The calendar filters these out on read.
 */
export async function hideCateringOrder(
  orderId: string,
  hiddenBy: string | null,
): Promise<void> {
  await adminDb()
    .collection(HIDDEN_COLLECTION)
    .doc(orderId)
    .set(
      {
        hiddenAt: FieldValue.serverTimestamp(),
        hiddenBy: hiddenBy ?? null,
      },
      { merge: true },
    );
}

/** Return the set of Square order IDs the owner has hidden from the app. */
export async function fetchHiddenOrderIds(): Promise<Set<string>> {
  try {
    const snap = await adminDb().collection(HIDDEN_COLLECTION).get();
    return new Set(snap.docs.map((d) => d.id));
  } catch (err) {
    console.warn("[catering-firestore] hidden lookup failed:", err);
    return new Set();
  }
}

/**
 * Batch-sync multiple orders (used by the list endpoint).
 */
export async function syncOrdersToFirestore(orders: CateringOrder[]) {
  try {
    const db = adminDb();
    const batch = db.batch();
    for (const order of orders) {
      const ref = db.collection(COLLECTION).doc(order.id);
      batch.set(
        ref,
        { ...toDoc(order), createdAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
    }
    await batch.commit();
  } catch (err) {
    console.error("[catering-firestore] batch sync failed:", err);
  }
}
