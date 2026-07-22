import { readServerSession } from "@/lib/dashboard-session";
import ServerDashboardPreparing from "@/components/ServerDashboardPreparing";
import DashboardPageClient from "./DashboardPageClient";

/** Never await Firestore here — instant HTML like system-yurica. */
export default async function HomePage() {
  const session = await readServerSession();

  return (
    <>
      {session.authenticated && session.role === "owner" && (
        <ServerDashboardPreparing />
      )}
      <DashboardPageClient sessionRole={session.role} />
    </>
  );
}
