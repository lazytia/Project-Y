"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { isChef } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

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
    <div className={styles.page}>
      <div className={styles.greeting}>
        <h1 className={styles.title}>Chef Dashboard</h1>
        <p className={styles.subtitle}>Welcome, Chef</p>
      </div>

      <div className={styles.placeholder}>
        <span className={styles.icon} aria-hidden="true">👨‍🍳</span>
        <p className={styles.placeholderText}>
          Chef dashboard is coming soon.
        </p>
      </div>
    </div>
  );
}
