"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import type {
  CateringFulfillmentType,
  CateringOrder,
  CateringOrderMethod,
  CateringPaymentStatus,
} from "@/lib/catering-orders";
import { fetchCateringOrder, todayISO } from "@/lib/catering-orders";
import styles from "./page.module.css";

/** Minutes between READY-BY and the customer's delivery/pickup time. */
const KITCHEN_PREP_MINUTES = 45;

type MenuItem = { id: string; name: string; priceCents: number; currency: string };
type FormItem = { tempId: string; name: string; qty: number; unitPrice: number };

function PhoneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}
function MailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}
function GlobeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" />
    </svg>
  );
}
function DotsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}
function BagIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}
function TruckIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="6" width="14" height="11" rx="1" />
      <path d="M15 9h5l3 4v4h-8z" />
      <circle cx="5" cy="19" r="2" />
      <circle cx="18" cy="19" r="2" />
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </svg>
  );
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
function MapPinIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
function MinusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function tempId(): string {
  return Math.random().toString(36).slice(2, 10);
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

function fmtFriendlyDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export default function NewCateringOrderPage() {
  const { user } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const presetDate = search?.get("date") || todayISO();
  const editId = search?.get("editId") ?? null;

  // Form state
  const [clientName, setClientName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [orderMethod, setOrderMethod] = useState<CateringOrderMethod>("WEBSITE");
  const [fulfillmentType, setFulfillmentType] = useState<CateringFulfillmentType>("PICKUP");
  const [deliveryDate, setDeliveryDate] = useState(presetDate);
  const [deliveryTime, setDeliveryTime] = useState("11:30 AM");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [items, setItems] = useState<FormItem[]>([]);
  const [dietary, setDietary] = useState("");
  const [utensils, setUtensils] = useState<number>(0);
  const [paymentStatus, setPaymentStatus] = useState<CateringPaymentStatus>("UNPAID");

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addItemOpen, setAddItemOpen] = useState(false);
  // Catalog is fetched once on mount so opening the Add Item sheet is instant.
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [menuError, setMenuError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const idToken = await user.getIdToken();
        const res = await fetch("/api/catering-orders/menu", {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`);
        if (!cancelled) setMenu((data?.items ?? []) as MenuItem[]);
      } catch (err) {
        if (!cancelled) setMenuError(err instanceof Error ? err.message : "Could not load menu.");
      } finally {
        if (!cancelled) setMenuLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const readyByTime = useMemo(
    () => formatTimeMinusMinutes(deliveryTime, KITCHEN_PREP_MINUTES),
    [deliveryTime],
  );

  // Edit-mode hydration: pull the existing Square order and pre-fill state.
  useEffect(() => {
    if (!editId || !user) return;
    (async () => {
      try {
        const o = await fetchCateringOrder(user, editId);
        if (!o) {
          setError("Order not found.");
          return;
        }
        hydrateFromOrder(o);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load order.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, user]);

  function hydrateFromOrder(o: CateringOrder) {
    setClientName(o.clientName);
    setDeliveryDate(o.deliveryDateISO);
    setDeliveryTime(o.deliveryTime);
    if (o.contactName) setClientName(o.contactName);
    if (o.contactPhone) setPhone(o.contactPhone);
    if (o.contactEmail) setEmail(o.contactEmail);
    if (o.deliveryAddressLines.length > 0) {
      setFulfillmentType("DELIVERY");
      setDeliveryAddress(o.deliveryAddressLines.join("\n"));
    }
    // Pull metadata back out of the notes blob (best-effort — Square doesn't
    // give us a structured place to store the form-only fields).
    const blob = o.notes.join("\n");
    const m = (re: RegExp) => blob.match(re)?.[1]?.trim();
    const company = m(/Company:\s*([^\n]+)/i);
    const method = m(/Method:\s*([A-Z_]+)/i);
    const payment = m(/Payment:\s*([A-Z_]+)/i);
    const utensilsStr = m(/Utensils:\s*(\d+)/i);
    const dietary = m(/Dietary:\s*([\s\S]+?)(?:\n[A-Z][a-z]+:|$)/);
    if (company) setCompanyName(company);
    if (method) setOrderMethod(method as CateringOrderMethod);
    if (payment) setPaymentStatus(payment as CateringPaymentStatus);
    if (utensilsStr) setUtensils(parseInt(utensilsStr, 10) || 0);
    if (dietary) setDietary(dietary);
    setItems(
      o.menu.map((m2) => ({
        tempId: tempId(),
        name: m2.name,
        qty: m2.qty,
        unitPrice: m2.unitPrice ?? 0,
      })),
    );
  }

  function addItem(name: string, unitPrice: number) {
    setItems((prev) => {
      const existing = prev.find((p) => p.name === name && p.unitPrice === unitPrice);
      if (existing) {
        return prev.map((p) => (p === existing ? { ...p, qty: p.qty + 1 } : p));
      }
      return [...prev, { tempId: tempId(), name, qty: 1, unitPrice }];
    });
  }
  function bumpQty(id: string, delta: number) {
    setItems((prev) =>
      prev
        .map((p) => (p.tempId === id ? { ...p, qty: Math.max(0, p.qty + delta) } : p))
        .filter((p) => p.qty > 0),
    );
  }
  function removeItem(id: string) {
    setItems((prev) => prev.filter((p) => p.tempId !== id));
  }

  async function submit() {
    if (!user) return;
    if (!clientName.trim()) {
      setError("Customer name is required.");
      return;
    }
    if (!deliveryDate || !deliveryTime) {
      setError("Date and time are required.");
      return;
    }
    if (fulfillmentType === "DELIVERY" && !deliveryAddress.trim()) {
      setError("Delivery address is required for delivery orders.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/catering-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          clientName,
          companyName: companyName || undefined,
          contactPhone: phone || undefined,
          contactEmail: email || undefined,
          orderMethod,
          fulfillmentType,
          deliveryDateISO: deliveryDate,
          deliveryTime,
          deliveryAddress: fulfillmentType === "DELIVERY" ? deliveryAddress : undefined,
          items: items.map((i) => ({ name: i.name, qty: i.qty, unitPrice: i.unitPrice })),
          dietaryNotes: dietary || undefined,
          utensilsCount: utensils || undefined,
          paymentStatus,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`);
      router.push("/operations/catering-orders");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save order.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <p className={styles.title}>NEW CATERING ORDER</p>

      {/* 1. ORDER INFORMATION */}
      <Section step={1} title="ORDER INFORMATION">
        <Field label="Customer Name *">
          <input value={clientName} onChange={(e) => setClientName(e.target.value)} />
        </Field>
        <Field label="Company Name">
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
        </Field>
        <Field label="Phone *" iconRight={<PhoneIcon />}>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Email" iconRight={<MailIcon />}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
      </Section>

      {/* 2. ORDER METHOD */}
      <Section step={2} title="ORDER METHOD">
        <div className={styles.methodGrid}>
          {(
            [
              { v: "WEBSITE", label: "Website", icon: <GlobeIcon /> },
              { v: "PHONE", label: "Phone", icon: <PhoneIcon /> },
              { v: "EMAIL", label: "Email", icon: <MailIcon /> },
              { v: "OTHER", label: "Other", icon: <DotsIcon /> },
            ] as const
          ).map((m) => (
            <button
              key={m.v}
              type="button"
              className={`${styles.methodBtn} ${orderMethod === m.v ? styles.methodBtnActive : ""}`}
              onClick={() => setOrderMethod(m.v)}
            >
              <span className={styles.methodIcon}>{m.icon}</span>
              <span>{m.label}</span>
            </button>
          ))}
        </div>
      </Section>

      {/* 3. PICKUP OR DELIVERY */}
      <Section step={3} title="PICKUP OR DELIVERY">
        <div className={styles.pickupGrid}>
          {(
            [
              { v: "PICKUP", title: "PICKUP", sub: "Customer will pick up", icon: <BagIcon /> },
              { v: "DELIVERY", title: "DELIVERY", sub: "We will deliver to the address", icon: <TruckIcon /> },
            ] as const
          ).map((p) => (
            <button
              key={p.v}
              type="button"
              className={`${styles.pickupCard} ${fulfillmentType === p.v ? styles.pickupCardActive : ""}`}
              onClick={() => setFulfillmentType(p.v)}
            >
              <span className={styles.pickupIcon}>{p.icon}</span>
              <span className={styles.pickupTitle}>{p.title}</span>
              <span className={styles.pickupSub}>{p.sub}</span>
            </button>
          ))}
        </div>
      </Section>

      {/* 4. DATE & TIME (+ READY BY + ADDRESS) */}
      <Section step={4} title="DATE & TIME">
        <div className={styles.dateRow}>
          <Field label={`${fulfillmentType === "DELIVERY" ? "Delivery" : "Pickup"} Date *`} iconRight={<CalendarIcon />}>
            <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
          </Field>
          <Field label={`${fulfillmentType === "DELIVERY" ? "Delivery" : "Pickup"} Time *`} iconRight={<ClockIcon />}>
            <input value={deliveryTime} onChange={(e) => setDeliveryTime(e.target.value)} placeholder="11:30 AM" />
          </Field>
        </div>

        <div className={styles.readyByCard}>
          <div className={styles.readyByIcon}><StopwatchIcon /></div>
          <div className={styles.readyByBody}>
            <div className={styles.readyByHead}>
              <span className={styles.readyByLabel}>READY BY TIME</span>
              <span className={styles.readyByPill}>KITCHEN DEADLINE</span>
            </div>
            <p className={styles.readyByTime}>{readyByTime}</p>
            <p className={styles.readyByHint}>Order must be ready by this time</p>
          </div>
        </div>

        {fulfillmentType === "DELIVERY" && (
          <div className={styles.addressCard}>
            <p className={styles.addressTitle}>DELIVERY ADDRESS</p>
            <Field label="Address" iconRight={<MapPinIcon />}>
              <textarea
                rows={2}
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
              />
            </Field>
          </div>
        )}
      </Section>

      {/* 5. ORDER DETAILS */}
      <Section step={5} title="ORDER DETAILS">
        <ul className={styles.itemList}>
          {items.map((it) => (
            <li key={it.tempId} className={styles.itemRow}>
              <span className={styles.itemName}>{it.name}</span>
              <div className={styles.qtyControls}>
                <button type="button" className={styles.qtyBtn} onClick={() => bumpQty(it.tempId, -1)} aria-label="Decrease">
                  <MinusIcon />
                </button>
                <span className={styles.qtyVal}>x {it.qty}</span>
                <button type="button" className={styles.qtyBtn} onClick={() => bumpQty(it.tempId, 1)} aria-label="Increase">
                  <PlusIcon />
                </button>
              </div>
              <button type="button" className={styles.trashBtn} onClick={() => removeItem(it.tempId)} aria-label="Remove">
                <TrashIcon />
              </button>
            </li>
          ))}
          <li>
            <button type="button" className={styles.addItemBtn} onClick={() => setAddItemOpen(true)}>
              <PlusIcon /> Add Item
            </button>
          </li>
        </ul>
      </Section>

      {/* 6. SPECIAL DIETARY REQUEST */}
      <Section step={6} title="SPECIAL DIETARY REQUEST">
        <div className={styles.dietaryWrap}>
          <textarea
            value={dietary}
            onChange={(e) => setDietary(e.target.value)}
            placeholder="No sesame (1 guest)&#10;Vegetarian (2 guests)"
            maxLength={250}
            rows={4}
          />
          <span className={styles.dietaryCount}>{dietary.length} / 250</span>
        </div>
        <p className={styles.helper}>List any allergies or dietary requirements.</p>
      </Section>

      {/* 7. UTENSILS QTY */}
      <Section step={7} title="UTENSILS QTY">
        <div className={styles.utensilsRow}>
          <div className={styles.utensilsField}>
            <span className={styles.fieldLabel}>Utensils Required</span>
            <span className={styles.utensilsValue}>{utensils}</span>
          </div>
          <div className={styles.utensilsControls}>
            <button type="button" className={styles.qtyBtn} onClick={() => setUtensils((u) => Math.max(0, u - 1))} aria-label="Decrease">
              <MinusIcon />
            </button>
            <button type="button" className={styles.qtyBtn} onClick={() => setUtensils((u) => u + 1)} aria-label="Increase">
              <PlusIcon />
            </button>
          </div>
        </div>
        <p className={styles.helper}>Total number of guests who need utensils.</p>
      </Section>

      {/* 8. PAYMENT STATUS */}
      <Section step={8} title="PAYMENT STATUS">
        <div className={styles.paymentGrid}>
          {(
            [
              { v: "UNPAID", label: "Unpaid" },
              { v: "PARTIALLY_PAID", label: "Partially Paid" },
              { v: "PAID", label: "Paid" },
            ] as const
          ).map((p) => (
            <button
              key={p.v}
              type="button"
              className={`${styles.paymentBtn} ${paymentStatus === p.v ? styles.paymentBtnActive : ""}`}
              onClick={() => setPaymentStatus(p.v)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className={styles.helper}>Select the current payment status for this order.</p>
      </Section>

      {error ? <p className={styles.error}>{error}</p> : null}

      {/* Sticky action bar */}
      <div className={styles.actionBar}>
        <Link href="/operations/catering-orders" className={styles.saveDraft}>Save as Draft</Link>
        <button type="button" className={styles.saveBtn} onClick={submit} disabled={submitting}>
          {submitting ? "Saving…" : "SAVE ORDER"}
        </button>
      </div>

      {addItemOpen && (
        <AddItemModal
          menu={menu}
          loading={menuLoading}
          error={menuError}
          onClose={() => setAddItemOpen(false)}
          onPick={(name, priceCents) => {
            addItem(name, priceCents / 100);
            setAddItemOpen(false);
          }}
        />
      )}
    </div>
  );
}

function Section({
  step, title, children,
}: { step: number; title: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.stepBadge}>{step}</span>
        <p className={styles.sectionTitle}>{title}</p>
      </div>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

function Field({
  label, iconRight, children,
}: { label: string; iconRight?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className={styles.fieldOuter}>
      <span className={styles.fieldLabel}>{label}</span>
      <div className={styles.fieldInner}>
        {children}
        {iconRight ? <span className={styles.fieldIcon}>{iconRight}</span> : null}
      </div>
    </label>
  );
}

function AddItemModal({
  menu, loading, error, onClose, onPick,
}: {
  menu: MenuItem[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onPick: (name: string, priceCents: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customPrice, setCustomPrice] = useState<number | "">("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return menu.slice(0, 50);
    return menu.filter((i) => i.name.toLowerCase().includes(q)).slice(0, 50);
  }, [menu, query]);

  function pickCustom() {
    if (!customName.trim() || customPrice === "" || customPrice <= 0) return;
    onPick(customName.trim(), Math.round(customPrice * 100));
    setCustomName("");
    setCustomPrice("");
    setCustomOpen(false);
  }

  return (
    <div className={styles.sheetBackdrop} onClick={onClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={styles.sheetHead}>
          <p className={styles.sheetTitle}>ADD ITEM</p>
          <button type="button" className={styles.sheetClose} onClick={onClose} aria-label="Close">×</button>
        </div>

        <p className={styles.sheetLabel}>Item Search</p>
        <div className={styles.searchWrap}>
          <span className={styles.searchIcon}><SearchIcon /></span>
          <input
            className={styles.searchInput}
            placeholder="Search menu…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query ? (
            <button type="button" className={styles.searchClear} onClick={() => setQuery("")} aria-label="Clear">×</button>
          ) : null}
        </div>

        {loading ? (
          <p className={styles.sheetEmpty}>Loading menu…</p>
        ) : error ? (
          <p className={styles.error}>{error}</p>
        ) : (
          <ul className={styles.menuList}>
            {filtered.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  className={styles.menuItem}
                  onClick={() => onPick(it.name, it.priceCents)}
                  aria-label={`Add ${it.name}`}
                >
                  <span className={styles.menuThumb} aria-hidden="true">🍱</span>
                  <span className={styles.menuInfo}>
                    <span className={styles.menuName}>{it.name}</span>
                    <span className={styles.menuPrice}>${(it.priceCents / 100).toFixed(2)}</span>
                  </span>
                  <span className={styles.menuAdd} aria-hidden="true"><PlusIcon /></span>
                </button>
              </li>
            ))}
            {filtered.length === 0 ? (
              <li className={styles.sheetEmpty}>No matches.</li>
            ) : null}
          </ul>
        )}

        <div className={styles.customBlock}>
          {customOpen ? (
            <div className={styles.customForm}>
              <input
                placeholder="Item name"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
              />
              <input
                type="number"
                placeholder="Price ($)"
                value={customPrice}
                onChange={(e) => setCustomPrice(e.target.value === "" ? "" : parseFloat(e.target.value))}
              />
              <button type="button" className={styles.menuAdd} onClick={pickCustom} aria-label="Add custom item">
                <PlusIcon />
              </button>
            </div>
          ) : (
            <>
              <span className={styles.customHint}>No matching item?</span>
              <button type="button" className={styles.customLink} onClick={() => setCustomOpen(true)}>
                Create custom item
              </button>
              <button type="button" className={styles.menuAdd} onClick={() => setCustomOpen(true)} aria-label="Create custom item">
                <PlusIcon />
              </button>
            </>
          )}
        </div>

      </div>
    </div>
  );
}
