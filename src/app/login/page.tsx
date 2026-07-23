import { readServerSession } from "@/lib/dashboard-session";
import LoginClient from "./LoginClient";

export default async function LoginPage() {
  const session = await readServerSession();
  return <LoginClient initialHasSession={session.authenticated} />;
}
