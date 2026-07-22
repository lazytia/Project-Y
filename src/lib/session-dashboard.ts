import { emailToUsername } from "@/lib/username";
import {
  CHEF_USERNAMES,
  OWNER_USERNAMES,
  STRICT_OWNER_USERNAMES,
} from "@/lib/permissions";

export type DashboardKind = "owner" | "manager" | "chef" | "staff";

export function dashboardKindFromEmail(
  email: string | null | undefined,
): DashboardKind {
  if (!email) return "staff";
  const username = emailToUsername(email).toLowerCase();
  if (CHEF_USERNAMES.has(username)) return "chef";
  if (STRICT_OWNER_USERNAMES.has(username)) return "owner";
  if (OWNER_USERNAMES.has(username)) return "manager";
  return "staff";
}

export function isManagerDashboardKind(
  kind: string | null | undefined,
): kind is "manager" | "chef" {
  return kind === "manager" || kind === "chef";
}
