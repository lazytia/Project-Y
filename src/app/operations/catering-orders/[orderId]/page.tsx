"use client";

import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { isStrictOwner } from "@/lib/permissions";
import {
  type CateringOrder,
  daysUntil,
  fetchCateringOrder,
  fetchOwnerNote,
  saveOwnerNote,
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

  useEffect(() => {
    if (!params?.orderId || !user) return;
    const controller = new AbortController();
    (async () => {
      try {
        const [o, note] = await Promise.all([
          fetchCateringOrder(user, params.orderId, controller.signal),
          fetchOwnerNote(user, params.orderId, controller.signal),
        ]);
        if (!o) setError("Order not found.");
        setOrder(o);
        setOwnerNote(note);
        setOwnerNoteOriginal(note);
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
    const label = order?.clientName
      ? `${order.clientName}'s order`
      : "this order";
    const ok = window.confirm(
      `Hide ${label} from the calendar?\n\nThe order stays in Square untouched — this only removes it from our app's calendar. Use for test or duplicate rows.`,
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
        <button type="button" className={styles.backTop} onClick={() => router.back()} aria-label="Back"><BackIcon /></button>
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
      <button type="button" className={styles.backTop} onClick={() => router.back()} aria-label="Back">
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

      {/* Pickup / Delivery */}
      <section className={styles.section}>
        <div className={styles.sectionIcon}><CalIcon /></div>
        <div className={styles.sectionBody}>
          <p className={styles.sectionTitle}>{fulfillmentLabel.toUpperCase()}</p>
          <p className={styles.pickupDate}>{fmtDate(order.deliveryDateISO)}</p>
          <p className={styles.pickupTime}>{order.deliveryTime}</p>
        </div>
      </section>

      {/* Contact */}
      <section className={styles.section}>
        <div className={styles.sectionIcon}><UserIcon /></div>
        <div className={styles.sectionBody}>
          <p className={styles.sectionTitle}>CONTACT</p>
          <p className={styles.contactName}>{order.contactName || order.clientName}</p>
          {order.companyName ? <p className={styles.contactCompany}>{order.companyName}</p> : null}
        </div>
        <div className={styles.contactRight}>
          {order.contactPhone ? (
            <a href={`tel:${order.contactPhone}`} className={styles.contactLine}>
              <PhoneIcon />
              <span>{order.contactPhone}</span>
            </a>
          ) : null}
          {order.contactEmail ? (
            <a href={`mailto:${order.contactEmail}`} className={styles.contactLine}>
              <MailIcon />
              <span>{order.contactEmail}</span>
            </a>
          ) : null}
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
        <span className={styles.paymentAmount}>{fmtMoney(order.totalAmount)}</span>
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
            {(order.utensilsCount ?? 0) > 0 &&
              !order.menu.some((m) => /utensil|cutlery/i.test(m.name)) && (
              <li className={styles.itemLine}>
                <span className={styles.itemName}>Utensil Set</span>
                <span className={styles.itemQty}>x {order.utensilsCount}</span>
              </li>
            )}
          </ul>
          <div className={styles.orderTotalRow}>
            <span className={styles.orderTotalLabel}>
              Total <span className={styles.orderTotalItems}>({totalMeals} items)</span>
            </span>
            <span className={styles.orderTotalValue}>{fmtMoney(order.totalAmount)}</span>
          </div>
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

      {/* Internal Note (editable, Firestore only) */}
      <section className={styles.section}>
        <div className={styles.sectionIcon}><EditIcon /></div>
        <div className={styles.sectionBody}>
          <p className={styles.sectionTitle}>INTERNAL NOTE</p>
          <textarea
            className={styles.ownerNoteInput}
            value={ownerNote}
            onChange={(e) => { setOwnerNote(e.target.value); setNoteSaved(false); }}
            placeholder="Add a note for this order…"
            rows={3}
            maxLength={500}
          />
          <div className={styles.ownerNoteFooter}>
            <span className={styles.ownerNoteCount}>{ownerNote.length} / 500</span>
            {noteSaved ? (
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
