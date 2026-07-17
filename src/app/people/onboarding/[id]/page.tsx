"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import {
  canViewStaffRequest,
  isChef,
  isOwner,
  isStrictOwner,
} from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import Splash from "@/components/Splash";
import OwnerRequestDetail from "./OwnerRequestDetail";
import ManagerEditForm from "./ManagerEditForm";

/** Strict owners approve; managers and chefs edit the request. */
export default function OnboardingDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : (params.id?.[0] ?? "");
  const { user, loading } = useAuth();
  const strictOwner = isStrictOwner(user);
  const canEditRequest = (isOwner(user) && !strictOwner) || isChef(user);
  const [access, setAccess] = useState<"loading" | "allowed" | "denied">("loading");

  useEffect(() => {
    if (loading) return;
    if (!strictOwner && !canEditRequest) {
      router.replace(ROUTES.home);
      return;
    }
    if (!id || !user) return;

    if (strictOwner) {
      setAccess("allowed");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(getDb(), "staff_onboarding", id));
        if (cancelled) return;
        if (!snap.exists()) {
          setAccess("denied");
          return;
        }
        const data = snap.data();
        setAccess(
          canViewStaffRequest(user, {
            requestedByRole: data.requestedByRole as string | undefined,
            requestedByName: data.requestedByName as string | undefined,
          })
            ? "allowed"
            : "denied",
        );
      } catch {
        if (!cancelled) setAccess("denied");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, strictOwner, canEditRequest, id, user, router]);

  useEffect(() => {
    if (access === "denied") router.replace("/people/onboarding");
  }, [access, router]);

  if (loading || access === "loading") return <Splash />;
  if (access === "denied") return null;
  if (strictOwner) return <OwnerRequestDetail />;
  if (canEditRequest) return <ManagerEditForm />;
  return null;
}
