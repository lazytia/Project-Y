export type NavItem = {
  label: string;
  href: string;
  ownerOnly?: boolean;
  chefHidden?: boolean;
  /** Indented sub-list under this item. The parent stays a link. */
  children?: NavItem[];
};

export type NavGroup = {
  icon: string;
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
  { icon: "🏠", label: "Dashboard", href: "/" },
  {
    icon: "🍽",
    label: "Operations",
    children: [
      { label: "Reservations", href: "/operations/reservations" },
      { label: "Catering", href: "/operations/catering-orders" },
      { label: "Daily Sold Out", href: "/operations/daily-sold-out" },
      {
        label: "Roster",
        href: "/scheduling/roster",
        children: [{ label: "Timesheets", href: "/payroll/timesheets" }],
      },
      { label: "Cash Payments", href: "/people/cash-payments" },
    ],
  },
  {
    icon: "💰",
    label: "Money",
    children: [
      { label: "Sales Overview", href: "/money/sales" },
      { label: "Payroll", href: "/payroll/payroll" },
      { label: "Supplier Cost", href: "/money/purchasing-cost" },
    ],
  },
  {
    icon: "👥",
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
    icon: "📋",
    label: "HR Records",
    children: [
      { label: "Staff Compliance", href: "/hr-records" },
      // A running record of conversations rather than a document anyone
      // signs, which is why it sits beside the compliance page, not on it.
      { label: "HR Notes", href: "/people/hr-notes" },
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
  { icon: "🏠", label: "Dashboard", href: "/" },
  {
    icon: "🍽",
    label: "Operations",
    children: [
      { label: "Daily Sold Out", href: "/operations/daily-sold-out" },
      { label: "Reservations", href: "/operations/reservations" },
      { label: "Catering Orders", href: "/operations/catering-orders" },
    ],
  },
  {
    icon: "👥",
    label: "Team",
    // The manager triages the request queue, so Action Required leads his
    // Team group; the chef has no equivalent entry.
    children: [
      { label: "Action Required", href: "/attention-required" },
      ...TEAM_ADMIN_LINKS,
    ],
  },
  {
    icon: "📚",
    label: "Training",
    children: [
      { label: "Staff Handbook", href: "/staff/handbook" },
      TRAINING_MANUAL,
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
  { icon: "💰", label: "Payslip", href: "/payslips" },
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
 * app for. Payslips
 * and Documents & Training are single pages, so they are plain links; an
 * accordion wrapping one child only adds a tap.
 *
 * The /people hrefs are load-bearing beyond navigation — useNavChangeBadges
 * matches on them by exact path to hang the "+N since you last looked" badge,
 * so New Staff and Leaving Staff must keep pointing at /people/onboarding and
 * /people/notice-given.
 */
export const CHEF_NAV: NavGroup[] = [
  { icon: "🏠", label: "Dashboard", href: "/" },
  {
    icon: "🍽",
    label: "Operations",
    children: [
      { label: "Sold Out Today", href: "/operations/daily-sold-out" },
      { label: "Reservations", href: "/operations/reservations" },
      { label: "Catering Orders", href: "/operations/catering-orders" },
    ],
  },
  {
    icon: "📅",
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
    icon: "👥",
    label: "Team",
    children: [
      { label: "New Staff", href: "/people/onboarding" },
      { label: "Leaving Staff", href: "/people/notice-given" },
      { label: "Cash Payments", href: "/people/cash-payments" },
    ],
  },
  { icon: "💰", label: "Payslips", href: "/payslips" },
  { icon: "📚", label: "Documents & Training", href: "/staff/documents" },
];

/**
 * The top level of a menu as flat {label, href} rows.
 *
 * For the dashboard shortcut lists, which are the same destinations as the
 * menu and were going to be typed out a second time beside it. A group with
 * no href of its own resolves to its first child, because none of
 * Operations, Scheduling or Team is a page — they are headings over pages,
 * and the first child is what tapping the heading already opens.
 *
 * Groups with neither an href nor children are dropped rather than rendered
 * as a dead row.
 */
export function navShortcuts(nav: NavGroup[]): { label: string; href: string }[] {
  return nav.flatMap((group) => {
    const href = group.href ?? group.children?.[0]?.href;
    return href ? [{ label: group.label, href }] : [];
  });
}

/**
 * Staff menu for the SSR shell paint.
 *
 * Must stay in step with the `staffNav` memo in Sidebar.tsx, which is what
 * replaces this once the client has hydrated — the two differ only in that
 * the live one runs the labels through `t()`. This copy had drifted badly: it
 * still led with an "Onboarding" group the client menu dropped some time ago,
 * so staff were served a menu for a thing they had finished and watched it
 * rearrange itself under them a moment later.
 *
 * Flat on purpose. Every row is a destination, and NavGroupBlock renders a
 * group with an `href` and no `children` as a plain link with no chevron.
 */
export const STAFF_NAV: NavGroup[] = [
  { icon: "🏠", label: "Home", href: "/staff" },
  { icon: "📅", label: "Schedule", href: "/staff/schedule/roster" },
  { icon: "💰", label: "Payslips", href: "/staff/payslips" },
  { icon: "📚", label: "Documents & Training", href: "/staff/documents" },
  { icon: "✍️", label: "Requests", href: "/staff/requests" },
];

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
