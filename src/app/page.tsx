import { readServerSession } from "@/lib/dashboard-session";
import { prefetchManagerDash } from "@/lib/manager-dash-server";
import { prefetchOwnerDash } from "@/lib/owner-dash-server";
import { isManagerDashboardKind } from "@/lib/session-dashboard";
import DashboardPageClient from "./DashboardPageClient";

/** Prefetch dashboard numbers with a short race — never block HTML long. */
export default async function HomePage() {
  const session = await readServerSession();

  let initialManagerCache = null;
  let initialOwnerCache = null;

  if (isManagerDashboardKind(session.dashboard)) {
    try {
      const snap = await Promise.race([
        prefetchManagerDash(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 600)),
      ]);
      initialManagerCache = snap?.cache ?? null;
    } catch {
      /* client fetch still runs */
    }
  } else if (session.dashboard === "owner") {
    try {
      const snap = await Promise.race([
        prefetchOwnerDash(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 600)),
      ]);
      initialOwnerCache = snap?.cache ?? null;
    } catch {
      /* client fetch still runs */
    }
  }

  return (
    <DashboardPageClient
      sessionDashboard={session.dashboard}
      initialManagerCache={initialManagerCache}
      initialOwnerCache={initialOwnerCache}
    />
  );
}
