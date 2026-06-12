"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { emailToUsername } from "@/lib/username";
import styles from "./Sidebar.module.css";

type NavItem = { label: string; href: string };
type NavGroup = { icon: string; label: string; href?: string; children?: NavItem[] };

const NAV: NavGroup[] = [
  { icon: "🏠", label: "Dashboard", href: "/" },
  {
    icon: "👥",
    label: "People",
    children: [
      { label: "Onboarding", href: "/people/onboarding" },
      { label: "Active Staff", href: "/people/active-staff" },
      { label: "HR Notes", href: "/people/hr-notes" },
    ],
  },
  {
    icon: "📅",
    label: "Scheduling",
    children: [
      { label: "Roster", href: "/scheduling/roster" },
      { label: "Insights", href: "/scheduling/insights" },
    ],
  },
  {
    icon: "🍽",
    label: "Operations",
    children: [
      { label: "Reservations", href: "/operations/reservations" },
      { label: "Catering Orders", href: "/operations/catering-orders" },
      { label: "Online Orders", href: "/operations/online-orders" },
      { label: "ARS", href: "/operations/ars" },
    ],
  },
  {
    icon: "💵",
    label: "Payroll",
    children: [
      { label: "Payroll", href: "/payroll/payroll" },
      { label: "Timesheets", href: "/payroll/timesheets" },
    ],
  },
  {
    icon: "📦",
    label: "Inventory",
    children: [
      { label: "Inventory", href: "/inventory/inventory" },
      { label: "Suppliers", href: "/inventory/suppliers" },
    ],
  },
];

type Props = { open: boolean };

export default function Sidebar({ open }: Props) {
  const pathname = usePathname();
  const { user, signOut } = useAuth();

  // 기본값: 모두 닫힘. 한 번에 하나만 열림.
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const toggleGroup = (label: string) => {
    setOpenGroup((prev) => (prev === label ? null : label));
  };

  return (
    <aside className={`${styles.sidebar} ${open ? "" : styles.sidebarClosed}`}>
      <div className={styles.brand}>Project Y</div>
      <nav className={styles.nav}>
        {NAV.map((group) => {
          const isExpanded = !group.children || openGroup === group.label;
          return (
            <div key={group.label} className={styles.group}>
              {group.href ? (
                <Link
                  href={group.href}
                  className={`${styles.groupHeader} ${pathname === group.href ? styles.active : ""}`}
                >
                  <span className={styles.icon}>{group.icon}</span>
                  <span>{group.label}</span>
                </Link>
              ) : (
                <button
                  type="button"
                  className={styles.groupHeader}
                  onClick={() => toggleGroup(group.label)}
                >
                  <span className={styles.icon}>{group.icon}</span>
                  <span className={styles.groupLabel}>{group.label}</span>
                  <span className={`${styles.chevron} ${isExpanded ? styles.chevronOpen : ""}`}>
                    ›
                  </span>
                </button>
              )}
              {group.children && (
                <div className={`${styles.collapseWrap} ${isExpanded ? styles.collapseOpen : ""}`}>
                  <ul className={styles.children}>
                    {group.children.map((item) => (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className={`${styles.childLink} ${pathname === item.href ? styles.active : ""}`}
                        >
                          {item.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className={styles.footer}>
        <div className={styles.userEmail}>{emailToUsername(user?.email)}</div>
        <button type="button" onClick={signOut} className={styles.signOut}>
          Sign out
        </button>
      </div>
    </aside>
  );
}
