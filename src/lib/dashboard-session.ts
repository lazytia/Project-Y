import { cache } from "react";
import { cookies } from "next/headers";
import type { DashboardKind } from "@/lib/session-dashboard";

export type ServerSession = {
  authenticated: boolean;
  uid: string | null;
  role: string | null;
  dashboard: DashboardKind | null;
};

function dashboardFromCookies(
  dashRaw: string | null,
  role: string | null,
): DashboardKind | null {
  if (dashRaw === "owner" || dashRaw === "manager" || dashRaw === "chef" || dashRaw === "staff") {
    return dashRaw;
  }
  if (role === "chef") return "chef";
  if (role === "owner") return "owner";
  if (role === "staff") return "staff";
  return null;
}

/** Fast cookie read for SSR shell paint — no Firebase round-trip. */
export const readServerSession = cache(async (): Promise<ServerSession> => {
  const cookieStore = await cookies();
  const uid = cookieStore.get("uid")?.value?.trim() || null;
  const role = cookieStore.get("role")?.value?.trim() || null;
  const dashRaw = cookieStore.get("dash")?.value?.trim() || null;
  const dashboard = dashboardFromCookies(dashRaw, role);
  return {
    authenticated: !!uid,
    uid,
    role,
    dashboard,
  };
});
