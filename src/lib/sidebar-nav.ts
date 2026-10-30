import { CLOCK_IN_GUIDE_HREF } from "./clock-in-guide";
import { ROUTES } from "./routes";
import { translate } from "./translations";

export type NavItem = {
  label: string;
  href: string;
  ownerOnly?: boolean;
  chefHidden?: boolean;
  /** Indented sub-list under this item. The parent stays a link. */
  children?: NavItem[];
};

/**
 * Which picture a menu group shows, named after the picture rather than after
 * the group that happens to use it: labels get re-worded, but the payslip row
 * still wants the banknote.
 *
 * Two surfaces draw these — the sidebar as emoji (NAV_ICON_GLYPH below), the
 * chef dashboard as line art for Quick Access. Both key off this id, so
 * renaming a group can no longer silently drop its icon on one of them.
 */
export type NavIcon =
  | "home"
  | "food"
  | "money"
  | "people"
  | "calendar"
  | "book"
  | "clipboard"
  | "gear"
  | "file";

export const NAV_ICON_GLYPH: Record<NavIcon, string> = {
  home: "🏠",
  food: "🍽",
  money: "💰",
  people: "👥",
  calendar: "📅",
  book: "📚",
  clipboard: "📋",
  gear: "⚙️",
  file: "📄",
};

export type NavGroup = {
  icon: NavIcon;
  label: string;
  href?: string;
  children?: NavItem[];
  ownerOnly?: boolean;
};

/**
 * The training material, as one entry with the beer guide underneath it.
 *
 * Written once rather than three times: the owner, shift-lead and staff
 * menus all carry it, and three copies would only invite one of them to
 * keep the beer guide as a sibling after the other two had moved on.
 *
 * This is a menu shape and nothing more. The dashboards still raise the
 * unsigned beer guide as their own alert — that signature is chased
 * separately, from SIGNABLE_DOCUMENTS in lib/document-signatures.
 */
const TRAINING_MANUAL: NavItem = {
  label: "Training Manual",
  href: "/staff/training-manual",
  children: [{ label: "Beer Guide", href: "/staff/beer-guide" }],
};

export const OWNER_NAV: NavGroup[] = [
  { icon: "home", label: "Dashboard", href: "/" },
  {
    icon: "food",
    label: "Operations",
    children: [
      { label: "Reservations", href: "/operations/reservations" },
      { label: "Catering", href: "/operations/catering-orders" },
      { label: "Daily Sold Out", href: "/operations/daily-sold-out" },
      { label: "Item & Price Search", href: "/operations/item-search" },
      {
        label: "Roster",
        href: "/scheduling/roster",
        // The two requests sit with the roster they change, each opening the
        // Action Required queue on its own tab — the same queue People links
        // to, which the owner otherwise only reached by going looking for it.
        children: [
          { label: "Timesheets", href: "/payroll/timesheets" },
          { label: "Holiday Requests", href: "/attention-required?filter=holiday" },
          { label: "Availability Requests", href: "/attention-required?filter=availability" },
        ],
      },
      { label: "Cash Payments", href: "/people/cash-payments" },
    ],
  },
  {
    icon: "money",
    label: "Money",
    children: [
      { label: "Sales Overview", href: "/money/sales" },
      { label: "Payroll", href: "/payroll/payroll" },
      { label: "Supplier Cost", href: "/money/purchasing-cost" },
    ],
  },
  {
    icon: "people",
    label: "People",
    children: [
      // The four staff lists first, in lifecycle order, because that is what
      // this group is browsed for day to day.
      { label: "New Employees", href: "/people/onboarding" },
      { label: "Active Employees", href: "/people/active" },
      { label: "Notice Given", href: "/people/notice-given" },
      { label: "Terminated", href: "/people/terminated" },
      // The queue of things waiting on someone: pending holiday and
      // availability requests, and visas about to expire. Last, below the
      // lists it draws from. Submitted onboarding forms are not here — those
      // are read and approved on New Employees, at the top of this group.
      { label: "Action Required", href: "/attention-required" },
    ],
  },
  {
    // The documents used to hang here as four siblings, which said nothing
    // about which of them anyone still owed a signature on — the one thing
    // the owner opens this section to find out. They now live on the
    // /hr-records page, listed with their version and what is outstanding.
    //
    // That page is reached through Staff Compliance rather than by tapping
    // the group header. The header did both jobs — navigate on the label,
    // expand on a separate chevron — so the one entry in this section that is
    // a page of its own was also the only one you could not see listed.
    icon: "clipboard",
    label: "HR Records",
    children: [
      { label: "Staff Compliance", href: "/hr-records" },
      // A running record of conversations rather than a document anyone
      // signs, which is why it sits beside the compliance page, not on it.
      { label: "HR Notes", href: "/people/hr-notes" },
    ],
  },
  {
    icon: "gear",
    label: "System",
    children: [
      { label: "Settings", href: "/system/settings" },
      { label: "Notifications", href: "/system/notifications" },
    ],
  },
];

/** Team links every shift lead gets. */
const TEAM_ADMIN_LINKS: NavItem[] = [
  { label: "New Staff Requests", href: "/people/onboarding" },
  { label: "HR Notes", href: "/people/hr-notes" },
  { label: "Notice Given", href: "/people/notice-given" },
  { label: "Cash Payments", href: "/people/cash-payments" },
];

// The store manager's menu: Dashboard, Operations, Team, Training,
// Scheduling, Payslip, in that order. Spec approved by owner.
//
// Reference material (Staff Handbook, and the Training Manual with the Beer
// Guide under it) sits in its own Training group rather than under Team,
// which is purely people admin. Payslip is a single page, so it is a plain
// link rather than a group wrapping one child.
//
// Was a factory shared with the chef, who ran the same six groups with one
// Team link fewer. The kitchen menu has since been re-specced into five
// groups in a different order with different children, so there is nothing
// left for the two to share and the parameter has gone with it.
export const MANAGER_NAV: NavGroup[] = [
  { icon: "home", label: "Dashboard", href: "/" },
  {
    icon: "food",
    label: "Operations",
    children: [
      { label: "Daily Sold Out", href: "/operations/daily-sold-out" },
      { label: "Reservations", href: "/operations/reservations" },
      { label: "Catering Orders", href: "/operations/catering-orders" },
    ],
  },
  {
    icon: "people",
    label: "Team",
    // The manager triages the request queue, so Action Required leads his
    // Team group; the chef has no equivalent entry.
    children: [
      { label: "Action Required", href: "/attention-required" },
      ...TEAM_ADMIN_LINKS,
    ],
  },
  {
    icon: "book",
    label: "Training",
    children: [
      { label: "Staff Handbook", href: "/staff/handbook" },
      TRAINING_MANUAL,
    ],
  },
  {
    icon: "calendar",
    label: "Scheduling",
    children: [
      { label: "Roster", href: "/scheduling/roster" },
      { label: "Roster Insights", href: "/scheduling/insights" },
    ],
  },
  { icon: "money", label: "Payslip", href: "/payslips" },
];

/**
 * The kitchen menu. Six groups, owner-specced, and deliberately not the
 * manager's with rows removed.
 *
 * Dashboard leads, as it does for the owner and the manager: the wordmark in
 * the header goes home too, but a menu that opens over the screen you are on
 * needs a visible way back to it. Quick Access on the dashboard mirrors the
 * groups below it and drops this row, since it is already there.
 *
 * Operations leads the work groups because it is what the kitchen opens the
 * app for. Payslips and Documents & Training are single pages, so they are
 * plain links; an accordion wrapping one child only adds a tap.
 *
 * The /people hrefs are load-bearing beyond navigation — useNavChangeBadges
 * matches on them by exact path to hang the "+N since you last looked" badge,
 * so New Staff and Leaving Staff must keep pointing at /people/onboarding and
 * /people/notice-given.
 */
export const CHEF_NAV: NavGroup[] = [
  { icon: "home", label: "Dashboard", href: "/" },
  {
    icon: "food",
    label: "Operations",
    children: [
      { label: "Sold Out Today", href: "/operations/daily-sold-out" },
      { label: "Reservations", href: "/operations/reservations" },
      { label: "Catering Orders", href: "/operations/catering-orders" },
      { label: "Item & Price Search", href: "/operations/item-search" },
    ],
  },
  {
    icon: "calendar",
    label: "Scheduling",
    children: [
      { label: "Roster", href: "/scheduling/roster" },
      { label: "Roster Insights", href: "/scheduling/insights" },
      // The same queue the manager reaches through Action Required, opened
      // on the one tab the kitchen is asked about.
      { label: "Availability Requests", href: "/attention-required?filter=availability" },
    ],
  },
  {
    icon: "people",
    label: "Team",
    children: [
      { label: "New Staff", href: "/people/onboarding" },
      { label: "Leaving Staff", href: "/people/notice-given" },
      { label: "Cash Payments", href: "/people/cash-payments" },
    ],
  },
  { icon: "money", label: "Payslips", href: "/payslips" },
  { icon: "book", label: "Documents & Training", href: ROUTES.staffHandbookTraining },
];

/**
 * The top level of a menu as flat {icon, label, href} rows.
 *
 * For the dashboard shortcut lists, which are the same destinations as the
 * menu and were going to be typed out a second time beside it. A group with
 * no href of its own resolves to its first child, because none of
 * Operations, Scheduling or Team is a page — they are headings over pages,
 * and the first child is what tapping the heading already opens.
 *
 * The icon travels with the row so the shortcut list has nothing left to look
 * up by label. Groups with neither an href nor children are dropped rather
 * than rendered as a dead row.
 */
export function navShortcuts(
  nav: NavGroup[],
): { icon: NavIcon; label: string; href: string }[] {
  return nav.flatMap((group) => {
    const href = group.href ?? group.children?.[0]?.href;
    return href ? [{ icon: group.icon, label: group.label, href }] : [];
  });
}

/**
 * The staff menu: Home, Schedule, Payslips, Handbook & Training, My Documents,
 * Settings.
 *
 * Written once, with every label passed through `label`, because it is drawn
 * twice and the two copies have drifted before: the live Sidebar runs the keys
 * through `t()` so the Japanese crew read their own language, and the
 * server-rendered shell that paints ahead of hydration wants the same tree in
 * English. When they were two hand-written arrays the shell kept serving an
 * "Onboarding" group the live menu had dropped, and staff watched their menu
 * rearrange itself a moment after load.
 *
 * Schedule holds the roster and everything you do about your own hours, with
 * the clock-in guide second — the dashboard only promotes it for a new starter's
 * first fortnight, and this is where it lives after that.
 *
 * Handbook & Training and My Documents are plain links, each to its own page:
 * the first opens a hub listing the handbook, the menu, the service guides and
 * the beer guide; the second goes straight to where a visa or RSA is uploaded.
 * Neither carries a sub-menu, so there is nothing to open before getting there.
 */
export function buildStaffNav(label: (key: string) => string): NavGroup[] {
  return [
    { icon: "home", label: label("nav.home"), href: ROUTES.staffHome },
    {
      icon: "calendar",
      label: label("nav.schedule"),
      children: [
        { label: label("nav.roster"), href: ROUTES.staffScheduleRoster },
        { label: label("nav.clockInGuide"), href: CLOCK_IN_GUIDE_HREF },
        { label: label("nav.requestHoliday"), href: ROUTES.staffScheduleRequestHoliday },
        { label: label("nav.availabilityChange"), href: ROUTES.staffScheduleAvailability },
      ],
    },
    { icon: "money", label: label("nav.payslips"), href: ROUTES.staffPayslips },
    { icon: "book", label: label("nav.handbookTraining"), href: ROUTES.staffHandbookTraining },
    { icon: "file", label: label("nav.myDocuments"), href: ROUTES.staffDocumentUploads },
    { icon: "gear", label: label("nav.settings"), href: ROUTES.staffSettings },
  ];
}

/** Staff menu for the SSR shell paint — the same tree, in English. */
export const STAFF_NAV: NavGroup[] = buildStaffNav((key) => translate("en", key));

/** Nav tree for SSR shell paint based on the session role cookie. */
export function navForSessionRole(
  role: string | null,
  dashboard: string | null = null,
): NavGroup[] {
  if (role === "staff") return STAFF_NAV;
  if (role === "chef") return CHEF_NAV;
  if (dashboard === "manager") return MANAGER_NAV;
  if (role === "owner") return OWNER_NAV;
  return OWNER_NAV;
}

/* ── Which entry stands for the current page ── */

export function isNavChildActive(pathname: string, href: string): boolean {
  // usePathname() never carries a query string, so a nav href that opens a
  // page on a particular tab — /attention-required?filter=availability — could
  // never match the path it lands on. It highlighted nothing, and worse left
  // groupOwningPath unable to find the group holding it, so the accordion
  // collapsed the moment that row was used.
  const path = href.split("?")[0];
  if (pathname === path) return true;
  if (path === "/onboarding" && pathname.startsWith("/onboarding")) return true;
  return pathname.startsWith(`${path}/`);
}

/**
 * How well a nav href describes the current page: 0 not at all, 1 by its path,
 * 2 by its path and every query parameter it names, and 0.5 for a href whose
 * path matches but whose tab is not the open one — still the right entry when
 * a menu has no other way to that page, as the kitchen's has none but its
 * Availability Requests row.
 *
 * The owner's menu reaches /attention-required three ways — Action Required
 * under People, and Holiday / Availability Requests under Roster, each opening
 * one tab. Matching on the path alone lit all three at once and opened
 * whichever group came first, so a href that names the tab now has to agree
 * with the tab that is open, and beats a plain link to the same page.
 */
export function navHrefScore(pathname: string, search: URLSearchParams, href: string): number {
  if (!isNavChildActive(pathname, href)) return 0;
  const query = href.split("?")[1];
  if (!query) return 1;
  for (const [key, value] of new URLSearchParams(query)) {
    if (search.get(key) !== value) return 0.5;
  }
  return 2;
}

/**
 * The one href in the rendered tree that stands for the current page, or null.
 * The best score wins; among equals, the first in menu order.
 */
export function activeNavHref(nav: NavGroup[], pathname: string, search: URLSearchParams): string | null {
  let best: string | null = null;
  let bestScore = 0;
  const consider = (href: string | undefined) => {
    if (!href) return;
    const score = navHrefScore(pathname, search, href);
    if (score > bestScore) {
      best = href;
      bestScore = score;
    }
  };
  const walk = (items: NavItem[]) =>
    items.forEach((i) => {
      consider(i.href);
      if (i.children) walk(i.children);
    });
  nav.forEach((g) => {
    consider(g.href);
    if (g.children) walk(g.children);
  });
  return best;
}

/**
 * Label of the group that holds the current page's entry, or null. Searched
 * through the rendered tree — including grandchildren — so the answer is
 * always whatever the menu actually looks like for this role.
 *
 * A group's own href counts as well as its children's: HR Records is a
 * section with a page of its own, and landing on that page should leave the
 * list under it open rather than collapsed. Groups with nothing under them
 * are skipped — there is no accordion to open.
 */
export function groupOwningPath(nav: NavGroup[], activeHref: string | null): string | null {
  if (!activeHref) return null;
  const owns = (items: NavItem[]): boolean =>
    items.some((i) => i.href === activeHref || (i.children ? owns(i.children) : false));
  return (
    nav.find((g) => !!g.children && (owns(g.children) || g.href === activeHref))?.label ?? null
  );
}
