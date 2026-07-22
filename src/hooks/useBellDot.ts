"use client";

import { useEffect, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  type Timestamp,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { isOwner } from "@/lib/permissions";

const VISA_EXPIRING_WINDOW_DAYS = 60;

function tsDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object" && v !== null && "toDate" in (v as object)) {
    try { return (v as Timestamp).toDate(); } catch { return null; }
  }
  return null;
}

export type BellItem = {
  id: string;
  title: string;
  detail?: string;
  ago: string;
  href?: string;
  /** When the item became actionable. Used to gate the red dot vs the seen-at
   *  timestamp on the user's doc. */
  occurredAt: Date | null;
};

function fmtRelative(d: Date | null): string {
  if (!d) return "";
  const diff = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const days = Math.floor(diff / 86400);
  return `${days}d ago`;
}

function fmtRange(a: Date, b: Date): string {
  const sameYear = a.getFullYear() === b.getFullYear();
  const sameMonth = sameYear && a.getMonth() === b.getMonth();
  const right = b.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  if (sameMonth) return `${a.getDate()} – ${right}`;
  return `${a.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
  })} – ${right}`;
}

function fmtShort(d: Date): string {
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function nameOf(d: Record<string, unknown>, uid: string): string {
  const first = typeof d.firstName === "string" ? d.firstName.trim() : "";
  const last = typeof d.lastName === "string" ? d.lastName.trim() : "";
  if (first || last) return `${first} ${last}`.trim();
  const u = typeof d.username === "string" ? d.username : "";
  if (u) return u.charAt(0).toUpperCase() + u.slice(1);
  return uid.slice(0, 6);
}

/**
 * Bell-inbox items + read state for the signed-in user.
 *
 * - Staff: notifications stored on their own staff_onboarding doc.
 * - Manager / Owner: every pending item across the staff_onboarding
 *   collection (pending requests, submitted onboarding, visa expiring
 *   within 60 days).
 *
 * `bellSeenAt` lives on the user's own staff_onboarding doc and is what
 * the red dot is gated by — items with occurredAt > bellSeenAt are "new".
 * Items always render in the modal so the manager can still act on them.
 */
export function useBellInbox(options?: { enabled?: boolean }): {
  items: BellItem[];
  bellSeenAt: Date | null;
  loading: boolean;
  reload: () => void;
} {
  const enabled = options?.enabled ?? true;
  const { user } = useAuth();
  const [items, setItems] = useState<BellItem[]>([]);
  const [bellSeenAt, setBellSeenAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    if (!user) {
      setItems([]);
      setBellSeenAt(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        // Always start by reading the signed-in user's own doc for the
        // last-seen timestamp.
        const meSnap = await getDoc(doc(getDb(), "staff_onboarding", user.uid));
        const meData = meSnap.data() ?? {};
        const seenAt = tsDate(meData.bellSeenAt);
        if (!cancelled) setBellSeenAt(seenAt);

        if (isOwner(user)) {
          const snap = await getDocs(collection(getDb(), "staff_onboarding"));
          const out: BellItem[] = [];
          for (const d of snap.docs) {
            const data = d.data() as Record<string, unknown>;
            if (data.role === "owner") continue;
            const who = nameOf(data, d.id);

            const holiday = (Array.isArray(data.holidayRequests)
              ? data.holidayRequests
              : []) as { id?: string; startDate?: Timestamp; endDate?: Timestamp; status?: string; createdAt?: Timestamp }[];
            for (const r of holiday) {
              if (r?.status !== "pending") continue;
              const s = tsDate(r.startDate);
              const e = tsDate(r.endDate);
              const at = tsDate(r.createdAt);
              out.push({
                id: `h_${d.id}_${r.id ?? ""}`,
                title: `${who} — Holiday Request`,
                detail: s && e ? fmtRange(s, e) : "Dates not set",
                ago: fmtRelative(at),
                href: "/attention-required",
                occurredAt: at,
              });
            }

            const avail = (Array.isArray(data.availabilityRequests)
              ? data.availabilityRequests
              : []) as { id?: string; effectiveDate?: Timestamp; status?: string; createdAt?: Timestamp }[];
            for (const r of avail) {
              if (r?.status !== "pending") continue;
              const eff = tsDate(r.effectiveDate);
              const at = tsDate(r.createdAt);
              out.push({
                id: `a_${d.id}_${r.id ?? ""}`,
                title: `${who} — Availability Change`,
                detail: eff ? `Effective from ${fmtShort(eff)}` : "Effective date not set",
                ago: fmtRelative(at),
                href: "/attention-required",
                occurredAt: at,
              });
            }

            const completed = typeof data.completedStep === "number" ? data.completedStep : 0;
            if (completed >= 7 && data.status === "complete") {
              const at =
                tsDate((data as { completedAt?: Timestamp }).completedAt) ??
                tsDate((data as { updatedAt?: Timestamp }).updatedAt);
              const start = tsDate(data.startDate);
              out.push({
                id: `ob_${d.id}`,
                title: `${who} — Onboarding Submitted`,
                detail: start ? `Start date: ${fmtShort(start)}` : undefined,
                ago: fmtRelative(at),
                href: "/attention-required",
                occurredAt: at,
              });
            }

            const docs = data.documents as { visaExpiry?: Timestamp } | undefined;
            const visaExp = tsDate(docs?.visaExpiry);
            if (visaExp) {
              const days = (visaExp.getTime() - Date.now()) / 86400000;
              if (days <= VISA_EXPIRING_WINDOW_DAYS && days >= -3) {
                // "Occurred" at the moment the visa entered the 60-day window.
                const occurred = new Date(
                  visaExp.getTime() - VISA_EXPIRING_WINDOW_DAYS * 86400000,
                );
                out.push({
                  id: `c_${d.id}`,
                  title: `${who} — Visa Expiring Soon`,
                  detail: `Expires ${fmtShort(visaExp)}`,
                  ago: "",
                  href: "/attention-required",
                  occurredAt: occurred,
                });
              }
            }
          }
          // Newest first.
          out.sort((a, b) => (b.occurredAt?.getTime() ?? 0) - (a.occurredAt?.getTime() ?? 0));
          if (!cancelled) setItems(out);
        } else {
          // Staff inbox = their own notifications array.
          const notifs = (Array.isArray(meData.notifications)
            ? meData.notifications
            : []) as { id?: string; title?: string; detail?: string; createdAt?: Timestamp }[];
          const out: BellItem[] = notifs
            .map((n) => {
              const at = tsDate(n.createdAt);
              return {
                id: String(n.id ?? at?.getTime() ?? Math.random()),
                title: n.title ?? "Notification",
                detail: n.detail ?? "",
                ago: fmtRelative(at),
                href: undefined,
                occurredAt: at,
              };
            })
            .sort((a, b) => (b.occurredAt?.getTime() ?? 0) - (a.occurredAt?.getTime() ?? 0));
          if (!cancelled) setItems(out);
        }
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, tick, enabled]);

  return {
    items,
    bellSeenAt,
    loading,
    reload: () => setTick((t) => t + 1),
  };
}

/** Backwards-compatible boolean accessor for the dot itself. */
export function useBellDot(): boolean {
  const { items, bellSeenAt } = useBellInbox();
  const seen = bellSeenAt?.getTime() ?? 0;
  return items.some((it) => (it.occurredAt?.getTime() ?? 0) > seen);
}
