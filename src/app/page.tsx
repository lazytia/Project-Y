import { readServerSession } from "@/lib/dashboard-session";
import { prefetchManagerDash } from "@/lib/manager-dash-server";
import { isManagerDashboardKind } from "@/lib/session-dashboard";
import DashboardPageClient from "./DashboardPageClient";

/** Never await Firestore here — instant HTML like system-yurica. */
export default async function HomePage() {
  const session = await readServerSession();

  let initialManagerCache = null;
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
  }

  return (
    <DashboardPageClient
      sessionDashboard={session.dashboard}
      initialManagerCache={initialManagerCache}
    />
  );
}
