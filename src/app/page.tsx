import { readServerSession } from "@/lib/dashboard-session";
import { prefetchOwnerDash } from "@/lib/owner-dash-server";
import { sydneyTodayKey } from "@/lib/sydney-date";
import ServerDashboardPreparing from "@/components/ServerDashboardPreparing";
import DashboardPageClient from "./DashboardPageClient";

export default async function HomePage() {
  const session = await readServerSession();
  const todayKey = sydneyTodayKey();

  let initialOwnerDash = null;
  if (session.authenticated && session.role === "owner") {
    try {
      initialOwnerDash = await prefetchOwnerDash(todayKey);
    } catch {
      /* client will fetch after auth */
    }
  }

  return (
    <>
      {session.authenticated && session.role === "owner" && !initialOwnerDash && (
        <ServerDashboardPreparing />
      )}
      <DashboardPageClient
        sessionRole={session.role}
        initialOwnerDash={initialOwnerDash}
      />
    </>
  );
}
