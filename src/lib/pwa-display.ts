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

/** Chromium's install prompt. Not in lib.dom, and iOS has no equivalent. */
export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/** Where the script below leaves the caught event for the banner to collect. */
const INSTALL_PROMPT_PROP = "__yInstallPrompt";

/** Announced on window whenever that stash changes, so a banner that mounted
 *  after the catch hears about it instead of polling for it. */
export const INSTALL_PROMPT_READY = "y:install-prompt";

/**
 * Catch Chromium's install prompt in <head>, before React exists.
 *
 * `beforeinstallprompt` fires once, early, and is gone — there is no way to
 * ask for it later. InstallBanner is a `dynamic(ssr:false)` import, so on a
 * cold load its chunk is still being fetched when the event goes past, and a
 * listener attached in its useEffect is in a race it frequently loses.
 *
 * Losing it is silent and it is worst exactly where it matters most: on the
 * setup guide the bar's fallback is no button at all (the only link it could
 * offer is the page already open), so a reader who came specifically to
 * install is shown a bar telling them to install and nothing to press.
 *
 * Running here makes that deterministic. The event is caught by the first
 * script in the document, kept, and handed over whenever the banner turns up.
 */
export const INSTALL_PROMPT_CAPTURE_SCRIPT =
  `(function(){var w=window;function s(v){w.${INSTALL_PROMPT_PROP}=v;` +
  `w.dispatchEvent(new Event("${INSTALL_PROMPT_READY}"))}` +
  `w.addEventListener("beforeinstallprompt",function(e){e.preventDefault();s(e)});` +
  `w.addEventListener("appinstalled",function(){s(null)})})();`;

function promptStash(): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  return window as unknown as Record<string, unknown>;
}

/** The prompt caught in <head>, if one has been. */
export function readInstallPrompt(): InstallPromptEvent | null {
  const w = promptStash();
  return w ? ((w[INSTALL_PROMPT_PROP] as InstallPromptEvent | undefined) ?? null) : null;
}

/** Drop it once used: prompt() throws the second time it is called. */
export function clearInstallPrompt(): void {
  const w = promptStash();
  if (w) w[INSTALL_PROMPT_PROP] = null;
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
  const fromUA = guidePlatformFromUserAgent(nav.userAgent);
  if (fromUA) return fromUA;
  // iPadOS 13 and later identify as macOS, byte for byte — there is nothing
  // in the user-agent to tell an iPad from a laptop, which is why the edge
  // cannot answer this one and the browser can. A touch-capable "Mac" is an
  // iPad. `platform` is deprecated and still the only thing that says so.
  if (nav.platform === "MacIntel" && nav.maxTouchPoints > 1) return "iphone";
  return null;
}

/**
 * The same question asked of a user-agent string on its own.
 *
 * Split out so the redirect in middleware and the one in the browser cannot
 * drift apart: the edge has only this header to go on, and the browser starts
 * here and then adds what the header cannot say.
 */
export function guidePlatformFromUserAgent(ua: string): GuidePlatform | null {
  // Android first: its user-agent also says "Linux", which nothing else here
  // tests for, but the order makes the precedence explicit rather than lucky.
  if (/android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/.test(ua)) return "iphone";
  return null;
}
