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
 * This is a menu shape and nothing more. The dashboard still raises
 * "Beer Guide not signed" as its own alert — that signature is chased
 * separately, and lives in SIGNABLE_DOCS in ManagerDashboard.
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
      // availability requests, visas about to expire, onboarding forms
      // submitted but not approved. Last, below the lists it draws from.
      { label: "Attention Required", href: "/attention-required" },
    ],
  },
  {
    icon: "📋",
    label: "HR Records",
    children: [
      { label: "HR Notes", href: "/people/hr-notes" },
      // The owner has always called this "Training Guide" and wants to keep
      // it. Only the label differs — the href and the Beer Guide underneath
      // it still come from TRAINING_MANUAL, so the nesting can't drift out
      // of step with the shift-lead and staff menus.
      { ...TRAINING_MANUAL, label: "Training Guide" },
      { label: "Employee Handbook", href: "/staff/handbook" },
      { label: "Employment Contract", href: "/hr-records/employment-contract" },
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

// The two shift leads — chef (Chuck) and store manager (Yurina) — run the
// same menu: Dashboard, Operations, Team, Training, Scheduling, Payslip,
// in that order. Spec approved by owner.
//
// Reference material (Staff Handbook, and the Training Manual with the Beer
// Guide under it) sits in its own Training group rather than under Team,
// which is purely people admin. Payslip is a single page, so it is a plain
// link rather than a group wrapping one child.
//
// Built by a factory rather than written twice: the two menus differ by
// exactly one Team link (Attention Required, manager only), and two 45-line
// copies would only invite one of them to be edited alone. The difference
// is passed in, so it stays visible at each call site instead of turning
// into a role flag buried in the tree — flags are what made the earlier
// shared version awkward to read.
function shiftLeadNav(teamChildren: NavItem[]): NavGroup[] {
  return [
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
      children: teamChildren,
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
}

// The manager triages the request queue; the chef doesn't, so his Team group
// is the plain admin list.
export const MANAGER_NAV: NavGroup[] = shiftLeadNav([
  { label: "Attention Required", href: "/attention-required" },
  ...TEAM_ADMIN_LINKS,
]);

export const CHEF_NAV: NavGroup[] = shiftLeadNav(TEAM_ADMIN_LINKS);

export const STAFF_NAV: NavGroup[] = [
  { icon: "🏠", label: "Home", href: "/staff" },
  {
    icon: "📋",
    label: "Onboarding",
    children: [
      { label: "Overview", href: "/onboarding" },
      { label: "Staff Handbook", href: "/staff/handbook" },
      TRAINING_MANUAL,
    ],
  },
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
  { icon: "⚙️", label: "Settings", href: "/staff/settings" },
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
