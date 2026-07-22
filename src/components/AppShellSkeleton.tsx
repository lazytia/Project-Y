"use client";

import styles from "./AppShellSkeleton.module.css";

export default function AppShellSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell} data-app-shell="true">
      <div className={styles.mobileHeader} aria-hidden="true">
        <div className={styles.hamburgerPlaceholder} />
        <span className={styles.mobileBrand}>YURICA</span>
        <div className={styles.bellPlaceholder} />
      </div>
      <aside className={styles.sidebarPlaceholder} aria-hidden="true">
        <div className={styles.sidebarBrand} />
        <div className={styles.sidebarItem} />
        <div className={styles.sidebarItem} />
        <div className={styles.sidebarItem} />
        <div className={styles.sidebarItem} />
      </aside>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
