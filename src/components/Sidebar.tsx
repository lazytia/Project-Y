"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { User } from "firebase/auth";
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
import {
  NAV_BADGE_HREFS,
  loadNavBadgeCounts,
  navBadgeDelta,
  readNavSeen,
  reconcileNavSeen,
  writeNavSeen,
  type NavCountMap,
} from "@/lib/nav-change-badges";
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

/**
 * Label of the group that contains the current page, or null. Searched
 * through the rendered tree — including grandchildren — so the answer is
 * always whatever the menu actually looks like for this role.
 *
 * A group's own href counts as well as its children's: HR Records is a
 * section with a page of its own, and landing on that page should leave the
 * list under it open rather than collapsed. Groups with nothing under them
 * are skipped — there is no accordion to open.
 */
function groupOwningPath(nav: NavGroup[], pathname: string): string | null {
  const owns = (items: NavItem[]): boolean =>
    items.some(
      (i) => isNavChildActive(pathname, i.href) || (i.children ? owns(i.children) : false),
    );
  return (
    nav.find(
      (g) =>
        !!g.children &&
        (owns(g.children) || (!!g.href && isNavChildActive(pathname, g.href))),
    )?.label ?? null
  );
}

function NavChildList({
  items,
  pathname,
  onNavigate,
  badges,
  nested = false,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
  /** How many new rows each href has gained since the user last opened it. */
  badges?: NavCountMap;
  nested?: boolean;
}) {
  return (
    <ul className={nested ? styles.grandChildren : styles.children}>
      {items.map((item) => {
        const badge = badges?.[item.href] ?? 0;
        return (
        <li key={item.href}>
          <Link
            href={item.href}
            className={`${styles.childLink} ${nested ? styles.grandChildLink : ""} ${
              isNavChildActive(pathname, item.href) ? styles.active : ""
            }`}
            onClick={onNavigate}
          >
            <span className={styles.childLabel}>{item.label}</span>
            {badge > 0 && (
              <span
                className={styles.childBadge}
                aria-label={`${badge} new since you last looked`}
              >
                +{badge}
              </span>
            )}
          </Link>
          {item.children && (
            <NavChildList
              items={item.children}
              pathname={pathname}
              onNavigate={onNavigate}
              badges={badges}
              nested
            />
          )}
        </li>
        );
      })}
    </ul>
  );
}

/**
 * One top-level menu entry: the header, and the list underneath it.
 *
 * A group is a plain link, or an accordion, or — for HR Records — both: a
 * section with a page of its own and a short list under it. When it is both,
 * the label navigates and a separate chevron expands, because one header
 * doing both on a single click would either swallow the navigation or leave
 * the list unreachable.
 *
 * Shared by the staff and owner menus. They rendered this markup twice and
 * differed only in whether change badges were passed down, so the href +
 * children case would otherwise have had to be got right in both copies.
 */
function NavGroupBlock({
  group,
  pathname,
  expanded,
  onToggle,
  onNavigate,
  badges,
}: {
  group: NavGroup;
  pathname: string;
  expanded: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
  badges?: NavCountMap;
}) {
  const chevron = (
    <span className={`${styles.chevron} ${expanded ? styles.chevronOpen : ""}`} aria-hidden="true">
      ›
    </span>
  );

  return (
    <div className={styles.group}>
      {group.href ? (
        <div className={styles.groupHeaderRow}>
          <Link
            href={group.href}
            className={`${styles.groupHeader} ${pathname === group.href ? styles.active : ""}`}
            onClick={onNavigate}
          >
            <span className={styles.icon}>{group.icon}</span>
            <span className={styles.groupLabel}>{group.label}</span>
          </Link>
          {group.children && (
            <button
              type="button"
              className={styles.chevronBtn}
              onClick={onToggle}
              aria-expanded={expanded}
              aria-label={`${expanded ? "Collapse" : "Expand"} ${group.label}`}
            >
              {chevron}
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          className={styles.groupHeader}
          onClick={onToggle}
          aria-expanded={expanded}
        >
          <span className={styles.icon}>{group.icon}</span>
          <span className={styles.groupLabel}>{group.label}</span>
          {chevron}
        </button>
      )}
      {group.children && (
        <div className={`${styles.collapseWrap} ${expanded ? styles.collapseOpen : ""}`}>
          <NavChildList
            items={group.children}
            pathname={pathname}
            onNavigate={onNavigate}
            badges={badges}
          />
        </div>
      )}
    </div>
  );
}

/** Does this menu contain anything a change badge is tracked for? */
function navHasBadgedHref(nav: NavGroup[]): boolean {
  const tracked = new Set<string>(Object.values(NAV_BADGE_HREFS));
  const scan = (items: NavItem[]): boolean =>
    items.some((i) => tracked.has(i.href) || (i.children ? scan(i.children) : false));
  return nav.some((g) => (g.children ? scan(g.children) : false));
}

/**
 * "+N" beside the People menu entries whose lists have grown.
 *
 * Counts are read once per mount and deliberately behind runWhenIdle — the
 * badge is decoration and must never compete with the page it sits next to.
 */
function useNavChangeBadges(user: User | null | undefined, enabled: boolean, pathname: string) {
  const uid = user?.uid;
  const [counts, setCounts] = useState<NavCountMap | null>(null);
  const [seen, setSeen] = useState<NavCountMap>({});

  useEffect(() => {
    setSeen(uid ? readNavSeen(uid) : {});
  }, [uid]);

  useEffect(() => {
    if (!user || !enabled) return;
    let alive = true;
    const cancel = runWhenIdle(() => {
      loadNavBadgeCounts(user)
        .then((next) => {
          if (alive) setCounts(next);
        })
        .catch(() => {
          /* offline or rules — just render no badges */
        });
    }, 0);
    return () => {
      alive = false;
      cancel();
    };
  }, [user, enabled]);

  useEffect(() => {
    if (!uid || !counts) return;
    const visited = Object.values(NAV_BADGE_HREFS).find((href) =>
      isNavChildActive(pathname, href),
    );
    const next = reconcileNavSeen(counts, seen, visited);
    if (!next) return;
    setSeen(next);
    writeNavSeen(uid, next);
  }, [uid, counts, seen, pathname]);

  return useMemo(() => {
    if (!counts) return undefined;
    const out: NavCountMap = {};
    for (const [href, count] of Object.entries(counts)) {
      const delta = navBadgeDelta(count, seen[href]);
      if (delta > 0) out[href] = delta;
    }
    return out;
  }, [counts, seen]);
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

  /** Shut the drawer on the way out, so signing back in doesn't land on an
   *  open menu left over from the previous session. */
  const handleSignOut = () => {
    onClose?.();
    void signOut();
  };

  const toggleGroup = (label: string) => {
    setOpenGroup((prev) => (prev === label ? null : label));
    if (!userIsStrictOwner) return;
    if (label === "Money") runWhenIdle(() => prefetchOwnerMoneySummaries(), 0);
    else if (label === "Inventory") runWhenIdle(() => prefetchOwnerInventorySummaries(), 0);
  };

  // Managers (yurina) get a curated nav — narrower than the owner nav and
  // explicit so the structure isn't accidentally widened later.
  const ownerNav = useMemo(
    () =>
      OWNER_NAV.filter((group) => !group.ownerOnly || userIsStrictOwner)
        .map((group) => ({
          ...group,
          children: group.children?.filter((c) => !c.ownerOnly || userIsStrictOwner),
        }))
        .filter((group) => group.href || (group.children && group.children.length > 0)),
    [userIsStrictOwner],
  );

  // Staff sidebar — Home / Schedule (with children) / Payslips + sign out.
  // Built here rather than inside the staff branch below so the open-group
  // effect can see the same tree the staff member is looking at.
  const staffNav: NavGroup[] = useMemo(
    () => [
      { icon: "🏠", label: t("nav.home"), href: "/staff" },
      {
        icon: "📋",
        label: t("nav.onboarding"),
        children: [
          { label: t("nav.onboardingOverview"), href: "/onboarding" },
          { label: t("nav.staffHandbook"), href: "/staff/handbook" },
          // Mirrors TRAINING_MANUAL in sidebar-nav.ts — same shape, but the
          // labels have to come from the language toggle, which that module
          // can't reach. Keep the two in step.
          {
            label: t("nav.trainingManual"),
            href: "/staff/training-manual",
            children: [{ label: t("nav.beerGuide"), href: "/staff/beer-guide" }],
          },
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
    ],
    [t],
  );

  // Chef and manager run the same menu apart from one Team link — the
  // manager triages Action Required, the chef doesn't — so the two trees
  // are separate exports and this branch picks between them.
  // Owners use ownerNav computed above.
  const managerNav: NavGroup[] = userIsChef ? CHEF_NAV : MANAGER_NAV;

  const visibleNav: NavGroup[] = userIsManager ? managerNav : ownerNav;

  /** The tree actually rendered below, so the effect and the markup agree. */
  const activeNav: NavGroup[] = !userIsOwner && !userIsChef ? staffNav : visibleNav;

  // Only pay for the counts when the menu on screen can actually show them —
  // staff never see the People group, and their Firestore rules would reject
  // the read anyway.
  const badges = useNavChangeBadges(user, navHasBadgedHref(activeNav), pathname);

  /**
   * Keep the group containing the current page open.
   *
   * This used to be a list of path prefixes, with /staff/handbook and
   * /staff/beer-guide wired to the staff menu's "Onboarding" group. Once
   * those pages moved under the chef's new "Training" group, opening one
   * closed Training and tried to open a group that isn't in his menu at
   * all — so every Training link collapsed the accordion. Asking the tree
   * which group owns the path can't drift out of step with the menu.
   *
   * Depends on the path and the tree, never on openGroup: a group the user
   * expands by hand stays expanded until they navigate somewhere else.
   */
  useEffect(() => {
    const owner = groupOwningPath(activeNav, pathname);
    if (owner) setOpenGroup(owner);
  }, [pathname, activeNav]);

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
          <button type="button" onClick={handleSignOut} className={styles.signOut}>
            {t("nav.signOut")}
          </button>
        </div>
      </aside>
    );
  }

  // Staff sidebar — Home / Schedule (with children) / Payslips + sign out.
  // staffNav is built above, next to the other trees.
  if (!userIsOwner && !userIsChef) {
    return (
      <aside className={`${styles.sidebar} ${open ? "" : styles.sidebarClosed}`}>
        <div className={styles.brand}>YURICA</div>
        <nav className={styles.nav}>
          {staffNav.map((group) => (
            <NavGroupBlock
              key={group.label}
              group={group}
              pathname={pathname}
              expanded={openGroup === group.label}
              onToggle={() => toggleGroup(group.label)}
              onNavigate={onClose}
            />
          ))}
        </nav>
        <div className={styles.footer}>
          <div className={styles.userEmail}>{emailToUsername(user?.email)}</div>
          <button type="button" onClick={handleSignOut} className={styles.signOut}>
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
        {visibleNav.map((group) => (
          <NavGroupBlock
            key={group.label}
            group={group}
            pathname={pathname}
            expanded={openGroup === group.label}
            onToggle={() => toggleGroup(group.label)}
            onNavigate={onClose}
            badges={badges}
          />
        ))}
      </nav>
      <div className={styles.footer}>
        <div className={styles.userEmail}>{emailToUsername(user?.email)}</div>
        <button type="button" onClick={handleSignOut} className={styles.signOut}>
          Sign out
        </button>
      </div>
    </aside>
  );
}
