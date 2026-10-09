"use client";

import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useBackToDashboard } from "@/hooks/useBackToDashboard";
import { isStrictOwner } from "@/lib/permissions";
import {
  type CateringDetailsPatch,
  type CateringFulfillmentType,
  type CateringOrder,
  clearCateringSchedule,
  daysUntil,
  fetchCateringOrder,
  fetchCateringSchedule,
  fetchOwnerNote,
  saveCateringDetails,
  saveCateringSchedule,
  saveOwnerNote,
  toTimeInputValue,
} from "@/lib/catering-orders";
import styles from "./page.module.css";

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtMoney(n: number): string {
  return `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(y, m - 1, d);
  return `${d} ${MONTH_SHORT[m - 1]} ${y} (${WEEKDAY_SHORT[dt.getDay()]})`;
}

/** Which of the owner-only inline editors is open (the schedule one is separate). */
type DetailsEditor = "contact" | "utensils";

function prettyPayment(s: string | undefined): string {
  switch (s) {
    case "PAID": return "PAID";
    case "PARTIALLY_PAID": return "PARTIAL";
    case "UNPAID": return "UNPAID";
    default: return "—";
  }
}

/* ── Icons ── */
function BackIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>;
}
function EditIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>;
}
function TruckIcon() {
  return <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="6" width="14" height="11" rx="1" /><path d="M15 9h5l3 4v4h-8z" /><circle cx="5" cy="19" r="2" /><circle cx="18" cy="19" r="2" /></svg>;
}
function BagIcon() {
  return <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>;
}
function GlobeIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><line x1="3" y1="12" x2="21" y2="12" /><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" /></svg>;
}
function DotsIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>;
}

/**
 * One labelled fact on the order — "Ready by", "Phone", "Address".
 *
 * Always drawn, with "Not set" when there is nothing, so the owner can see what
 * is missing (and the kitchen can see it is not just hidden). A `href` makes
 * the value a tel:/mailto: link; a value with line breaks keeps them.
 */
function DetailRow({
  label,
  value,
  href,
}: {
  label: string;
  value?: string | null;
  href?: string;
}) {
  return (
    <div className={styles.detailRow}>
      <span className={styles.detailLabel}>{label}</span>
      {value ? (
        href ? (
          <a href={href} className={styles.detailValue}>{value}</a>
        ) : (
          <span className={styles.detailValue}>{value}</span>
        )
      ) : (
        <span className={styles.detailEmpty}>Not set</span>
      )}
    </div>
  );
}

function methodIconFor(m: string | undefined) {
  switch (m) {
    case "WEBSITE": return <GlobeIcon />;
    case "PHONE": return <PhoneIcon />;
    case "EMAIL": return <MailIcon />;
    default: return <DotsIcon />;
  }
}
function methodLabel(m: string | undefined): string {
  switch (m) {
    case "WEBSITE": return "Website";
    case "PHONE": return "Phone";
    case "EMAIL": return "Email";
    default: return "Other";
  }
}
function CalIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>;
}
function UserIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>;
}
function PhoneIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>;
}
function MailIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>;
}
function CardIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>;
}
function ClipboardIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="4" width="14" height="18" rx="2" /><path d="M9 4V2h6v2" /><line x1="9" y1="10" x2="15" y2="10" /><line x1="9" y1="14" x2="15" y2="14" /><line x1="9" y1="18" x2="13" y2="18" /></svg>;
}
function ChatIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>;
}

export default function CateringOrderDetailPage() {
  const params = useParams<{ orderId: string }>();
  const router = useRouter();
  const goBack = useBackToDashboard();
  const { user } = useAuth();
  const [order, setOrder] = useState<CateringOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Internal Note state (Firestore only)
  const [ownerNote, setOwnerNote] = useState("");
  const [ownerNoteOriginal, setOwnerNoteOriginal] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);

  // Strict-owner-only Cancel (Delete) — flips the Square order to
  // CANCELED so it drops off the calendar. Managers (yurina) and chefs
  // (chuck) intentionally can't cancel; only Tia / Yurica / Eddie can.
  const [cancelling, setCancelling] = useState(false);
  const canCancel = isStrictOwner(user);
  const canEditNotes = isStrictOwner(user);
  // Owners may correct the pickup/delivery slot. The edit is stored in our
  // Firestore only (`catering_schedule`) — the Square order is never mutated.
  const canEditSchedule = isStrictOwner(user);

  const [scheduleEditing, setScheduleEditing] = useState(false);
  const [scheduleOverridden, setScheduleOverridden] = useState(false);
  const [draftDate, setDraftDate] = useState("");
  const [draftTime, setDraftTime] = useState("");
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  // The same inline editor also carries the other kitchen facts that live on
  // that card: pickup or delivery, the ready-by time and the delivery address.
  const [draftFulfillment, setDraftFulfillment] = useState<CateringFulfillmentType>("PICKUP");
  const [draftReadyBy, setDraftReadyBy] = useState("");
  const [draftAddress, setDraftAddress] = useState("");

  // Owner-only order details — who the customer is and how to reach them, and
  // the utensils count. Stored in our Firestore only, like the schedule; the
  // server refuses anyone but a strict owner, this just hides the buttons.
  const canEditDetails = isStrictOwner(user);
  const [detailsEditing, setDetailsEditing] = useState<DetailsEditor | null>(null);
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftCompany, setDraftCompany] = useState("");
  const [draftPhone, setDraftPhone] = useState("");
  const [draftEmail, setDraftEmail] = useState("");
  const [draftUtensils, setDraftUtensils] = useState("");

  useEffect(() => {
    if (!params?.orderId || !user) return;
    const controller = new AbortController();
    (async () => {
      try {
        const [o, note, schedule] = await Promise.all([
          fetchCateringOrder(user, params.orderId, controller.signal),
          fetchOwnerNote(user, params.orderId, controller.signal),
          fetchCateringSchedule(user, params.orderId, controller.signal),
        ]);
        if (!o) setError("Order not found.");
        setOrder(o);
        setOwnerNote(note);
        setOwnerNoteOriginal(note);
        setScheduleOverridden(schedule !== null);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Could not load order.");
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [params?.orderId, user]);

  async function handleCancel() {
    if (!user || !params?.orderId || cancelling) return;
    // Name, slot and total, not just the name: two orders for the same
    // customer on the same day are exactly when a duplicate gets hidden, and
    // the name alone doesn't say which of them this is.
    const label = order
      ? `${order.clientName}\n${fmtDate(order.deliveryDateISO)} · ${order.deliveryTime} · ${fmtMoney(order.totalAmount)}`
      : "this order";
    const ok = window.confirm(
      `Hide this order from the calendar?\n\n${label}\n\nThe order stays in Square untouched — this only removes it from our app's calendar. Use for test or duplicate rows.`,
    );
    if (!ok) return;
    setCancelling(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(
        `/api/catering-orders/${encodeURIComponent(params.orderId)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${idToken}` },
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Cancel failed (${res.status}).`);
      router.push("/operations/catering-orders");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to cancel order.");
      setCancelling(false);
    }
  }

  async function handleSaveNote() {
    if (!user || !params?.orderId) return;
    setNoteSaving(true);
    setNoteSaved(false);
    try {
      await saveOwnerNote(user, params.orderId, ownerNote);
      setOwnerNoteOriginal(ownerNote);
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 2000);
    } catch {
      /* best-effort */
    } finally {
      setNoteSaving(false);
    }
  }

  /**
   * Re-read the order after an edit. The server owns how an override is
   * overlaid on Square's order — and what a cleared field falls back to — so
   * the page asks again rather than guessing from what it just sent.
   */
  async function refreshOrder() {
    if (!user || !params?.orderId) return;
    const [fresh, schedule] = await Promise.all([
      fetchCateringOrder(user, params.orderId),
      fetchCateringSchedule(user, params.orderId),
    ]);
    if (fresh) setOrder(fresh);
    setScheduleOverridden(schedule !== null);
  }

  /** Open the inline editor seeded with whatever is on screen right now. */
  function startScheduleEdit() {
    if (!order) return;
    setDraftDate(order.deliveryDateISO);
    setDraftTime(toTimeInputValue(order.deliveryTime));
    setDraftFulfillment(order.fulfillmentType ?? "PICKUP");
    setDraftReadyBy(toTimeInputValue(order.readyByTime));
    setDraftAddress(order.deliveryAddressLines.join("\n"));
    setScheduleError(null);
    setScheduleEditing(true);
  }

  async function handleSaveSchedule() {
    if (!user || !params?.orderId || !order || scheduleSaving) return;
    if (!draftDate || !draftTime) {
      setScheduleError("Pick both a date and a time.");
      return;
    }

    // Send only what actually changed: a slot override marks the order
    // "Edited in app", and that should not appear for a change of address.
    const slotChanged =
      draftDate !== order.deliveryDateISO || draftTime !== toTimeInputValue(order.deliveryTime);
    const patch: CateringDetailsPatch = {};
    if (draftFulfillment !== (order.fulfillmentType ?? "PICKUP")) {
      patch.fulfillmentType = draftFulfillment;
    }
    if (draftReadyBy !== toTimeInputValue(order.readyByTime)) {
      patch.readyByTime = draftReadyBy || null;
    }
    if (
      draftFulfillment === "DELIVERY" &&
      draftAddress.trim() !== order.deliveryAddressLines.join("\n")
    ) {
      patch.deliveryAddress = draftAddress.trim() || null;
    }
    if (!slotChanged && Object.keys(patch).length === 0) {
      setScheduleEditing(false);
      return;
    }

    setScheduleSaving(true);
    setScheduleError(null);
    try {
      if (slotChanged) {
        await saveCateringSchedule(user, params.orderId, {
          deliveryDateISO: draftDate,
          deliveryTime: draftTime,
        });
      }
      if (Object.keys(patch).length > 0) {
        await saveCateringDetails(user, params.orderId, patch);
      }
      await refreshOrder();
      setScheduleEditing(false);
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : "Failed to save.");
      // The slot and the details are two writes. If the second failed the
      // first is already stored, so show what is really saved.
      await refreshOrder().catch(() => {});
    } finally {
      setScheduleSaving(false);
    }
  }

  /** Save a details patch for the contact or utensils editor, then re-read. */
  async function saveDetails(patch: CateringDetailsPatch) {
    if (!user || !params?.orderId || detailsSaving) return;
    if (Object.keys(patch).length === 0) {
      setDetailsEditing(null);
      return;
    }
    setDetailsSaving(true);
    setDetailsError(null);
    try {
      await saveCateringDetails(user, params.orderId, patch);
      await refreshOrder();
      setDetailsEditing(null);
    } catch (err) {
      setDetailsError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setDetailsSaving(false);
    }
  }

  function startContactEdit() {
    if (!order) return;
    setDraftName(order.contactName || order.clientName);
    setDraftCompany(order.companyName ?? "");
    setDraftPhone(order.contactPhone ?? "");
    setDraftEmail(order.contactEmail ?? "");
    setDetailsError(null);
    setDetailsEditing("contact");
  }

  function handleSaveContact() {
    if (!order) return;
    const patch: CateringDetailsPatch = {};
    if (draftName.trim() !== (order.contactName || order.clientName)) {
      patch.clientName = draftName.trim() || null;
    }
    if (draftCompany.trim() !== (order.companyName ?? "")) {
      patch.companyName = draftCompany.trim() || null;
    }
    if (draftPhone.trim() !== (order.contactPhone ?? "")) {
      patch.contactPhone = draftPhone.trim() || null;
    }
    if (draftEmail.trim() !== (order.contactEmail ?? "")) {
      patch.contactEmail = draftEmail.trim() || null;
    }
    void saveDetails(patch);
  }

  function startUtensilsEdit() {
    if (!order) return;
    setDraftUtensils(order.utensilsCount === undefined ? "" : String(order.utensilsCount));
    setDetailsError(null);
    setDetailsEditing("utensils");
  }

  function handleSaveUtensils() {
    if (!order) return;
    const current = order.utensilsCount === undefined ? "" : String(order.utensilsCount);
    const next = draftUtensils.trim();
    // Empty means "use Square's count", which is what clearing the override does.
    void saveDetails(next === current ? {} : { utensilsCount: next === "" ? null : Number(next) });
  }

  /** Drop our override so the order shows Square's own slot again. */
  async function handleResetSchedule() {
    if (!user || !params?.orderId || !order || scheduleSaving) return;
    setScheduleSaving(true);
    setScheduleError(null);
    try {
      const square = await clearCateringSchedule(user, params.orderId);
      if (square) setOrder({ ...order, ...square });
      setScheduleOverridden(false);
      setScheduleEditing(false);
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : "Failed to reset.");
    } finally {
      setScheduleSaving(false);
    }
  }

  const totalMeals = useMemo(() => {
    if (!order) return 0;
    return order.menu.reduce((sum, m) => sum + (m.qty ?? 0), 0);
  }, [order]);

  if (loading) {
    return <div className={styles.page}><p className={styles.center}>Loading…</p></div>;
  }
  if (error || !order) {
    return (
      <div className={styles.page}>
        <button type="button" className={styles.backTop} onClick={goBack} aria-label="Back"><BackIcon /></button>
        <p className={styles.center}>{error ?? "Order not found."}</p>
        <Link href="/operations/catering-orders" className={styles.center}>← Back to calendar</Link>
      </div>
    );
  }

  const isDelivery = order.fulfillmentType === "DELIVERY";
  const heroIcon = isDelivery ? <TruckIcon /> : <BagIcon />;
  const fulfillmentLabel = isDelivery ? "Delivery" : "Pickup";
  const dCount = daysUntil(order.deliveryDateISO);

  return (
    <div className={styles.page}>
      <button type="button" className={styles.backTop} onClick={goBack} aria-label="Back">
        <BackIcon />
      </button>

      {/* Hero header */}
      <header className={styles.hero}>
        <div className={styles.heroLeft}>
          <span className={styles.heroIcon}>{heroIcon}</span>
          <div>
            <h1 className={styles.heroTitle}>{order.clientName}</h1>
            <p className={styles.heroSub}>{fulfillmentLabel} Order</p>
            {order.orderMethod ? (
              <p className={styles.heroMethod}>
                <span className={styles.heroMethodIcon}>{methodIconFor(order.orderMethod)}</span>
                Via {methodLabel(order.orderMethod)}
              </p>
            ) : null}
          </div>
        </div>
        <div className={styles.heroRight}>
          <p className={styles.heroDN}>{`D${dCount >= 0 ? "-" : "+"}${Math.abs(dCount)}`}</p>
          <p className={styles.heroDaysLabel}>
            {dCount === 0 ? "Today" : dCount === 1 ? "Day to go" : dCount > 0 ? "Days to go" : "Days ago"}
          </p>
        </div>
      </header>

      {/* Pickup / Delivery — owners can correct the slot in our app only */}
      <section className={styles.section}>
        <div className={styles.sectionIcon}><CalIcon /></div>
        <div className={styles.sectionBody}>
          <div className={styles.scheduleHead}>
            <p className={styles.sectionTitle}>{fulfillmentLabel.toUpperCase()}</p>
            {canEditSchedule && !scheduleEditing && (
              <button
                type="button"
                className={styles.scheduleEditBtn}
                onClick={startScheduleEdit}
              >
                <EditIcon /> Edit
              </button>
            )}
          </div>

          {scheduleEditing ? (
            <div className={styles.scheduleEditor}>
              <div className={styles.segment} role="group" aria-label="Pickup or delivery">
                {(["PICKUP", "DELIVERY"] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className={`${styles.segmentBtn} ${draftFulfillment === kind ? styles.segmentBtnActive : ""}`}
                    aria-pressed={draftFulfillment === kind}
                    onClick={() => setDraftFulfillment(kind)}
                  >
                    {kind === "PICKUP" ? "Pickup" : "Delivery"}
                  </button>
                ))}
              </div>
              <label className={styles.scheduleField}>
                <span className={styles.scheduleFieldLabel}>Date</span>
                <input
                  type="date"
                  className={styles.scheduleInput}
                  value={draftDate}
                  onChange={(e) => setDraftDate(e.target.value)}
                />
              </label>
              <label className={styles.scheduleField}>
                <span className={styles.scheduleFieldLabel}>Time</span>
                <input
                  type="time"
                  className={styles.scheduleInput}
                  value={draftTime}
                  onChange={(e) => setDraftTime(e.target.value)}
                />
              </label>
              <label className={styles.scheduleField}>
                <span className={styles.scheduleFieldLabel}>Ready by</span>
                <input
                  type="time"
                  className={styles.scheduleInput}
                  value={draftReadyBy}
                  onChange={(e) => setDraftReadyBy(e.target.value)}
                />
              </label>
              {draftFulfillment === "DELIVERY" && (
                <label className={`${styles.scheduleField} ${styles.scheduleFieldTop}`}>
                  <span className={styles.scheduleFieldLabel}>Address</span>
                  <textarea
                    className={`${styles.scheduleInput} ${styles.scheduleTextarea}`}
                    rows={3}
                    maxLength={300}
                    placeholder={"Street address\nSuburb, state, postcode"}
                    value={draftAddress}
                    onChange={(e) => setDraftAddress(e.target.value)}
                  />
                </label>
              )}
              {scheduleError && <p className={styles.scheduleError}>{scheduleError}</p>}
              <div className={styles.scheduleActions}>
                <button
                  type="button"
                  className={styles.scheduleSaveBtn}
                  disabled={scheduleSaving}
                  onClick={handleSaveSchedule}
                >
                  {scheduleSaving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  className={styles.scheduleCancelBtn}
                  disabled={scheduleSaving}
                  onClick={() => { setScheduleEditing(false); setScheduleError(null); }}
                >
                  Cancel
                </button>
                {scheduleOverridden && (
                  <button
                    type="button"
                    className={styles.scheduleResetBtn}
                    disabled={scheduleSaving}
                    onClick={handleResetSchedule}
                  >
                    Reset to Square
                  </button>
                )}
              </div>
              <p className={styles.scheduleHint}>
                Saved in our app only — the Square order is never changed. A field left
                empty falls back to Square.
              </p>
            </div>
          ) : (
            <>
              <p className={styles.pickupDate}>{fmtDate(order.deliveryDateISO)}</p>
              <p className={styles.pickupTime}>{order.deliveryTime}</p>
              {scheduleOverridden && (
                <p className={styles.scheduleBadge}>Edited in app · Square unchanged</p>
              )}
              <div className={styles.detailRows}>
                <DetailRow label="Ready by" value={order.readyByTime} />
                {isDelivery && (
                  <DetailRow label="Address" value={order.deliveryAddressLines.join("\n")} />
                )}
              </div>
            </>
          )}
        </div>
      </section>

      {/* Contact */}
      <section className={styles.section}>
        <div className={styles.sectionIcon}><UserIcon /></div>
        <div className={styles.sectionBody}>
          <div className={styles.scheduleHead}>
            <p className={styles.sectionTitle}>CONTACT</p>
            {canEditDetails && detailsEditing !== "contact" && (
              <button type="button" className={styles.scheduleEditBtn} onClick={startContactEdit}>
                <EditIcon /> Edit
              </button>
            )}
          </div>

          {detailsEditing === "contact" ? (
            <div className={styles.scheduleEditor}>
              <label className={styles.scheduleField}>
                <span className={styles.scheduleFieldLabel}>Name</span>
                <input
                  className={styles.scheduleInput}
                  value={draftName}
                  maxLength={120}
                  autoComplete="off"
                  onChange={(e) => setDraftName(e.target.value)}
                />
              </label>
              <label className={styles.scheduleField}>
                <span className={styles.scheduleFieldLabel}>Company</span>
                <input
                  className={styles.scheduleInput}
                  value={draftCompany}
                  maxLength={120}
                  autoComplete="off"
                  onChange={(e) => setDraftCompany(e.target.value)}
                />
              </label>
              <label className={styles.scheduleField}>
                <span className={styles.scheduleFieldLabel}>Phone</span>
                <input
                  type="tel"
                  className={styles.scheduleInput}
                  value={draftPhone}
                  maxLength={40}
                  autoComplete="off"
                  onChange={(e) => setDraftPhone(e.target.value)}
                />
              </label>
              <label className={styles.scheduleField}>
                <span className={styles.scheduleFieldLabel}>Email</span>
                <input
                  type="email"
                  className={styles.scheduleInput}
                  value={draftEmail}
                  maxLength={120}
                  autoComplete="off"
                  onChange={(e) => setDraftEmail(e.target.value)}
                />
              </label>
              {detailsError && <p className={styles.scheduleError}>{detailsError}</p>}
              <div className={styles.scheduleActions}>
                <button
                  type="button"
                  className={styles.scheduleSaveBtn}
                  disabled={detailsSaving}
                  onClick={handleSaveContact}
                >
                  {detailsSaving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  className={styles.scheduleCancelBtn}
                  disabled={detailsSaving}
                  onClick={() => { setDetailsEditing(null); setDetailsError(null); }}
                >
                  Cancel
                </button>
              </div>
              <p className={styles.scheduleHint}>
                Saved in our app only — the Square order is never changed. A field left
                empty falls back to Square.
              </p>
            </div>
          ) : (
            <>
              <p className={styles.contactName}>{order.contactName || order.clientName}</p>
              <div className={styles.detailRows}>
                <DetailRow label="Company" value={order.companyName} />
                <DetailRow
                  label="Phone"
                  value={order.contactPhone}
                  href={order.contactPhone ? `tel:${order.contactPhone}` : undefined}
                />
                <DetailRow
                  label="Email"
                  value={order.contactEmail}
                  href={order.contactEmail ? `mailto:${order.contactEmail}` : undefined}
                />
              </div>
            </>
          )}
        </div>
      </section>

      {/* Payment Status */}
      <section className={styles.section}>
        <div className={styles.sectionIcon}><CardIcon /></div>
        <div className={styles.sectionBody}>
          <p className={styles.sectionTitle}>PAYMENT STATUS</p>
          <span
            className={`${styles.paymentPill} ${
              order.paymentStatus === "PAID"
                ? styles.paymentPaid
                : order.paymentStatus === "PARTIALLY_PAID"
                  ? styles.paymentPartial
                  : styles.paymentUnpaid
            }`}
          >
            {prettyPayment(order.paymentStatus)}
          </span>
        </div>
        {/* The status stays for everyone — whether it is paid is something the
            kitchen needs — but the amount is only for owners and the chef. The
            server leaves it out of the response for anyone else. */}
        {!order.pricesHidden && (
          <span className={styles.paymentAmount}>{fmtMoney(order.totalAmount)}</span>
        )}
      </section>

      {/* Order Details */}
      <section className={styles.section}>
        <div className={styles.sectionIcon}><ClipboardIcon /></div>
        <div className={styles.sectionBody}>
          <p className={styles.sectionTitle}>ORDER DETAILS</p>
          <ul className={styles.itemList}>
            {order.menu.map((m, idx) => (
              <li key={`${m.name}-${idx}`} className={styles.itemLine}>
                <span className={styles.itemName}>{m.name}</span>
                <span className={styles.itemQty}>x {m.qty}</span>
              </li>
            ))}
          </ul>
          <div className={styles.orderTotalRow}>
            {order.pricesHidden ? (
              // No price to total, so the row just counts what is in the order.
              <span className={styles.orderTotalLabel}>
                {totalMeals} {totalMeals === 1 ? "item" : "items"}
              </span>
            ) : (
              <>
                <span className={styles.orderTotalLabel}>
                  Total <span className={styles.orderTotalItems}>({totalMeals} items)</span>
                </span>
                <span className={styles.orderTotalValue}>{fmtMoney(order.totalAmount)}</span>
              </>
            )}
          </div>

          {/* Utensils are a count the kitchen packs for, not a priced line, so
              they sit under the total rather than in the item list — which also
              keeps them visible when Square has no utensil line to show. */}
          {detailsEditing === "utensils" ? (
            <div className={styles.scheduleEditor}>
              <label className={styles.scheduleField}>
                <span className={styles.scheduleFieldLabel}>Utensils</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={9999}
                  step={1}
                  className={styles.scheduleInput}
                  value={draftUtensils}
                  onChange={(e) => setDraftUtensils(e.target.value)}
                />
              </label>
              {detailsError && <p className={styles.scheduleError}>{detailsError}</p>}
              <div className={styles.scheduleActions}>
                <button
                  type="button"
                  className={styles.scheduleSaveBtn}
                  disabled={detailsSaving}
                  onClick={handleSaveUtensils}
                >
                  {detailsSaving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  className={styles.scheduleCancelBtn}
                  disabled={detailsSaving}
                  onClick={() => { setDetailsEditing(null); setDetailsError(null); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className={styles.utensilsRow}>
              <DetailRow
                label="Utensils"
                value={order.utensilsCount === undefined ? null : String(order.utensilsCount)}
              />
              {canEditDetails && (
                <button type="button" className={styles.scheduleEditBtn} onClick={startUtensilsEdit}>
                  <EditIcon /> Edit
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Customer Note */}
      <section className={styles.section}>
        <div className={styles.sectionIcon}><ChatIcon /></div>
        <div className={styles.sectionBody}>
          <p className={styles.sectionTitle}>CUSTOMER NOTE</p>
          {order.notes.length > 0 ? (
            <div className={styles.noteBox}>
              {order.notes.map((n, i) => (
                <p key={i} className={styles.noteText}>{n}</p>
              ))}
            </div>
          ) : (
            <div className={styles.noteBox}>
              <p className={styles.noteEmpty}>No notes from customer.</p>
            </div>
          )}
        </div>
      </section>

      {/* Internal Note (editable by strict owners only, Firestore) */}
      <section className={styles.section}>
        <div className={styles.sectionIcon}><EditIcon /></div>
        <div className={styles.sectionBody}>
          <p className={styles.sectionTitle}>INTERNAL NOTE</p>
          <textarea
            className={styles.ownerNoteInput}
            value={ownerNote}
            onChange={(e) => { setOwnerNote(e.target.value); setNoteSaved(false); }}
            placeholder={canEditNotes ? "Add a note for this order…" : "Owner only."}
            rows={3}
            maxLength={500}
            readOnly={!canEditNotes}
          />
          <div className={styles.ownerNoteFooter}>
            <span className={styles.ownerNoteCount}>{ownerNote.length} / 500</span>
            {canEditNotes && (
              noteSaved ? (
                <span className={styles.ownerNoteSavedLabel}>✓ Saved</span>
              ) : (
                <button
                  type="button"
                  className={styles.ownerNoteSaveBtn}
                  disabled={noteSaving || ownerNote === ownerNoteOriginal}
                  onClick={handleSaveNote}
                >
                  {noteSaving ? "Saving…" : "Save Note"}
                </button>
              )
            )}
          </div>
        </div>
      </section>

      {canCancel && (
        <section className={styles.dangerZone}>
          <button
            type="button"
            className={styles.cancelBtn}
            disabled={cancelling}
            onClick={handleCancel}
          >
            {cancelling ? "Hiding…" : "Hide from calendar"}
          </button>
          <p className={styles.dangerHint}>
            Removes this order from our app&rsquo;s calendar only. Square is the source of truth and is never modified.
          </p>
        </section>
      )}
    </div>
  );
}
