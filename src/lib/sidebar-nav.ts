export type NavItem = {
  label: string;
  href: string;
  ownerOnly?: boolean;
  chefHidden?: boolean;
};

export type NavGroup = {
  icon: string;
  label: string;
  href?: string;
  children?: NavItem[];
  ownerOnly?: boolean;
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

export const MANAGER_NAV: NavGroup[] = [
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
  { icon: "💰", label: "Payslips", href: "/payslips" },
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

export const STAFF_NAV: NavGroup[] = [
  { icon: "🏠", label: "Home", href: "/staff" },
  {
    icon: "📋",
    label: "Onboarding",
    children: [
      { label: "Overview", href: "/onboarding" },
      { label: "Staff Handbook", href: "/staff/handbook" },
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
export function navForSessionRole(role: string | null): NavGroup[] {
  if (role === "staff") return STAFF_NAV;
  if (role === "chef") {
    return MANAGER_NAV.map((group) => ({
      ...group,
      children: group.children?.filter((c) => !c.chefHidden),
    })).filter((group) => group.href || (group.children && group.children.length > 0));
  }
  if (role === "owner") return OWNER_NAV;
  return OWNER_NAV;
}
