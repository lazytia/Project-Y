import { readServerSession } from "@/lib/dashboard-session";
import { isManagerDashboardKind } from "@/lib/session-dashboard";
import ServerManagerDashPreview from "@/components/ServerManagerDashPreview";
import DashboardPageClient from "./DashboardPageClient";

/** Never await Firestore here — instant HTML like system-yurica. */
export default async function HomePage() {
  const session = await readServerSession();

  return (
    <>
      {isManagerDashboardKind(session.dashboard) && (
        <ServerManagerDashPreview
          sessionDashboard={session.dashboard}
          roleLabel={session.dashboard === "chef" ? "Head Chef" : "Store Manager"}
          displayName={session.dashboard === "chef" ? "Chuck" : undefined}
        />
      )}
      <DashboardPageClient
        sessionRole={session.role}
        sessionDashboard={session.dashboard}
      />
    </>
  );
}
