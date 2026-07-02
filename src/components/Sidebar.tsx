"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { emailToUsername } from "@/lib/username";
import { isOwner, isStrictOwner, isChef } from "@/lib/permissions";
import styles from "./Sidebar.module.css";

type NavItem = { label: string; href: string; ownerOnly?: boolean; chefHidden?: boolean };
type NavGroup = {
  icon: string;
  label: string;
  href?: string;
  children?: NavItem[];
  /** Hidden from managers (yurina); shown only to strict owners. */
  ownerOnly?: boolean;
};

// Owner nav (Tia / Yurica). Managers (Yurina) and chefs use MANAGER_NAV
// below — this list is intentionally broader and owner-shaped.
const NAV: NavGroup[] = [
  { icon: "🏠", label: "Dashboard", href: "/" },
  {
    icon: "🍽",
    label: "Operations",
    children: [
      { label: "Reservations", href: "/operations/reservations" },
      { label: "Catering", href: "/operations/catering-orders" },
      { label: "Daily Sold Out", href: "/operations/daily-sold-out" },
      { label: "Roster", href: "/scheduling/roster" },
      { label: "Timesheets", href: "/payroll/timesheets" },
    ],
  },
  {
    icon: "👥",
    label: "People",
    children: [
      { label: "New Employees", href: "/people/onboarding" },
      { label: "Active Employees", href: "/people/active" },
      { label: "Notice Given", href: "/people/notice-given" },
      { label: "Terminated", href: "/people/terminated" },
      { label: "HR Notes", href: "/people/hr-notes" },
      { label: "Cash Payments", href: "/people/cash-payments" },
    ],
  },
  {
    icon: "📦",
    label: "Inventory",
    children: [
      { label: "Stock Levels", href: "/inventory/inventory" },
      { label: "Suppliers", href: "/inventory/suppliers" },
    ],
  },
  {
    icon: "💵",
    label: "Money",
    children: [
      { label: "Sales", href: "/money/sales" },
      { label: "Payroll", href: "/payroll/payroll" },
      { label: "Suppliers", href: "/money/suppliers" },
      { label: "Utilities", href: "/money/utilities" },
      { label: "Maintenance", href: "/money/maintenance" },
    ],
  },
  {
    icon: "⚙️",
    label: "System",
    children: [
      { label: "Settings", href: "/system/settings" },
      { label: "Notifications", href: "/system/notifications" },
    ],
  },
];

type Props = { open: boolean; onClose?: () => void };

export default function Sidebar({ open, onClose }: Props) {
  const pathname = usePathname();
  const { user, signOut, staffNeedsOnboarding } = useAuth();
  const userIsOwner = isOwner(user);
  const userIsStrictOwner = isStrictOwner(user);
  const userIsChef = isChef(user);
  const userIsManager = (userIsOwner && !userIsStrictOwner) || userIsChef;

  // 기본값: 모두 닫힘. 한 번에 하나만 열림.
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const toggleGroup = (label: string) => {
    setOpenGroup((prev) => (prev === label ? null : label));
  };

  // Managers (yurina) get a curated nav — narrower than the owner nav and
  // explicit so the structure isn't accidentally widened later.
  const MANAGER_NAV: NavGroup[] = [
    { icon: "🏠", label: "Dashboard", href: "/" },
    {
      icon: "👥",
      label: "People",
      children: [
        { label: "New Staff Request", href: "/people/onboarding" },
        { label: "Notice Given", href: "/people/notice-given" },
        { label: "HR Notes", href: "/people/hr-notes" },
        { label: "Cash Payments", href: "/people/cash-payments" },
    ],
  },
  {
    icon: "📅",
      label: "Scheduling",
      children: [
        { label: "Roster", href: "/scheduling/roster" },
        { label: "Roster Insights", href: "/scheduling/insights" },
      ],
    },
    {
      icon: "🍽",
      label: "Operations",
      children: [
        { label: "Daily Sold Out", href: "/operations/daily-sold-out", chefHidden: true },
        { label: "Reservations", href: "/operations/reservations" },
        { label: "Catering Orders", href: "/operations/catering-orders" },
      ],
    },
  ];

  // ownerOnly (on groups and on children) hides the entry from managers.
  const ownerNav = NAV.filter((group) => !group.ownerOnly || userIsStrictOwner)
    .map((group) => ({
      ...group,
      children: group.children?.filter((c) => !c.ownerOnly || userIsStrictOwner),
    }))
    .filter(
      (group) => group.href || (group.children && group.children.length > 0),
    );

  const managerNav = userIsChef
    ? MANAGER_NAV.map((group) => ({
        ...group,
        children: group.children?.filter((c) => !c.chefHidden),
      })).filter((group) => group.href || (group.children && group.children.length > 0))
    : MANAGER_NAV;

  const visibleNav: NavGroup[] = userIsManager ? managerNav : ownerNav;

  // Staff who haven't completed onboarding get a stripped sidebar — no nav
  // links, just brand + sign out. AuthProvider keeps them locked to
  // /onboarding/*, so destinations they aren't allowed to reach yet would
  // just look broken.
  if (!userIsOwner && staffNeedsOnboarding) {
    return (
      <aside className={`${styles.sidebar} ${open ? "" : styles.sidebarClosed}`}>
        <div className={styles.brand}>YURICA</div>
        <nav className={styles.nav} aria-hidden="true" />
        <div className={styles.footer}>
          <div className={styles.userEmail}>{emailToUsername(user?.email)}</div>
          <button type="button" onClick={signOut} className={styles.signOut}>
            Sign out
          </button>
        </div>
      </aside>
    );
  }

  // Staff sidebar — Home / Schedule (with children) / Payslips + sign out.
  if (!userIsOwner && !userIsChef) {
    const staffNav: NavGroup[] = [
      { icon: "🏠", label: "Home", href: "/staff" },
      { icon: "📋", label: "Onboarding", href: "/onboarding" },
      {
        icon: "📅",
        label: "Schedule",
        children: [
          { label: "Roster", href: "/staff/schedule/roster" },
          { label: "Request Holiday", href: "/staff/schedule/request-holiday" },
          { label: "Availability Change", href: "/staff/schedule/availability-change" },
        ],
      },
      { icon: "💰", label: "Payslips", href: "/staff/payslips" },
      { icon: "📄", label: "My Documents", href: "/staff/documents" },
    ];
    return (
      <aside className={`${styles.sidebar} ${open ? "" : styles.sidebarClosed}`}>
        <div className={styles.brand}>YURICA</div>
        <nav className={styles.nav}>
          {staffNav.map((group) => {
            const isExpanded = !group.children || openGroup === group.label;
            return (
              <div key={group.label} className={styles.group}>
                {group.href ? (
                  <Link
                    href={group.href}
                    className={`${styles.groupHeader} ${pathname === group.href ? styles.active : ""}`}
                    onClick={onClose}
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
                            onClick={onClose}
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

  return (
    <aside className={`${styles.sidebar} ${open ? "" : styles.sidebarClosed}`}>
      <div className={styles.brand}>YURICA</div>
      <nav className={styles.nav}>
        {visibleNav.map((group) => {
          const isExpanded = !group.children || openGroup === group.label;
          return (
            <div key={group.label} className={styles.group}>
              {group.href ? (
                <Link
                  href={group.href}
                  className={`${styles.groupHeader} ${pathname === group.href ? styles.active : ""}`}
                  onClick={onClose}
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
                          onClick={onClose}
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
