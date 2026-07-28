import type { User } from "firebase/auth";
import type { DashboardKind } from "@/lib/session-dashboard";
import { dashboardKindFromEmail } from "@/lib/session-dashboard";
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

/**
 * Firebase user → localStorage hint (login handoff) → server cookie.
 * Server props can lag behind session POST on iOS PWA client navigations,
 * so the client hint must win until auth hydrates.
 */
export function resolveDashboardKind(
  sessionDashboard: DashboardKind | null | undefined,
  user: User | null | undefined,
): DashboardKind | null {
  if (user) return dashboardKindFromEmail(user.email);
  const hinted = dashFromHint(readClientDashboardHint());
  if (hinted) return hinted;
  if (sessionDashboard) return sessionDashboard;
  return null;
}
