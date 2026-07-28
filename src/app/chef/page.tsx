import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/routes";

/** Legacy URL — chef dashboard lives at `/`. */
export default function ChefDashboardPage() {
  redirect(ROUTES.home);
}
