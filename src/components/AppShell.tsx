"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import { useAuth } from "./AuthProvider";
import { PUBLIC_ROUTES } from "@/lib/routes";
import styles from "./AppShell.module.css";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const isPublic = PUBLIC_ROUTES.has(pathname);
  // 모바일: 기본 닫힘 / 데스크탑: CSS에서 항상 강제 표시
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
      <div className={styles.mobileHeader}>
        <button
          className={styles.hamburger}
          onClick={() => setSidebarOpen((o) => !o)}
          aria-label={sidebarOpen ? "Close menu" : "Open menu"}
        >
          <span className={styles.bar} />
          <span className={styles.bar} />
          <span className={styles.bar} />
        </button>
        <span className={styles.mobileBrand}>Project Y</span>
      </div>
      {sidebarOpen && (
        <div
          className={styles.backdrop}
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
