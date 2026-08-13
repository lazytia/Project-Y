"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { useLang } from "./LanguageProvider";
import LanguageToggle from "./LanguageToggle";
import { emailToUsername } from "@/lib/username";
import { isOwner, isStrictOwner, isChef } from "@/lib/permissions";
import { readClientDashboardHint } from "@/lib/client-session-hint";
import type { DashboardKind } from "@/lib/session-dashboard";
import {
  prefetchOwnerInventorySummaries,
  prefetchOwnerMoneySummaries,
} from "@/lib/owner-money-prefetch";
import { runWhenIdle } from "@/lib/run-when-idle";
import { CHEF_NAV, MANAGER_NAV, OWNER_NAV, type NavGroup, type NavItem } from "@/lib/sidebar-nav";
import styles from "./Sidebar.module.css";

type Props = {
  open: boolean;
  onClose?: () => void;
  /** Role from the session cookie, so the pre-auth render picks the right tree. */
  initialDashboard?: DashboardKind | null;
};

function isNavChildActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === "/onboarding" && pathname.startsWith("/onboarding")) return true;
  return pathname.startsWith(`${href}/`);
}

function NavChildList({
  items,
  pathname,
  onNavigate,
  nested = false,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
  nested?: boolean;
}) {
  return (
    <ul className={nested ? styles.grandChildren : styles.children}>
      {items.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            className={`${styles.childLink} ${nested ? styles.grandChildLink : ""} ${
              isNavChildActive(pathname, item.href) ? styles.active : ""
            }`}
            onClick={onNavigate}
          >
            {item.label}
          </Link>
          {item.children && (
            <NavChildList
              items={item.children}
              pathname={pathname}
              onNavigate={onNavigate}
              nested
            />
          )}
        </li>
      ))}
    </ul>
  );
}

export default function Sidebar({ open, onClose, initialDashboard = null }: Props) {
  const pathname = usePathname();
  const { user, signOut, staffNeedsOnboarding } = useAuth();
  const { t } = useLang();
  // Firebase Auth hydrates a second or two after paint, and until it does
  // every isOwner/isChef check reads false — which sent owners and chefs
  // through the staff branch below, so the wrong menu rendered and then
  // swapped. The session cookie already knows the role during SSR; the
  // localStorage hint is the fallback when it isn't threaded through.
  const dashHint = user ? null : initialDashboard ?? readClientDashboardHint();
  const userIsOwner = isOwner(user) || dashHint === "owner" || dashHint === "manager";
  const userIsStrictOwner = isStrictOwner(user) || dashHint === "owner";
  const userIsChef = isChef(user) || dashHint === "chef";
  const userIsManager = (userIsOwner && !userIsStrictOwner) || userIsChef;

  // 기본값: 모두 닫힘. 한 번에 하나만 열림.
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const toggleGroup = (label: string) => {
    setOpenGroup((prev) => (prev === label ? null : label));
    if (!userIsStrictOwner) return;
    if (label === "Money") runWhenIdle(() => prefetchOwnerMoneySummaries(), 0);
    else if (label === "Inventory") runWhenIdle(() => prefetchOwnerInventorySummaries(), 0);
  };

  useEffect(() => {
    if (pathname.startsWith("/onboarding") || pathname.startsWith("/staff/handbook") || pathname.startsWith("/staff/beer-guide")) {
      setOpenGroup(t("nav.onboarding"));
    } else if (pathname.startsWith("/staff/schedule")) {
      setOpenGroup(t("nav.schedule"));
    }
  }, [pathname, t]);

  // Managers (yurina) get a curated nav — narrower than the owner nav and
  // explicit so the structure isn't accidentally widened later.
  const ownerNav = OWNER_NAV.filter((group) => !group.ownerOnly || userIsStrictOwner)
    .map((group) => ({
      ...group,
      children: group.children?.filter((c) => !c.ownerOnly || userIsStrictOwner),
    }))
    .filter(
      (group) => group.href || (group.children && group.children.length > 0),
    );

  // Chef gets his own dedicated tree (CHEF_NAV); managers still use
  // the manager tree. Owners use ownerNav computed above.
  const managerNav: NavGroup[] = userIsChef ? CHEF_NAV : MANAGER_NAV;

  const visibleNav: NavGroup[] = userIsManager ? managerNav : ownerNav;

  // Staff who haven't completed onboarding get a stripped sidebar — no nav
  // links, just brand + sign out. AuthProvider keeps them locked to
  // /onboarding/*, so destinations they aren't allowed to reach yet would
  // just look broken.
  if (!userIsOwner && staffNeedsOnboarding) {
    // Mid-onboarding staff can only reach /onboarding/*, so we don't
    // show any nav links — but we DO drop the EN/JA toggle straight
    // into the sidebar. Owner asked for this so the staff can flip
    // languages in place while filling out a form; no navigation, no
    // Settings detour, just the current page's copy switches.
    return (
      <aside className={`${styles.sidebar} ${open ? "" : styles.sidebarClosed}`}>
        <div className={styles.brand}>YURICA</div>
        <nav className={styles.nav}>
          <div className={styles.sidebarLangBlock}>
            <p className={styles.sidebarLangLabel}>{t("common.language")}</p>
            <LanguageToggle />
          </div>
        </nav>
        <div className={styles.footer}>
          <div className={styles.userEmail}>{emailToUsername(user?.email)}</div>
          <button type="button" onClick={signOut} className={styles.signOut}>
            {t("nav.signOut")}
          </button>
        </div>
      </aside>
    );
  }

  // Staff sidebar — Home / Schedule (with children) / Payslips + sign out.
  if (!userIsOwner && !userIsChef) {
    const staffNav: NavGroup[] = [
      { icon: "🏠", label: t("nav.home"), href: "/staff" },
      {
        icon: "📋",
        label: t("nav.onboarding"),
        children: [
          { label: t("nav.onboardingOverview"), href: "/onboarding" },
          { label: t("nav.staffHandbook"), href: "/staff/handbook" },
          { label: t("nav.beerGuide"), href: "/staff/beer-guide" },
        ],
      },
      {
        icon: "📅",
        label: t("nav.schedule"),
        children: [
          { label: t("nav.roster"), href: "/staff/schedule/roster" },
          { label: t("nav.requestHoliday"), href: "/staff/schedule/request-holiday" },
          { label: t("nav.availabilityChange"), href: "/staff/schedule/availability-change" },
        ],
      },
      { icon: "💰", label: t("nav.payslips"), href: "/staff/payslips" },
      { icon: "📄", label: t("nav.myDocuments"), href: "/staff/documents" },
      { icon: "⚙️", label: t("nav.settings"), href: "/staff/settings" },
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
                    <NavChildList
                      items={group.children}
                      pathname={pathname}
                      onNavigate={onClose}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className={styles.footer}>
          <div className={styles.userEmail}>{emailToUsername(user?.email)}</div>
          <button type="button" onClick={signOut} className={styles.signOut}>
            {t("nav.signOut")}
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
                  <NavChildList
                    items={group.children}
                    pathname={pathname}
                    onNavigate={onClose}
                  />
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
