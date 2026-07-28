import type { User } from "firebase/auth";
import type { DashboardKind } from "@/lib/session-dashboard";
import { dashboardKindFromEmail, isManagerDashboardKind } from "@/lib/session-dashboard";
import { readClientDashboardHint } from "@/lib/client-session-hint";

function dashFromHint(raw: string | null): DashboardKind | null {
  if (
    raw === "owner" ||
    raw === "manager" ||
    raw === "chef" ||
    raw === "staff"
  ) {
    return raw;
  }
  return null;
}

/** Server cookie → localStorage hint → Firebase user email. */
export function resolveDashboardKind(
  sessionDashboard: DashboardKind | null | undefined,
  user: User | null | undefined,
): DashboardKind | null {
  if (sessionDashboard) return sessionDashboard;
  const hinted = dashFromHint(readClientDashboardHint());
  if (hinted) return hinted;
  if (user) return dashboardKindFromEmail(user.email);
  return null;
}

export function isManagerDashKind(
  sessionDashboard: DashboardKind | null | undefined,
  user: User | null | undefined,
): boolean {
  return isManagerDashboardKind(resolveDashboardKind(sessionDashboard, user));
}
