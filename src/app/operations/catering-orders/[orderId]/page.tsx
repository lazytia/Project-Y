"use client";

import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  type CateringOrder,
  daysUntil,
  fetchCateringOrder,
} from "@/lib/catering-orders";
import styles from "./page.module.css";

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const KITCHEN_PREP_MINUTES = 45;

function fmtMoney(n: number): string {
  return `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(y, m - 1, d);
  return `${d} ${MONTH_SHORT[m - 1]} ${y} (${WEEKDAY_SHORT[dt.getDay()]})`;
}

function formatTimeMinusMinutes(time: string, minus: number): string {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(time.trim());
  if (!m) return "—";
  let h = parseInt(m[1], 10);
  const mins = parseInt(m[2], 10);
  const ampm = m[3]?.toUpperCase();
  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  const totalMin = h * 60 + mins - minus;
  const wrapped = (totalMin + 24 * 60) % (24 * 60);
  const hh = Math.floor(wrapped / 60);
  const mm = wrapped % 60;
  const display12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
  const meridian = hh < 12 ? "AM" : "PM";
  return `${display12}:${String(mm).padStart(2, "0")} ${meridian}`;
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
function StopwatchIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="13" r="8" /><polyline points="12 9 12 13 14 14" /><line x1="9" y1="2" x2="15" y2="2" /></svg>;
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
function PinIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>;
}
function BuildingIcon() {
  return <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="1" /><line x1="9" y1="6" x2="9" y2="6" /><line x1="9" y1="10" x2="9" y2="10" /><line x1="9" y1="14" x2="9" y2="14" /><line x1="15" y1="6" x2="15" y2="6" /><line x1="15" y1="10" x2="15" y2="10" /><line x1="15" y1="14" x2="15" y2="14" /><path d="M10 22v-4h4v4" /></svg>;
}
function ClipboardIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="4" width="14" height="18" rx="2" /><path d="M9 4V2h6v2" /><line x1="9" y1="10" x2="15" y2="10" /><line x1="9" y1="14" x2="15" y2="14" /><line x1="9" y1="18" x2="13" y2="18" /></svg>;
}
function ForkKnifeIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2v8a2 2 0 0 0 2 2h0v10M10 2v8M8 2v6" /><path d="M16 2c-1.5 0-3 2-3 5s1.5 5 3 5v10" /></svg>;
}
function LeafIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 20A7 7 0 0 1 4 13c0-6 5-10 17-10 0 8-4 16-10 17a7 7 0 0 1-7-7" /><path d="M2 22c4-4 7-7 17-12" /></svg>;
}
function CardIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>;
}

export default function CateringOrderDetailPage() {
  const params = useParams<{ orderId: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [order, setOrder] = useState<CateringOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!params?.orderId || !user) return;
    (async () => {
      try {
        const o = await fetchCateringOrder(user, params.orderId);
        if (!o) setError("Order not found.");
        setOrder(o);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load order.");
      } finally {
        setLoading(false);
      }
    })();
  }, [params?.orderId, user]);

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
  const readyBy = order.readyByTime || formatTimeMinusMinutes(order.deliveryTime, KITCHEN_PREP_MINUTES);

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

      {/* 2-up: Delivery + Ready By */}
      <div className={styles.twoUp}>
        <div className={styles.infoCard}>
          <div className={styles.infoIcon}><CalIcon /></div>
          <div className={styles.infoBody}>
            <p className={styles.infoLabel}>{fulfillmentLabel.toUpperCase()}</p>
            <p className={styles.infoDate}>{fmtDate(order.deliveryDateISO)}</p>
            <p className={styles.infoTime}>{order.deliveryTime}</p>
          </div>
        </div>
        <div className={`${styles.infoCard} ${styles.readyByCard}`}>
          <div className={`${styles.infoIcon} ${styles.readyByIcon}`}><StopwatchIcon /></div>
          <div className={styles.infoBody}>
            <div className={styles.readyByHead}>
              <span className={styles.readyByLabel}>READY BY</span>
              <span className={styles.readyByPill}>KITCHEN DEADLINE</span>
            </div>
            <p className={styles.readyByTime}>{readyBy}</p>
            <p className={styles.readyByHint}>Order must be ready by this time</p>
          </div>
        </div>
      </div>

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

      {/* Delivery Address */}
      {order.deliveryAddressLines.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionIcon}><PinIcon /></div>
          <div className={styles.sectionBody}>
            <p className={styles.sectionTitle}>DELIVERY ADDRESS</p>
            {order.deliveryAddressLines.map((line, idx) => (
              <p key={idx} className={styles.addressLine}>{line}</p>
            ))}
          </div>
          <a
            href={`https://maps.google.com/?q=${encodeURIComponent(order.deliveryAddressLines.join(", "))}`}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.addressBuilding}
            aria-label="Open in maps"
          >
            <BuildingIcon />
          </a>
        </section>
      )}

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
            <span className={styles.orderTotalLabel}>
              Total <span className={styles.orderTotalItems}>({totalMeals} items)</span>
            </span>
            <span className={styles.orderTotalValue}>{fmtMoney(order.totalAmount)}</span>
          </div>
        </div>
      </section>

      {/* 3-up bottom */}
      <div className={styles.threeUp}>
        <div className={styles.miniCard}>
          <span className={styles.miniIcon}><ForkKnifeIcon /></span>
          <p className={styles.miniLabel}>UTENSILS QTY</p>
          <p className={styles.miniValueLarge}>
            {order.utensilsCount ?? 0}<span className={styles.miniUnit}> Sets</span>
          </p>
        </div>
        <div className={styles.miniCard}>
          <span className={styles.miniIcon}><LeafIcon /></span>
          <p className={styles.miniLabel}>SPECIAL DIETARY REQUEST</p>
          <p className={styles.miniValueSmall}>{order.dietaryNotes || "—"}</p>
        </div>
        <div className={styles.miniCard}>
          <span className={styles.miniIcon}><CardIcon /></span>
          <p className={styles.miniLabel}>PAYMENT STATUS</p>
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
      </div>

      <Link
        href={`/operations/catering-orders/new?editId=${encodeURIComponent(order.id)}`}
        className={styles.editBar}
      >
        <EditIcon />
        <span>Edit Order</span>
      </Link>
    </div>
  );
}
