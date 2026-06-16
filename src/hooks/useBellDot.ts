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

/**
 * Whether the top-bar bell should show its red dot.
 *
 * Different rules per role:
 *
 * - **Staff:** at least one notification arrived after the user last marked
 *   notifications as read (staff_onboarding/{uid}.notificationsReadAt).
 *
 * - **Manager / Owner:** at least one item is waiting on them across the
 *   whole staff_onboarding collection — pending holiday request, pending
 *   availability change, submitted onboarding, or a visa expiring within
 *   60 days. (Read state isn't persisted for the manager dot — items
 *   only disappear once they're actioned.)
 */
export function useBellDot(): boolean {
  const { user } = useAuth();
  const [hasDot, setHasDot] = useState(false);

  useEffect(() => {
    if (!user) {
      setHasDot(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        if (isOwner(user)) {
          const snap = await getDocs(collection(getDb(), "staff_onboarding"));
          let pending = 0;
          for (const d of snap.docs) {
            const data = d.data() as Record<string, unknown>;
            if (data.role === "owner") continue;

            const holiday = Array.isArray(data.holidayRequests)
              ? (data.holidayRequests as { status?: string }[])
              : [];
            if (holiday.some((r) => r?.status === "pending")) pending += 1;

            const avail = Array.isArray(data.availabilityRequests)
              ? (data.availabilityRequests as { status?: string }[])
              : [];
            if (avail.some((r) => r?.status === "pending")) pending += 1;

            const completed = typeof data.completedStep === "number" ? data.completedStep : 0;
            if (completed >= 7 && data.status === "complete") pending += 1;

            const docs = data.documents as { visaExpiry?: Timestamp } | undefined;
            const visaExp = tsDate(docs?.visaExpiry);
            if (visaExp) {
              const days = (visaExp.getTime() - Date.now()) / 86400000;
              if (days <= VISA_EXPIRING_WINDOW_DAYS && days >= -3) pending += 1;
            }

            if (pending > 0) break; // any non-zero is enough for the dot
          }
          if (!cancelled) setHasDot(pending > 0);
        } else {
          // Staff: compare each notification's createdAt against
          // notificationsReadAt on their own doc.
          const snap = await getDoc(doc(getDb(), "staff_onboarding", user.uid));
          const data = snap.data() ?? {};
          const readAt = tsDate(data.notificationsReadAt)?.getTime() ?? 0;
          const notifications = Array.isArray(data.notifications)
            ? (data.notifications as { createdAt?: Timestamp }[])
            : [];
          const hasUnread = notifications.some((n) => {
            const at = tsDate(n.createdAt)?.getTime() ?? 0;
            return at > readAt;
          });
          if (!cancelled) setHasDot(hasUnread);
        }
      } catch {
        if (!cancelled) setHasDot(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  return hasDot;
}
