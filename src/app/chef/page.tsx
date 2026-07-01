"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { isChef } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import Splash from "@/components/Splash";
import ManagerDashboard from "@/components/ManagerDashboard";

export default function ChefDashboardPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const allowed = isChef(user);

  useEffect(() => {
    if (loading) return;
    if (!allowed) router.replace(ROUTES.staffHome);
  }, [loading, allowed, router]);

  if (loading) return <Splash />;
  if (!allowed) return null;

  return (
    <ManagerDashboard
      roleLabel="Head Chef"
      displayName="Chuck"
      hideAttention
    />
  );
}
