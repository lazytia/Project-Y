"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  AREA_LABELS,
  type BlockSeating,
  type BlockedDate,
  type BlockedDateCreateInput,
  type Reservation,
  type ReservationBranch,
  type ReservationSeating,
  type ReservationService,
  type ReservationStatus,
  SERVICES,
  createBlockedDate,
  createReservation,
  deleteBlockedDate,
  describeBlock,
  fetchBlockedDates,
  fetchReservationsForDate,
  fetchUpcomingBlockedDates,
  fmt12h,
  isCancelled,
  openServices,
  serviceFor,
  serviceTimeOptions,
  serviceWindow,
  setReservationStatus,
  todayISO,
  updateReservation,
} from "@/lib/reservations";
import { resolveCompany } from "@/lib/reservation-company";
import styles from "./page.module.css";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtHeaderDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${WEEKDAYS[dt.getDay()]} ${d} ${MONTH_SHORT[m - 1]}`;
}
function fmtLongDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH_SHORT[m - 1]} ${y}`;
}
function shortTime(time: string): string {
  const [h, m] = time.split(":");
  return `${h}:${(m ?? "00").padStart(2, "0")}`;
}
function prettySeating(s: ReservationSeating): string {
  if (s === "indoor") return "Indoor";
  if (s === "outdoor") return "Outdoor";
  return "Bar";
}

/* ── Icons ── */
function RefreshIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>;
}
function CalIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>;
}
function SearchIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>;
}
function ChevronRight() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 6 15 12 9 18" /></svg>;
}
function PhoneIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>;
}
function ClockIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg>;
}
function PeopleIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>;
}
function SeatIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="9" width="14" height="8" rx="2" /><path d="M5 17v2M19 17v2" /><path d="M7 9V5h10v4" /></svg>;
}
function BuildingIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path d="M9 7h1M9 11h1M9 15h1M14 7h1M14 11h1M14 15h1" />
    </svg>
  );
}
function EditIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>;
}
function NoShowIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="17" y1="8" x2="22" y2="13" /><line x1="22" y1="8" x2="17" y2="13" /></svg>;
}
function TrashIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>;
}
function ShowIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>;
}
function CancelledIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>;
}
function PlusIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
}
function SunIcon({ size = 28 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>;
}
function MoonIcon({ size = 28 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /><circle cx="19" cy="5" r="1" fill="currentColor" stroke="none" /><circle cx="17" cy="9" r="0.5" fill="currentColor" stroke="none" /></svg>;
}
/** ⊘ — the header action that opens the availability blocking sheet. */
function BlockIcon({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><line x1="5.6" y1="5.6" x2="18.4" y2="18.4" /></svg>;
}
function XIcon({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;
}
/** Entire Service — a filled block spanning the whole window. */
function ServiceScopeIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /></svg>;
}
/** Area — seating zones laid out as a grid. */
function AreaScopeIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>;
}

/* ── Page ── */

export default function ReservationsPage() {
  const { user } = useAuth();
  // Defer todayISO() to the first client effect so SSR renders an empty
  // string and hydration matches. Otherwise server (UTC-ish) and client
  // (Sydney) can pick different dates around midnight UTC and the page
  // crashes with "Application error: a client-side exception has occurred".
  const [dateISO, setDateISO] = useState<string>("");
  useEffect(() => {
    if (!dateISO) setDateISO(todayISO());
  }, [dateISO]);
  // Open on whichever service is running now, so an evening shift doesn't
  // land on an empty lunch list. Client-only for the same hydration reason.
  const [service, setService] = useState<ReservationService>("LUNCH");
  useEffect(() => {
    setService(serviceFor(new Date().toTimeString().slice(0, 5)));
  }, []);
  const [branch] = useState<ReservationBranch>("northsydney");
  const [list, setList] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState<Reservation | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Reservation | null>(null);
  const [blocks, setBlocks] = useState<BlockedDate[]>([]);
  const [blockOpen, setBlockOpen] = useState(false);
  // Native date picker — we toss a hidden input into the page and call
  // its showPicker() so a tap on the calendar icon goes straight to the
  // OS picker instead of opening an intermediate sheet.
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  function openDatePicker() {
    const el = dateInputRef.current;
    if (!el) return;
    try {
      (el as unknown as { showPicker?: () => void }).showPicker?.();
    } catch { /* ignore — older browsers fall through to focus() */ }
    el.focus();
  }
  async function reload() {
    if (!user || !dateISO) return;
    setLoading(true);
    try {
      const docs = await fetchReservationsForDate(user, dateISO, branch);
      setList(docs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load reservations.");
    } finally {
      setLoading(false);
    }
  }

  /**
   * Blocks load separately from the bookings: a failure here must not blank
   * out the day's reservations, so it only clears the local list rather than
   * setting the page-level error.
   */
  async function reloadBlocks() {
    if (!user || !dateISO) return;
    try {
      setBlocks(await fetchBlockedDates(user, dateISO, branch));
    } catch {
      setBlocks([]);
    }
  }

  useEffect(() => {
    reload();
    reloadBlocks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateISO, user]);

  const active = useMemo(() => list.filter((r) => !isCancelled(r) && r.status !== "no-show"), [list]);
  // Cancelled bookings stay visible in the day list (with a badge) but drop
  // out of every guest/booking total via `active` above. The totals are the
  // net figure only — 50 booked with 20 cancelled simply reads as 30.
  const listed = useMemo(() => list.filter((r) => r.status !== "no-show"), [list]);

  // Keyed by ReservationService so the summary card can be rendered from a
  // single loop over ["LUNCH", "DINNER"] instead of two copies of the markup.
  const serviceTotals = useMemo(() => {
    function calc(rows: Reservation[]) {
      const indoor = rows.filter((r) => r.seating === "indoor").reduce((s, r) => s + r.count, 0);
      const outdoor = rows.filter((r) => r.seating !== "indoor").reduce((s, r) => s + r.count, 0);
      return { bookings: rows.length, guests: indoor + outdoor, indoor, outdoor };
    }
    const LUNCH = calc(active.filter((r) => serviceFor(r.time) === "LUNCH"));
    const DINNER = calc(active.filter((r) => serviceFor(r.time) === "DINNER"));
    return { LUNCH, DINNER, total: LUNCH.guests + DINNER.guests };
  }, [active]);

  const filteredListed = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return listed;
    const digits = q.replace(/\D/g, "");
    return listed.filter((r) => {
      if (digits && r.phone.replace(/\D/g, "").includes(digits)) return true;
      return r.name.toLowerCase().includes(q);
    });
  }, [listed, query]);

  // The list shows one service at a time; the toggle above it picks which.
  const visibleRows = useMemo(
    () => filteredListed.filter((r) => serviceFor(r.time) === service),
    [filteredListed, service],
  );

  async function applyStatus(id: string, status: "confirmed" | "seated" | "no-show" | "cancelled") {
    if (!user) return;
    try {
      await setReservationStatus(user, id, status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update status.");
    } finally {
      setFocused(null);
      await reload();
    }
  }

  /** Lift a block — the slot becomes bookable again on the customer site. */
  async function removeBlock(id: string) {
    if (!user) return;
    try {
      await deleteBlockedDate(user, id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the block.");
    } finally {
      await reloadBlocks();
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Reservations</h1>
          <p className={styles.subtitle}>{fmtHeaderDate(dateISO)}</p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.iconBtn} onClick={reload} aria-label="Refresh"><RefreshIcon /></button>
          <button type="button" className={styles.iconBtn} onClick={openDatePicker} aria-label="Pick date"><CalIcon /></button>
          <button
            type="button"
            className={`${styles.iconBtn} ${styles.iconBtnBlock}`}
            onClick={() => setBlockOpen(true)}
            aria-label="Block availability"
          >
            <BlockIcon />
          </button>
          <input
            ref={dateInputRef}
            type="date"
            className={styles.hiddenDateInput}
            value={dateISO}
            onChange={(e) => { if (e.target.value) setDateISO(e.target.value); }}
            tabIndex={-1}
            aria-hidden="true"
          />
        </div>
      </div>

      {/* One card: the day's net total on top, then the two services side by
          side underneath, so the headline number and its breakdown read as a
          single figure rather than three competing cards. */}
      <div className={styles.dayCard}>
        <div className={styles.dayCardHero}>
          <p className={styles.heroNumber}>{serviceTotals.total}</p>
          <p className={styles.heroLabel}>TODAY&apos;S GUESTS</p>
        </div>
        <div className={styles.dayCardServices}>
          {SERVICES.map((svc) => {
            const t = serviceTotals[svc];
            const window = serviceWindow(svc, dateISO, branch);
            return (
              <div key={svc} className={styles.dayCardService}>
                <div className={styles.serviceCardHead}>
                  <span className={styles.serviceCardIcon}>
                    {svc === "LUNCH" ? <SunIcon size={22} /> : <MoonIcon size={22} />}
                  </span>
                  <div>
                    <p className={styles.serviceCardTitle}>{svc}</p>
                    <p className={styles.serviceCardWindow}>
                      {window ? `${window.start} – ${window.end}` : "Closed"}
                    </p>
                  </div>
                </div>
                <div className={styles.serviceCardStats}>
                  <div className={styles.serviceCardStat}>
                    <p className={styles.serviceCardStatValue}>{t.guests}</p>
                    <p className={styles.serviceCardStatLabel}>Guests</p>
                  </div>
                  <span className={styles.serviceCardDivider} aria-hidden="true" />
                  <div className={styles.serviceCardStat}>
                    <p className={styles.serviceCardStatValueSm}>{t.bookings}</p>
                    <p className={styles.serviceCardStatLabel}>Bookings</p>
                  </div>
                </div>
                <div className={styles.serviceCardStats}>
                  <div className={styles.serviceCardStat}>
                    <p className={styles.serviceCardStatLabel}>Indoor</p>
                    <p className={styles.serviceCardStatAccent}>{t.indoor}</p>
                  </div>
                  <span className={styles.serviceCardDivider} aria-hidden="true" />
                  <div className={styles.serviceCardStat}>
                    <p className={styles.serviceCardStatLabel}>Outdoor</p>
                    <p className={styles.serviceCardStatAccent}>{t.outdoor}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {blocks.length > 0 && (
        <section className={styles.blockSection}>
          <p className={styles.blockHeading}>Availability</p>
          <ul className={styles.blockList}>
            {blocks.map((b) => (
              <li key={b.id} className={styles.blockRow}>
                <span className={styles.blockIcon}><BlockIcon size={16} /></span>
                <span className={styles.blockText}>
                  {describeBlock(b)} · <strong>BLOCKED</strong>
                </span>
                <button
                  type="button"
                  className={styles.blockRemove}
                  onClick={() => removeBlock(b.id)}
                  aria-label={`Remove block: ${describeBlock(b)}`}
                >
                  <XIcon />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className={styles.serviceToggle} role="tablist" aria-label="Service">
        {SERVICES.map((svc) => (
          <button
            key={svc}
            type="button"
            role="tab"
            aria-selected={service === svc}
            className={`${styles.serviceToggleBtn} ${service === svc ? styles.serviceToggleBtnActive : ""}`}
            onClick={() => setService(svc)}
          >
            {svc === "LUNCH" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
            <span>{svc === "LUNCH" ? "Lunch" : "Dinner"}</span>
          </button>
        ))}
      </div>

      <div className={styles.searchWrap}>
        <span className={styles.searchIcon}><SearchIcon /></span>
        <input
          className={styles.searchInput}
          placeholder="Search by phone"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <p className={styles.empty}>Loading…</p>
      ) : error ? (
        <p className={styles.error}>{error}</p>
      ) : (
        <section className={styles.section}>
          <p className={styles.listHeading}>Upcoming bookings</p>
          {visibleRows.length === 0 ? (
            <p className={styles.sectionEmpty}>No reservations.</p>
          ) : (
            <ul className={styles.cardList}>
              {visibleRows.map((r) => (
                <li key={r.id}>
                  <button type="button" className={styles.card} onClick={() => setFocused(r)}>
                    <span className={styles.cardBar} aria-hidden="true" />
                    <span className={styles.cardTime}>{shortTime(r.time)}</span>
                    <span className={styles.cardBody}>
                      <span className={styles.cardName}>{r.name}</span>
                      <span className={styles.cardMeta}>{r.count} Guests · {prettySeating(r.seating)}</span>
                    </span>
                    {(() => {
                      // Only render a pill for statuses staff need to act on.
                      // "unconfirmed", "confirmed", "pending" are the
                      // normal flow and don't need a badge.
                      switch (r.status) {
                        case "no-show":
                          return <span className={`${styles.statusPill} ${styles.statusPillNoShow}`}>No Show</span>;
                        case "seated":
                          return <span className={`${styles.statusPill} ${styles.statusPillSeated}`}>Seated</span>;
                        case "cancelled":
                          return <span className={`${styles.statusPill} ${styles.statusPillUpdated}`}>Cancelled</span>;
                        case "updated":
                          return <span className={`${styles.statusPill} ${styles.statusPillUpdated}`}>Updated</span>;
                        default:
                          if (r.customerUpdated) {
                            return <span className={`${styles.statusPill} ${styles.statusPillUpdated}`}>Updated</span>;
                          }
                          return null;
                      }
                    })()}
                    <span className={styles.cardChev}><ChevronRight /></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <button type="button" className={styles.addBtn} onClick={() => { setEditing(null); setAddOpen(true); }}>
        <PlusIcon />
        <span>Add reservation</span>
      </button>

      {focused && (
        <DetailModal
          reservation={focused}
          onClose={() => setFocused(null)}
          onEdit={() => { setEditing(focused); setAddOpen(true); setFocused(null); }}
          onSeat={() => applyStatus(focused.id, "seated")}
          onMarkNoShow={() => applyStatus(focused.id, "no-show")}
          onCancel={() => applyStatus(focused.id, "cancelled")}
        />
      )}

      {blockOpen && (
        <BlockAvailabilityModal
          dateISO={dateISO}
          branch={branch}
          service={service}
          onClose={() => setBlockOpen(false)}
          onChanged={reloadBlocks}
        />
      )}

      {addOpen && (
        <AddReservationModal
          dateISO={dateISO}
          editing={editing}
          branch={branch}
          onClose={() => { setAddOpen(false); setEditing(null); }}
          onSaved={async () => {
            setAddOpen(false);
            setEditing(null);
            await reload();
          }}
        />
      )}

    </div>
  );
}

/* ── Detail Modal ── */

function DetailModal({
  reservation, onClose, onEdit, onSeat, onMarkNoShow, onCancel,
}: {
  reservation: Reservation;
  onClose: () => void;
  onEdit: () => void;
  onSeat: () => void | Promise<void>;
  onMarkNoShow: () => void | Promise<void>;
  onCancel: () => void | Promise<void>;
}) {
  const { user } = useAuth();
  const company = useMemo(() => resolveCompany(reservation), [reservation]);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [companySummary, setCompanySummary] = useState<{
    companyName: string;
    websiteUrl: string | null;
    summary: string;
    industry: string | null;
    tld: string | null;
    googleSearchUrl: string;
  } | null>(null);

  async function openCompanySummary() {
    if (!company || !user) return;

    const fallbackGoogle = `https://www.google.com/search?q=${encodeURIComponent(`${company.displayName} company`)}`;

    setSummaryOpen(true);
    setSummaryLoading(true);
    setSummaryError(null);
    setCompanySummary(null);
    try {
      const idToken = await user.getIdToken();
      const qs = new URLSearchParams({
        slug: company.slug,
        name: company.displayName,
      });
      const res = await fetch(`/api/reservations/company-summary?${qs.toString()}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`);

      const googleSearchUrl =
        typeof data.googleSearchUrl === "string" ? data.googleSearchUrl : fallbackGoogle;

      if (!data.found || !data.summary) {
        // Staff asked for the summary in-app, so stay in the sheet rather
        // than hijacking the tap into a Google tab. The link is right there
        // if they want to dig further.
        setCompanySummary({
          companyName: String(data.companyName ?? company.displayName),
          websiteUrl: null,
          summary: "No quick summary found. Search Google for details.",
          industry: null,
          tld: null,
          googleSearchUrl,
        });
        return;
      }

      setCompanySummary({
        companyName: String(data.companyName ?? company.displayName),
        websiteUrl: typeof data.websiteUrl === "string" ? data.websiteUrl : null,
        summary: String(data.summary),
        industry: typeof data.industry === "string" && data.industry ? data.industry : null,
        tld: typeof data.tld === "string" ? data.tld : null,
        googleSearchUrl,
      });
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : "Could not load company summary.");
    } finally {
      setSummaryLoading(false);
    }
  }

  return (
    <>
    <div className={styles.sheetBackdrop} onClick={onClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={styles.sheetClose} onClick={onClose} aria-label="Close">×</button>
        <h2 className={styles.sheetName}>{reservation.name}</h2>
        <p className={styles.sheetPhone}>
          <PhoneIcon />
          <a href={`tel:${reservation.phone}`}>{reservation.phone}</a>
        </p>

        <div className={styles.factRow}>
          <FactIcon icon={<CalIcon />} label="Date" value={fmtLongDate(reservation.date)} />
          <FactIcon icon={<ClockIcon />} label="Time" value={fmt12h(reservation.time)} />
          <FactIcon icon={<PeopleIcon />} label="Guests" value={`${reservation.count} Guests`} />
          {company ? (
            <div className={styles.factRowItem}>
              <span className={styles.factIconWrap}><BuildingIcon /></span>
              <span className={styles.factLabel}>Company</span>
              <button type="button" className={styles.companyLink} onClick={() => void openCompanySummary()}>
                {company.displayName}
              </button>
            </div>
          ) : null}
          <FactIcon icon={<SeatIcon />} label="Seating" value={prettySeating(reservation.seating)} />
        </div>

        <button type="button" className={styles.editBtn} onClick={onEdit}>
          <EditIcon />
          <span>Edit</span>
        </button>

        <div className={styles.actionsRow}>
          <button type="button" className={styles.actionShow} onClick={() => void onSeat()}>
            <ShowIcon />
            <span>Show</span>
          </button>
          <button type="button" className={styles.actionNoShow} onClick={() => void onMarkNoShow()}>
            <NoShowIcon />
            <span>No show</span>
          </button>
          <button type="button" className={styles.actionCancel} onClick={() => void onCancel()}>
            <CancelledIcon />
            <span>Cancelled</span>
          </button>
        </div>
      </div>
    </div>

    {summaryOpen && company && (
      <div className={styles.summaryBackdrop} onClick={() => setSummaryOpen(false)}>
        <div className={styles.summarySheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Company summary">
          <button type="button" className={styles.sheetClose} onClick={() => setSummaryOpen(false)} aria-label="Close">×</button>
          <h3 className={styles.summaryTitle}>{company.displayName}</h3>
          {summaryLoading ? (
            <p className={styles.summaryBody}>Looking up this company…</p>
          ) : summaryError ? (
            <p className={styles.summaryError}>{summaryError}</p>
          ) : companySummary ? (
            <>
              {companySummary.websiteUrl ? (
                <p className={styles.summaryWebsite}>
                  <a href={companySummary.websiteUrl} target="_blank" rel="noopener noreferrer">
                    {companySummary.websiteUrl.replace(/^https:\/\//, "")}
                  </a>
                  {companySummary.tld ? (
                    <span className={styles.summaryTld}> · .{companySummary.tld}</span>
                  ) : null}
                </p>
              ) : null}
              {companySummary.industry ? (
                <p className={styles.summaryIndustry}>{companySummary.industry}</p>
              ) : null}
              <p className={styles.summaryBody}>{companySummary.summary}</p>
              <a
                className={styles.summaryGoogleBtn}
                href={companySummary.googleSearchUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Search on Google
              </a>
            </>
          ) : null}
        </div>
      </div>
    )}
    </>
  );
}

function FactIcon({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className={styles.factRowItem}>
      <span className={styles.factIconWrap}>{icon}</span>
      <span className={styles.factLabel}>{label}</span>
      <span className={styles.factValue}>{value}</span>
    </div>
  );
}

/* ── Edit / Add Full-screen Sheet ── */

const STATUS_OPTIONS: { value: Exclude<ReservationStatus, "pending" | "confirmed" | "unconfirmed" | "updated">; label: string }[] = [
  { value: "seated", label: "Seated" },
  { value: "no-show", label: "No Show" },
  { value: "cancelled", label: "Cancelled" },
];

function BackArrowIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>;
}

function AddReservationModal({
  dateISO, editing, branch, onClose, onSaved,
}: {
  dateISO: string;
  editing: Reservation | null;
  branch: ReservationBranch;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { user } = useAuth();
  const [name, setName] = useState(editing?.name ?? "");
  const [company, setCompany] = useState(editing?.company ?? "");
  const [phone, setPhone] = useState(editing?.phone ?? "");
  const [email] = useState(editing?.email ?? "");
  const [date, setDate] = useState(editing?.date ?? dateISO);
  const [time, setTime] = useState(editing?.time ?? "12:00");
  const [guests, setGuests] = useState<number>(editing?.count ?? 2);
  const [seating, setSeating] = useState<ReservationSeating>(editing?.seating === "bar" ? "indoor" : (editing?.seating ?? "indoor"));
  const [status, setStatus] = useState<Exclude<ReservationStatus, "pending">>(
    (editing?.status as Exclude<ReservationStatus, "pending"> | undefined) ?? "confirmed",
  );
  const [notes, setNotes] = useState(editing?.specialRequest ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!user) return;
    if (!name.trim() || !phone.trim() || !time || !date) {
      setError("Name, mobile, date and time are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const basePayload = {
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        ...(company.trim() ? { company: company.trim() } : {}),
        date,
        time,
        count: guests,
        branch,
        seating,
        ...(notes.trim() ? { specialRequest: notes.trim() } : {}),
      };
      if (editing) {
        await updateReservation(user, editing.id, basePayload);
        // Status is a separate endpoint on the booking API.
        if (status !== editing.status) {
          await setReservationStatus(user, editing.id, status);
        }
      } else {
        const created = await createReservation(user, basePayload);
        if (status !== "confirmed" && created.id) {
          await setReservationStatus(user, created.id, status);
        }
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.fullSheet} role="dialog" aria-label={editing ? "Edit reservation" : "New reservation"}>
      <div className={styles.fullSheetHeader}>
        <button type="button" className={styles.fullSheetBack} onClick={onClose} aria-label="Back">
          <BackArrowIcon />
          <span>Back</span>
        </button>
        <span className={styles.fullSheetTitle}>{editing ? "Edit Reservation" : "New Reservation"}</span>
        <span className={styles.fullSheetBackSpacer} aria-hidden="true" />
      </div>

      <div className={styles.fullSheetBody}>
        <FieldBlock label="CUSTOMER NAME">
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </FieldBlock>

        <FieldBlock label="COMPANY (OPTIONAL)">
          <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company name" />
        </FieldBlock>

        <FieldBlock label="MOBILE NUMBER">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </FieldBlock>

        <div className={styles.dateTimeRow}>
          <FieldBlock label="DATE">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </FieldBlock>
          <FieldBlock label="TIME">
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </FieldBlock>
        </div>

        <FieldBlock label="GUESTS">
          <div className={styles.guestsRow}>
            <button type="button" className={styles.guestsBtn} onClick={() => setGuests((g) => Math.max(1, g - 1))} aria-label="Decrease">−</button>
            <span className={styles.guestsValue}>{guests}</span>
            <button type="button" className={styles.guestsBtn} onClick={() => setGuests((g) => g + 1)} aria-label="Increase">+</button>
          </div>
        </FieldBlock>

        <FieldBlock label="SEATING">
          <div className={styles.radioGrid2}>
            {(["indoor", "outdoor"] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={`${styles.radioCard} ${seating === s ? styles.radioCardActive : ""}`}
                onClick={() => setSeating(s)}
              >
                <span className={`${styles.radioDot} ${seating === s ? styles.radioDotActive : ""}`} aria-hidden="true" />
                <span>{prettySeating(s)}</span>
              </button>
            ))}
          </div>
        </FieldBlock>

        {editing ? (
          <FieldBlock label="STATUS">
            <div className={styles.radioGrid3}>
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`${styles.radioCard} ${status === opt.value ? styles.radioCardActive : ""}`}
                  onClick={() => setStatus(opt.value)}
                >
                  <span className={`${styles.radioDot} ${status === opt.value ? styles.radioDotActive : ""}`} aria-hidden="true" />
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </FieldBlock>
        ) : null}

        <FieldBlock label="NOTES">
          <textarea
            rows={3}
            placeholder="Add notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </FieldBlock>

        {error ? <p className={styles.error}>{error}</p> : null}

        <button type="button" className={styles.fullSheetSave} onClick={submit} disabled={submitting}>
          {submitting ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function FieldBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.fieldBlock}>
      <p className={styles.fieldBlockLabel}>{label}</p>
      <div className={styles.fieldBlockInput}>{children}</div>
    </div>
  );
}

/* ── Block Availability Sheet ── */

/**
 * Shown to guests on book.yurica.com.au next to a slot they can't take. The
 * booking site already renders blocked slots as full, so the wording matches
 * what they'd read there rather than anything internal.
 */
const BLOCK_REASON = "Fully Booked";

/**
 * The three ways staff describe a closure, mapped onto the upstream shape:
 *
 *   service → whole lunch or dinner, every area   (timeslot lunch|dinner, seating all)
 *   time    → an arbitrary window, chosen areas   (timeslot custom + start/end)
 *   area    → a whole service, but only one area  (timeslot lunch|dinner + seating)
 *
 * Keeping them distinct is what lets one sheet cover "we're closed tonight",
 * "no bookings 12–1" and "the garden is out of action" without three sheets.
 */
const BLOCK_SCOPES = ["service", "time", "area"] as const;
type BlockScope = (typeof BLOCK_SCOPES)[number];

const SCOPE_LABELS: Record<BlockScope, string> = {
  service: "Entire Service",
  time: "Time Range",
  area: "Area",
};

function ChevronDownIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>;
}

function BlockAvailabilityModal({
  dateISO, branch, service: initialService, onClose, onChanged,
}: {
  dateISO: string;
  branch: ReservationBranch;
  service: ReservationService;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const { user } = useAuth();
  const [date, setDate] = useState(dateISO);
  const [service, setService] = useState<ReservationService>(initialService);
  const [scope, setScope] = useState<BlockScope>("service");
  const [seating, setSeating] = useState<BlockSeating>("all");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upcoming, setUpcoming] = useState<BlockedDate[]>([]);
  const [lifting, setLifting] = useState<string | null>(null);

  // Only the services the venue actually trades that day — North Sydney sells
  // no Saturday lunch, and a block against a service nobody could book is
  // just a row that does nothing.
  const services = useMemo(() => openServices(date, branch), [date, branch]);
  useEffect(() => {
    if (services.length > 0 && !services.includes(service)) setService(services[0]);
  }, [services, service]);

  // Both dropdowns only ever offer marks inside the chosen service on the
  // chosen day, so a window that couldn't be booked can't be created.
  const timeOptions = useMemo(() => serviceTimeOptions(service, date, branch), [service, date, branch]);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  // A time only means something within one service on one day, so changing
  // either invalidates the pair. Upstream would happily store the stale one
  // as a window falling outside trading hours, which blocks nothing at all.
  useEffect(() => {
    setStartTime(timeOptions[0] ?? "");
    // Default to a one-hour window — the common case is closing a single hour.
    setEndTime(timeOptions[Math.min(4, timeOptions.length - 1)] ?? "");
  }, [timeOptions]);

  /**
   * Every block from today onwards, not just the day on screen. A block set
   * for next Friday is otherwise unreachable unless staff happen to navigate
   * to that date, so this is the one place they can all be lifted.
   */
  const loadUpcoming = useCallback(async () => {
    if (!user) return;
    try {
      setUpcoming(await fetchUpcomingBlockedDates(user, todayISO(), branch));
    } catch {
      setUpcoming([]);
    }
  }, [user, branch]);

  useEffect(() => { loadUpcoming(); }, [loadUpcoming]);

  const dateRef = useRef<HTMLInputElement | null>(null);
  function pickDate() {
    const el = dateRef.current;
    if (!el) return;
    try {
      (el as unknown as { showPicker?: () => void }).showPicker?.();
    } catch { /* ignore — older browsers fall through to focus() */ }
    el.focus();
  }

  async function submit() {
    if (!user) return;
    if (scope === "time" && startTime >= endTime) {
      setError("The end time has to be after the start time.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const input: BlockedDateCreateInput = {
        date,
        reason: BLOCK_REASON,
        branch,
        timeslot: scope === "time" ? "custom" : (service === "LUNCH" ? "lunch" : "dinner"),
        // Closing a whole service closes every area with it; the other two
        // scopes take whatever the area chips say.
        seating: scope === "service" ? "all" : seating,
        ...(scope === "time" ? { startTime, endTime } : {}),
      };
      await createBlockedDate(user, input);
      // Stays open on purpose: the new block lands in the list below, which
      // both confirms it took and puts the undo one tap away.
      await Promise.all([onChanged(), loadUpcoming()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not block that slot.");
    } finally {
      setSubmitting(false);
    }
  }

  /** Lift a block — the slot goes back on sale on the customer site. */
  async function lift(id: string) {
    if (!user) return;
    setLifting(id);
    setError(null);
    try {
      await deleteBlockedDate(user, id);
      await Promise.all([onChanged(), loadUpcoming()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not lift that block.");
    } finally {
      setLifting(null);
    }
  }

  return (
    <div className={styles.sheetBackdrop} role="dialog" aria-label="Block availability" onClick={onClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <span className={styles.sheetGrabber} aria-hidden="true" />
        <p className={styles.sheetTitle}>Block Availability</p>
        <p className={styles.sheetSubtitle}>2-second quick block</p>

        <div className={styles.blockField}>
          <span className={styles.blockFieldLabel}>Date</span>
          <button type="button" className={styles.blockSelect} onClick={pickDate}>
            <span>{fmtHeaderDate(date)}</span>
            <ChevronDownIcon />
          </button>
          <input
            ref={dateRef}
            type="date"
            className={styles.hiddenDateInput}
            value={date}
            onChange={(e) => { if (e.target.value) setDate(e.target.value); }}
            tabIndex={-1}
            aria-hidden="true"
          />
        </div>

        <div className={styles.serviceToggle}>
          {services.map((svc) => (
            <button
              key={svc}
              type="button"
              className={`${styles.serviceToggleBtn} ${service === svc ? styles.serviceToggleBtnActive : ""}`}
              onClick={() => setService(svc)}
            >
              {svc === "LUNCH" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
              <span>{svc === "LUNCH" ? "Lunch" : "Dinner"}</span>
            </button>
          ))}
        </div>

        <div className={styles.scopeGrid}>
          {BLOCK_SCOPES.map((s) => (
            <button
              key={s}
              type="button"
              className={`${styles.scopeBtn} ${scope === s ? styles.scopeBtnActive : ""}`}
              onClick={() => setScope(s)}
            >
              {s === "service" ? <ServiceScopeIcon /> : s === "time" ? <ClockIcon /> : <AreaScopeIcon />}
              <span>{SCOPE_LABELS[s]}</span>
            </button>
          ))}
        </div>

        {scope === "time" && (
          <div className={styles.blockTimeRow}>
            <div className={styles.blockField}>
              <span className={styles.blockFieldLabel}>From</span>
              <div className={styles.blockSelect}>
                <select value={startTime} onChange={(e) => setStartTime(e.target.value)}>
                  {timeOptions.map((t) => <option key={t} value={t}>{fmt12h(t)}</option>)}
                </select>
                <ChevronDownIcon />
              </div>
            </div>
            <div className={styles.blockField}>
              <span className={styles.blockFieldLabel}>To</span>
              <div className={styles.blockSelect}>
                <select value={endTime} onChange={(e) => setEndTime(e.target.value)}>
                  {timeOptions.map((t) => <option key={t} value={t}>{fmt12h(t)}</option>)}
                </select>
                <ChevronDownIcon />
              </div>
            </div>
          </div>
        )}

        {scope !== "service" && (
          <div className={styles.areaChips}>
            {(Object.keys(AREA_LABELS) as BlockSeating[]).map((s) => (
              <button
                key={s}
                type="button"
                className={`${styles.areaChip} ${seating === s ? styles.areaChipActive : ""}`}
                onClick={() => setSeating(s)}
              >
                {AREA_LABELS[s]}
              </button>
            ))}
          </div>
        )}

        {error ? <p className={styles.error}>{error}</p> : null}

        <button type="button" className={styles.blockCta} onClick={submit} disabled={submitting}>
          {submitting ? "Blocking…" : "Block Availability →"}
        </button>
        <p className={styles.blockNote}>Blocked times appear as FULL on the booking side.</p>

        <section className={styles.manageSection}>
          <p className={styles.blockHeading}>Currently blocked</p>
          {upcoming.length === 0 ? (
            <p className={styles.manageEmpty}>Nothing is blocked from today onwards.</p>
          ) : (
            <ul className={styles.manageList}>
              {upcoming.map((b) => (
                <li key={b.id} className={styles.manageRow}>
                  <span className={styles.manageIcon}><BlockIcon size={16} /></span>
                  <span className={styles.manageBody}>
                    <span className={styles.manageDate}>
                      {fmtHeaderDate(b.date)} {b.date.slice(0, 4)}
                    </span>
                    <span className={styles.manageDesc}>{describeBlock(b)}</span>
                  </span>
                  <button
                    type="button"
                    className={styles.manageLift}
                    onClick={() => lift(b.id)}
                    disabled={lifting === b.id}
                  >
                    {lifting === b.id ? "Lifting…" : "Unblock"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

