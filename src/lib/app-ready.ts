/** Fired when the styled app shell (not auth-loading splash) has mounted. */
export const APP_READY_EVENT = "project-y-app-ready";

/** Fired when Firebase authStateReady has resolved (loading → false). */
export const AUTH_READY_EVENT = "project-y-auth-ready";

/** Fired when the live dashboard layout has painted (not the skeleton). */
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
