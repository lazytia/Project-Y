import { readServerSession } from "@/lib/dashboard-session";
import ServerDashboardPreparing from "@/components/ServerDashboardPreparing";
import ChefDashboardClient from "./ChefDashboardClient";

export default async function ChefDashboardPage() {
  const session = await readServerSession();

  return (
    <>
      {session.authenticated && <ServerDashboardPreparing />}
      <ChefDashboardClient sessionDashboard={session.dashboard ?? "chef"} />
    </>
  );
}
