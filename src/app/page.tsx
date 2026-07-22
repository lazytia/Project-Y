import { readServerSession } from "@/lib/dashboard-session";
import { isManagerDashboardKind } from "@/lib/session-dashboard";
import ServerDashboardPreparing from "@/components/ServerDashboardPreparing";
import DashboardPageClient from "./DashboardPageClient";

/** Never await Firestore here — instant HTML like system-yurica. */
export default async function HomePage() {
  const session = await readServerSession();
  const showPreparing =
    session.authenticated &&
    (session.dashboard === "owner" || isManagerDashboardKind(session.dashboard));

  return (
    <>
      {showPreparing && <ServerDashboardPreparing />}
      <DashboardPageClient
        sessionRole={session.role}
        sessionDashboard={session.dashboard}
      />
    </>
  );
}
