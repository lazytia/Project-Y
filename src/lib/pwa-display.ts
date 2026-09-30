/**
 * Is this page being shown by the installed app, or by a browser tab?
 *
 * The distinction matters more here than it does for most web apps. Web push
 * on iOS only works from a home-screen install — a roster change texted to a
 * phone that is reading this in a Safari tab produces no notification at all,
 * silently. So "which of the two is this" is not cosmetic; it decides whether
 * the person finds out their shift moved.
 *
 * There is no single answer to ask for. `display-mode` is the standard and is
 * what Android reports; iOS Safari has never implemented it for this and
 * exposes a non-standard `navigator.standalone` instead; an Android trusted
 * web activity reports neither and is recognised by the referrer it opens
 * with. A check that used only the standard one would tell every iPhone in
 * the building that it was in a browser.
 */

/**
 * Every display mode that means "not a browser tab".
 *
 * `minimal-ui` and `fullscreen` are included because the manifest's `display`
 * is a request, not a guarantee — a browser that will not honour `standalone`
 * falls back down this list, and the app is still installed when it does.
 */
export const STANDALONE_QUERY =
  "(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)";

type IosNavigator = Navigator & { standalone?: boolean };

export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  if ((window.navigator as IosNavigator).standalone === true) return true;
  if (document.referrer.startsWith("android-app://")) return true;
  return window.matchMedia(STANDALONE_QUERY).matches;
}
