import { readServerSession } from "@/lib/dashboard-session";
import ChefDashboardClient from "./ChefDashboardClient";

export default async function ChefDashboardPage() {
  const session = await readServerSession();

  return (
    <ChefDashboardClient sessionDashboard={session.dashboard ?? "chef"} />
  );
}
