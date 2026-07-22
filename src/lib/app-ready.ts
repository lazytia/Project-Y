/** Fired when the styled app shell (not auth-loading splash) has mounted. */
export const APP_READY_EVENT = "project-y-app-ready";

let readySent = false;

/** Call when Shell / skeleton / login page mounts — not during auth loading. */
export function markAppReady() {
  if (typeof window === "undefined") return;
  if (readySent) return;
  readySent = true;
  window.dispatchEvent(new Event(APP_READY_EVENT));
}

export function isAppReady() {
  return readySent;
}
