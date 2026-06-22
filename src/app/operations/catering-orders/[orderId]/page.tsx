"use client";

import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  type CateringOrder,
  dCountdownLabel,
  fetchCateringOrder,
} from "@/lib/catering-orders";
import styles from "./page.module.css";

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtMoney(n: number): string {
  return `$${n.toLocaleString("en-AU", { maximumFractionDigits: 0 })}`;
}

function prettyMethod(m: string): string {
  switch (m) {
    case "WEBSITE": return "Website";
    case "PHONE": return "Phone";
    case "EMAIL": return "Email";
    case "OTHER": return "Other";
    default: return m;
  }
}
function prettyPayment(s: string): string {
  switch (s) {
    case "PAID": return "Paid";
    case "PARTIALLY_PAID": return "Partially Paid";
    case "UNPAID": return "Unpaid";
    default: return s;
  }
}

const KITCHEN_PREP_MINUTES = 45;

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

function StopwatchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="13" r="8" />
      <polyline points="12 9 12 13 14 14" />
      <line x1="9" y1="2" x2="15" y2="2" />
    </svg>
  );
}

function fmtDate(iso: string): { date: string; weekday: string } {
  const [y, m, d] = iso.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(y, m - 1, d);
  return {
    date: `${d} ${MONTH_SHORT[m - 1]} ${y}`,
    weekday: WEEKDAY_SHORT[dt.getDay()],
  };
}

function BackIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}
function EditIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}
function CalIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </svg>
  );
}
function PeopleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function DollarIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M9 9.5c0-1.1 1.3-1.8 3-1.8s3 .7 3 1.8c0 1.5-1.6 1.8-3 2s-3 .5-3 2c0 1.1 1.3 1.8 3 1.8s3-.7 3-1.8" />
    </svg>
  );
}
function PhoneIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}
function MailIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}
function MapPinIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
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

  const groupedMenu = useMemo(() => {
    if (!order) return [];
    const groups = new Map<string, typeof order.menu>();
    for (const m of order.menu) {
      const key = m.category ?? "Items";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }
    return Array.from(groups.entries());
  }, [order]);

  const totalMeals = useMemo(() => {
    if (!order) return 0;
    return order.menu.reduce((sum, m) => sum + (m.qty ?? 0), 0);
  }, [order]);

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <button type="button" className={styles.iconBtn} onClick={() => router.back()} aria-label="Back">
          <BackIcon />
        </button>
        <Link
          href={order ? `/operations/catering-orders/new?editId=${encodeURIComponent(order.id)}` : "#"}
          className={styles.iconBtn}
          aria-label="Edit"
        >
          <EditIcon />
        </Link>
      </div>

      {loading ? (
        <p className={styles.center}>Loading…</p>
      ) : error || !order ? (
        <div className={styles.center}>
          <p>{error ?? "Order not found."}</p>
          <Link href="/operations/catering-orders" className={styles.backLink}>← Back to calendar</Link>
        </div>
      ) : (
        <>
          <p className={styles.dLabel}>{dCountdownLabel(order.deliveryDateISO)}</p>
          <div className={styles.titleRow}>
            <h1 className={styles.clientTitle}>{order.clientName}</h1>
            <span className={`${styles.statusPill} ${styles[`status_${order.status}`] ?? ""}`}>
              {order.status}
            </span>
          </div>

          <div className={styles.factGrid}>
            <FactCol icon={<CalIcon />} value={fmtDate(order.deliveryDateISO).date} label={fmtDate(order.deliveryDateISO).weekday} />
            <FactCol
              icon={<ClockIcon />}
              value={order.deliveryTime}
              label={order.fulfillmentType === "DELIVERY" ? "Delivery" : "Pickup"}
            />
            <FactCol
              icon={<PeopleIcon />}
              value={String(order.utensilsCount ?? 0)}
              label="Utensils"
            />
            <FactCol icon={<DollarIcon />} value={fmtMoney(order.totalAmount)} label="Total" />
          </div>

          <div className={styles.readyByCard}>
            <div className={styles.readyByIcon}><StopwatchIcon /></div>
            <div className={styles.readyByBody}>
              <div className={styles.readyByHead}>
                <span className={styles.readyByLabel}>READY BY TIME</span>
                <span className={styles.readyByPill}>KITCHEN DEADLINE</span>
              </div>
              <p className={styles.readyByTime}>
                {order.readyByTime || formatTimeMinusMinutes(order.deliveryTime, KITCHEN_PREP_MINUTES)}
              </p>
              <p className={styles.readyByHint}>Order must be ready by this time</p>
            </div>
          </div>

          {(order.contactName || order.contactPhone || order.contactEmail || order.companyName) && (
            <section className={styles.section}>
              <p className={styles.sectionTitle}>CONTACT</p>
              {order.contactName ? <p className={styles.line}>{order.contactName}</p> : null}
              {order.companyName ? (
                <p className={styles.line} style={{ color: "var(--color-fg-muted)" }}>
                  {order.companyName}
                </p>
              ) : null}
              {order.contactPhone ? (
                <div className={styles.row}>
                  <p className={styles.line}>{order.contactPhone}</p>
                  <a href={`tel:${order.contactPhone}`} className={styles.iconBtn} aria-label="Call"><PhoneIcon /></a>
                </div>
              ) : null}
              {order.contactEmail ? (
                <div className={styles.row}>
                  <p className={styles.line}>{order.contactEmail}</p>
                  <a href={`mailto:${order.contactEmail}`} className={styles.iconBtn} aria-label="Email"><MailIcon /></a>
                </div>
              ) : null}
            </section>
          )}

          {(order.orderMethod || order.fulfillmentType || order.paymentStatus) && (
            <section className={styles.section}>
              <p className={styles.sectionTitle}>ORDER</p>
              <div className={styles.tagRow}>
                {order.orderMethod ? (
                  <span className={styles.tag}>Method · {prettyMethod(order.orderMethod)}</span>
                ) : null}
                {order.fulfillmentType ? (
                  <span className={styles.tag}>{order.fulfillmentType === "DELIVERY" ? "Delivery" : "Pickup"}</span>
                ) : null}
                {order.paymentStatus ? (
                  <span
                    className={`${styles.tag} ${
                      order.paymentStatus === "PAID"
                        ? styles.tagPaid
                        : order.paymentStatus === "PARTIALLY_PAID"
                          ? styles.tagPartial
                          : styles.tagUnpaid
                    }`}
                  >
                    {prettyPayment(order.paymentStatus)}
                  </span>
                ) : null}
              </div>
            </section>
          )}

          {order.deliveryAddressLines.length > 0 && (
            <section className={styles.section}>
              <p className={styles.sectionTitle}>DELIVERY ADDRESS</p>
              <div className={styles.row}>
                <div>
                  {order.deliveryAddressLines.map((line, idx) => (
                    <p key={idx} className={styles.line}>{line}</p>
                  ))}
                </div>
                <a
                  href={`https://maps.google.com/?q=${encodeURIComponent(order.deliveryAddressLines.join(", "))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.iconBtn}
                  aria-label="Open in maps"
                >
                  <MapPinIcon />
                </a>
              </div>
            </section>
          )}

          <section className={styles.section}>
            <p className={styles.sectionTitle}>SPECIAL DIETARY REQUEST</p>
            <p
              className={styles.line}
              style={{
                whiteSpace: "pre-wrap",
                color: order.dietaryNotes ? "var(--color-fg)" : "var(--color-fg-subtle)",
              }}
            >
              {order.dietaryNotes || "—"}
            </p>
          </section>

          <section className={styles.section}>
            <p className={styles.sectionTitle}>UTENSILS QTY</p>
            <p className={styles.line}>{order.utensilsCount ?? 0}</p>
          </section>

          {order.notes.length > 0 && (
            <section className={styles.section}>
              <p className={styles.sectionTitle}>NOTES</p>
              <ul className={styles.notesList}>
                {order.notes.map((n, idx) => (
                  <li key={idx}>{n}</li>
                ))}
              </ul>
            </section>
          )}

          <section className={styles.section}>
            <p className={styles.sectionTitle}>MENU SUMMARY</p>
            {groupedMenu.map(([cat, lines]) => (
              <div key={cat} className={styles.menuGroup}>
                <p className={styles.menuGroupTitle}>{cat}</p>
                <ul className={styles.menuList}>
                  {lines.map((m, idx) => (
                    <li key={`${m.name}-${idx}`} className={styles.menuLine}>
                      <span>{m.name}</span>
                      <span className={styles.menuQty}>x {m.qty}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <p className={styles.totalMeals}>Total {totalMeals} Meals</p>
          </section>
        </>
      )}
    </div>
  );
}

function FactCol({
  icon, value, label,
}: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className={styles.factCol}>
      <span className={styles.factIcon}>{icon}</span>
      <p className={styles.factValue}>{value}</p>
      <p className={styles.factLabel}>{label}</p>
    </div>
  );
}
