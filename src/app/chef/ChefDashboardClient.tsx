"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { isChef } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import ManagerDashboard from "@/components/ManagerDashboard";
import type { DashboardKind } from "@/lib/session-dashboard";

export default function ChefDashboardClient({
  sessionDashboard = "chef",
}: {
  sessionDashboard?: DashboardKind | null;
}) {
  const router = useRouter();
  const { user, loading } = useAuth();
  const dash = sessionDashboard ?? "chef";

  useEffect(() => {
    if (loading) return;
    if (!isChef(user)) router.replace(ROUTES.staffHome);
  }, [loading, user, router]);

  if (!loading && !isChef(user)) return null;

  return (
    <ManagerDashboard
      hideAttention
      roleLabel="Head Chef"
      displayName="Chuck"
      sessionDashboard={loading ? dash : "chef"}
    />
  );
}
