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

/** The two phones the setup guide is written for. */
export type GuidePlatform = "iphone" | "android";

/**
 * Which setup guide this device needs, or null when we cannot tell.
 *
 * The question asked here is the operating system, even though the two guides
 * are named after browsers. Safari exists only on Apple hardware, and every
 * browser on iOS — Chrome and Firefox included — is Safari's engine under a
 * different icon, so "is this iOS" and "does this person need the Safari
 * instructions" are the same question. The reverse holds too: an Android
 * phone reading this in Firefox still needs the Chrome instructions, because
 * Chrome is the browser that can install the app there. Sniffing for the
 * browser name would get both of those wrong.
 *
 * Null rather than a guess. Sending someone to instructions for a phone they
 * are not holding is worse than the chooser they would have got anyway.
 */
export function detectGuidePlatform(): GuidePlatform | null {
  if (typeof window === "undefined") return null;
  const nav = window.navigator;
  // Android first: its user-agent also says "Linux", which nothing else here
  // tests for, but the order makes the precedence explicit rather than lucky.
  if (/android/i.test(nav.userAgent)) return "android";
  if (/iPhone|iPad|iPod/.test(nav.userAgent)) return "iphone";
  // iPadOS 13 and later identify as macOS and there is nothing in the
  // user-agent to tell them apart from a laptop. A touch-capable "Mac" is an
  // iPad. `platform` is deprecated and still the only thing that answers this.
  if (nav.platform === "MacIntel" && nav.maxTouchPoints > 1) return "iphone";
  return null;
}
