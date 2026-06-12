"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import { useAuth } from "./AuthProvider";
import { PUBLIC_ROUTES } from "@/lib/routes";
import styles from "./AppShell.module.css";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const isPublic = PUBLIC_ROUTES.has(pathname);

  if (loading) {
    return <div className={styles.loading}>Loading…</div>;
  }

  if (isPublic) {
    return <div className={styles.public}>{children}</div>;
  }

  if (!user) {
    return <div className={styles.loading}>Redirecting…</div>;
  }

  return (
    <div className={styles.shell}>
      <Sidebar />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
