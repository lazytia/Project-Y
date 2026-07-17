"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { isChef, isOwner, isStrictOwner } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import Splash from "@/components/Splash";
import OwnerRequestDetail from "./OwnerRequestDetail";
import ManagerEditForm from "./ManagerEditForm";

/** Strict owners approve; managers and chefs edit the request. */
export default function OnboardingDetailPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const strictOwner = isStrictOwner(user);
  const canEditRequest = (isOwner(user) && !strictOwner) || isChef(user);

  useEffect(() => {
    if (loading) return;
    if (!strictOwner && !canEditRequest) {
      router.replace(ROUTES.home);
    }
  }, [loading, strictOwner, canEditRequest, router]);

  if (loading) return <Splash />;
  if (strictOwner) return <OwnerRequestDetail />;
  if (canEditRequest) return <ManagerEditForm />;
  return null;
}
