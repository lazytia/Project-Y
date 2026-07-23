import { readServerSession } from "@/lib/dashboard-session";
import { isManagerDashboardKind } from "@/lib/session-dashboard";
import DashboardPageClient from "./DashboardPageClient";

/** Never await Firestore here — instant HTML like system-yurica. */
export default async function HomePage() {
  const session = await readServerSession();

  return (
    <DashboardPageClient
      sessionRole={session.role}
      sessionDashboard={session.dashboard}
    />
  );
}
