"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  type Reservation,
  type ReservationBranch,
  type ReservationSeating,
  type ReservationStatus,
  createReservation,
  fetchReservationsForDate,
  serviceFor,
  setReservationStatus,
  todayISO,
  tsToDate,
  updateReservation,
} from "@/lib/reservations";
import styles from "./page.module.css";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtHeaderDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${WEEKDAYS[dt.getDay()]} ${d} ${MONTH_SHORT[m - 1]}`;
}
function fmtLongDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH_SHORT[m - 1]} ${y}`;
}
function fmt12h(time: string): string {
  const [h, m] = time.split(":").map(Number);
  if (Number.isNaN(h)) return time;
  const meridian = h < 12 ? "AM" : "PM";
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${display}:${String(m ?? 0).padStart(2, "0")} ${meridian}`;
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
function AlertIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12" y2="17" /></svg>;
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
function EditIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>;
}
function NoShowIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="17" y1="8" x2="22" y2="13" /><line x1="22" y1="8" x2="17" y2="13" /></svg>;
}
function TrashIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>;
}
function PlusIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
}

/* ── Page ── */

export default function ReservationsPage() {
  const { user } = useAuth();
  const [dateISO, setDateISO] = useState<string>(todayISO());
  const [branch] = useState<ReservationBranch>("northsydney");
  const [list, setList] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState<Reservation | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Reservation | null>(null);
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
  // Activity entries the user has dismissed via the Clear button. Stored
  // in localStorage so the Clear state is per-device and survives page
  // reloads — clearing on one phone never affects what another phone
  // sees, since each device keeps its own dismissed list.
  const [clearedActivity, setClearedActivity] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = localStorage.getItem("reservations-cleared-activity");
      if (!raw) return new Set();
      return new Set(JSON.parse(raw) as string[]);
    } catch { return new Set(); }
  });
  function clearActivity(key: string) {
    setClearedActivity((prev) => {
      const next = new Set(prev);
      next.add(key);
      try {
        localStorage.setItem("reservations-cleared-activity", JSON.stringify([...next]));
      } catch { /* ignore */ }
      return next;
    });
  }

  async function reload() {
    if (!user) return;
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

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateISO, user]);

  const active = useMemo(() => list.filter((r) => r.status !== "cancelled" && r.status !== "no-show"), [list]);

  // Recent activity to surface in the alert strip: cancellations first, then
  // brand-new bookings, then customer-updated edits. Each row carries a tag
  // so the UI can colour them differently.
  const activity = useMemo(() => {
    type Item = { reservation: Reservation; kind: "cancelled" | "new" | "updated"; at: number };
    const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000; // surface anything from the last 24h
    const now = Date.now();
    const out: Item[] = [];
    for (const r of list) {
      if (r.status === "cancelled") {
        const t = tsToDate(r.customerUpdatedAt ?? r.createdAt ?? null);
        out.push({ reservation: r, kind: "cancelled", at: t?.getTime() ?? 0 });
        continue;
      }
      const createdMs = tsToDate(r.createdAt ?? null)?.getTime();
      if (typeof createdMs === "number" && now - createdMs <= RECENT_WINDOW_MS) {
        out.push({ reservation: r, kind: "new", at: createdMs });
        continue;
      }
      const updatedMs = tsToDate(r.customerUpdatedAt ?? null)?.getTime();
      if (r.customerUpdated && typeof updatedMs === "number" && now - updatedMs <= RECENT_WINDOW_MS) {
        out.push({ reservation: r, kind: "updated", at: updatedMs });
      }
    }
    return out
      .filter((item) => !clearedActivity.has(`${item.kind}-${item.reservation.id}`))
      .sort((a, b) => b.at - a.at)
      .slice(0, 4);
  }, [list, clearedActivity]);

  const totals = useMemo(() => {
    const indoor = active.filter((r) => r.seating === "indoor").reduce((s, r) => s + r.count, 0);
    const outdoor = active.filter((r) => r.seating !== "indoor").reduce((s, r) => s + r.count, 0);
    return { bookings: active.length, indoor, outdoor, total: indoor + outdoor };
  }, [active]);

  const filteredActive = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return active;
    const digits = q.replace(/\D/g, "");
    return active.filter((r) => {
      if (digits && r.phone.replace(/\D/g, "").includes(digits)) return true;
      return r.name.toLowerCase().includes(q);
    });
  }, [active, query]);

  const sections = useMemo(() => {
    const groups: Record<"LUNCH" | "DINNER", Reservation[]> = { LUNCH: [], DINNER: [] };
    for (const r of filteredActive) groups[serviceFor(r.time)].push(r);
    // Always show both sections; pages should scroll naturally between them.
    return [
      { key: "LUNCH" as const, label: "LUNCH", window: "11:30 – 14:00", rows: groups.LUNCH },
      { key: "DINNER" as const, label: "DINNER", window: "17:00 – 21:00", rows: groups.DINNER },
    ];
  }, [filteredActive]);

  async function applyStatus(id: string, status: "confirmed" | "no-show" | "cancelled") {
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

      <div className={styles.hero}>
        <p className={styles.heroNumber}>{totals.total}</p>
        <p className={styles.heroLabel}>TODAY&apos;S GUESTS</p>
      </div>

      <div className={styles.statsRow}>
        <Stat value={String(totals.bookings)} label="BOOKINGS" />
        <Stat value={String(totals.indoor)} label="INDOOR" hint="Guests" />
        <Stat value={String(totals.outdoor)} label="OUTDOOR" hint="Guests" />
      </div>

      {activity.length > 0 && (
        <ul className={styles.activityList}>
          {activity.map(({ reservation, kind }) => (
            <li
              key={`${kind}-${reservation.id}`}
              className={`${styles.activityRow} ${
                kind === "cancelled" ? styles.activityCancelled
                  : kind === "new" ? styles.activityNew
                    : styles.activityUpdated
              }`}
            >
              <span className={styles.activityIcon}><AlertIcon /></span>
              <div className={styles.activityBody}>
                <p className={styles.activityTitle}>
                  {kind === "cancelled" ? "Cancelled Reservation"
                    : kind === "new" ? "New Reservation"
                      : "Updated Reservation"}
                </p>
                <p className={styles.activityMeta}>
                  {reservation.name} · {fmtLongDate(reservation.date).replace(/, \d{4}$/, "")} · {fmt12h(reservation.time)}
                </p>
              </div>
              <button type="button" className={styles.activityView} onClick={() => setFocused(reservation)}>View</button>
              <button
                type="button"
                className={styles.activityClear}
                onClick={() => clearActivity(`${kind}-${reservation.id}`)}
                aria-label="Dismiss"
              >
                Clear
              </button>
            </li>
          ))}
        </ul>
      )}

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
        sections.map((sec) => {
          const guests = sec.rows.reduce((s, r) => s + r.count, 0);
          return (
            <section key={sec.key} className={styles.section}>
              <div className={styles.sectionHead}>
                <span className={styles.sectionLabel}>{sec.label}</span>
                <span className={styles.sectionWindow}>{sec.window}</span>
                <span className={styles.sectionStats}>{guests} Guests · {sec.rows.length} Bookings</span>
              </div>
              {sec.rows.length === 0 ? (
                <p className={styles.sectionEmpty}>No reservations.</p>
              ) : (
                <ul className={styles.cardList}>
                  {sec.rows.map((r) => (
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
                              return <span className={`${styles.statusPill} ${styles.statusPillCancelled}`}>Cancelled</span>;
                            case "updated":
                              return <span className={`${styles.statusPill} ${styles.statusPillUpdated}`}>Updated</span>;
                            default:
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
          );
        })
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
          onMarkNoShow={() => applyStatus(focused.id, "no-show")}
          onCancel={() => applyStatus(focused.id, "cancelled")}
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

/* ── Stat tile ── */

function Stat({ value, label, hint }: { value: string; label: string; hint?: string }) {
  return (
    <div className={styles.statTile}>
      <p className={styles.statValue}>{value}</p>
      <p className={styles.statLabel}>{label}</p>
      {hint ? <p className={styles.statHint}>{hint}</p> : null}
    </div>
  );
}

/* ── Detail Modal ── */

function DetailModal({
  reservation, onClose, onEdit, onMarkNoShow, onCancel,
}: {
  reservation: Reservation;
  onClose: () => void;
  onEdit: () => void;
  onMarkNoShow: () => void | Promise<void>;
  onCancel: () => void | Promise<void>;
}) {
  return (
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
          <FactIcon icon={<SeatIcon />} label="Seating" value={prettySeating(reservation.seating)} />
        </div>

        <button type="button" className={styles.editBtn} onClick={onEdit}>
          <EditIcon />
          <span>Edit</span>
        </button>

        <div className={styles.actionsRow}>
          <button type="button" className={styles.actionNoShow} onClick={() => void onMarkNoShow()}>
            <NoShowIcon />
            <span>No show</span>
          </button>
          <button type="button" className={styles.actionCancel} onClick={() => void onCancel()}>
            <TrashIcon />
            <span>Cancel</span>
          </button>
        </div>

        <button type="button" className={styles.sheetCloseText} onClick={onClose}>Close</button>
      </div>
    </div>
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
        <div className={styles.fullSheetTopRow}>
          <button type="button" className={styles.fullSheetBackInline} onClick={onClose} aria-label="Back">
            <BackArrowIcon />
            <span>Back</span>
          </button>
          <span className={styles.fullSheetTitleInline}>{editing ? "Edit Reservation" : "New Reservation"}</span>
          <span className={styles.fullSheetBackSpacer} aria-hidden="true" />
        </div>

        <FieldBlock label="CUSTOMER NAME">
          <input value={name} onChange={(e) => setName(e.target.value)} />
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

