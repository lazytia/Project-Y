/** Fired on window once the client shell has mounted visible UI. */
export const APP_READY_EVENT = "project-y-app-ready";

let readySent = false;

/** Call when AppShell (or login) has painted — BootSplashDismiss listens for this. */
export function markAppReady() {
  if (typeof window === "undefined" || readySent) return;
  readySent = true;
  window.dispatchEvent(new Event(APP_READY_EVENT));
}
