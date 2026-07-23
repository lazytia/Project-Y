/** Fired when the styled app shell (not auth-loading splash) has mounted. */
export const APP_READY_EVENT = "project-y-app-ready";

/** Fired when dashboard content (skeleton or live data) has painted in main. */
export const DASHBOARD_READY_EVENT = "project-y-dashboard-ready";

let readySent = false;
let dashboardReadySent = false;

/** Call when Shell / skeleton / login page mounts — not during auth loading. */
export function markAppReady() {
  if (typeof window === "undefined") return;
  if (readySent) return;
  readySent = true;
  window.dispatchEvent(new Event(APP_READY_EVENT));
}

export function markDashboardReady() {
  if (typeof window === "undefined") return;
  if (dashboardReadySent) return;
  dashboardReadySent = true;
  window.dispatchEvent(new Event(DASHBOARD_READY_EVENT));
}

export function isAppReady() {
  return readySent;
}

export function isDashboardReady() {
  return dashboardReadySent;
}
