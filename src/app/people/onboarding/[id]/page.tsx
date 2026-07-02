"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { isChef, isOwner, isStrictOwner } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import Splash from "@/components/Splash";
import OwnerRequestDetail from "./OwnerRequestDetail";
import ManagerEditForm from "./ManagerEditForm";

/** Owner sees approval detail; manager (Yurina) keeps the edit form. */
export default function OnboardingDetailPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const strictOwner = isStrictOwner(user);
  const manager = isOwner(user) && !strictOwner;

  useEffect(() => {
    if (loading) return;
    if (!strictOwner && !manager) {
      router.replace(ROUTES.home);
    }
  }, [loading, strictOwner, manager, router]);

  if (loading) return <Splash />;
  if (strictOwner) return <OwnerRequestDetail />;
  if (manager) return <ManagerEditForm />;
  if (isChef(user)) return <Splash />;
  return null;
}
