"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HOME_SCREEN_NAME } from "@/lib/brand";
import { ROUTES, setupGuideRoute } from "@/lib/routes";
import {
  detectGuidePlatform,
  isStandaloneDisplay,
  STANDALONE_QUERY,
  type GuidePlatform,
} from "@/lib/pwa-display";
import styles from "./InstallBanner.module.css";

/**
 * A bar across the top of a browser tab, telling the reader to open the app
 * from their home screen instead.
 *
 * Staff who never install keep working — the site is the same site — but they
 * never receive a notification, because iOS only delivers web push to an
 * installed app. That failure is completely silent: nothing looks broken, the
 * roster is right there, and the first sign of trouble is somebody not
 * turning up for a shift that moved. This bar is the only thing in the app
 * that can say so, because it is the only thing that knows which of the two
 * the page is being read in.
 *
 * Deliberately not shown on the setup guide itself. A bar telling you to go
 * read the instructions, printed across the top of the instructions, is just
 * something else covering them up.
 */

/** Matches the width AppShell swaps to its mobile header at. `pointer:
 *  coarse` keeps it off a laptop, where "add to home screen" means nothing
 *  and the owner is working in a browser tab on purpose. */
const HANDHELD_QUERY = "(max-width: 1024px) and (pointer: coarse)";

/**
 * Dismissal lasts the browser session and no longer.
 *
 * localStorage would be the usual choice and is wrong here: dismissing this
 * once would permanently silence the only warning that notifications are not
 * being delivered, for a person who has not fixed the thing it is warning
 * about. Closing the tab clears it, so the bar is an interruption that can be
 * put aside rather than an argument that can be won.
 */
const DISMISS_KEY = "y-install-banner-dismissed";

/** Read by AppShell to make room, so the bar pushes the app down instead of
 *  sitting on top of the header. Absent = zero, which is the normal case. */
const HEIGHT_VAR = "--install-banner-h";

/** Chromium's install prompt. Not in lib.dom, and iOS has no equivalent. */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function wasDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    // Private mode / storage disabled. Showing the bar is the safe failure.
    return false;
  }
}

export default function InstallBanner() {
  const pathname = usePathname();
  const [eligible, setEligible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [platform, setPlatform] = useState<GuidePlatform | null>(null);
  const [node, setNode] = useState<HTMLDivElement | null>(null);

  // The guide is excluded by prefix so the per-phone pages under it are too.
  const onGuide = pathname === ROUTES.setupGuide || pathname.startsWith(`${ROUTES.setupGuide}/`);
  const visible = eligible && !dismissed && !onGuide;

  useEffect(() => {
    const handheld = window.matchMedia(HANDHELD_QUERY);
    const standalone = window.matchMedia(STANDALONE_QUERY);
    const update = () => setEligible(handheld.matches && !isStandaloneDisplay());

    update();
    setDismissed(wasDismissed());
    // Set here rather than at render so the first paint already has the right
    // destination: the device cannot change under us, but the server does not
    // know it, and a link that corrects itself after hydration is a link
    // somebody can tap in the wrong state.
    setPlatform(detectGuidePlatform());
    handheld.addEventListener("change", update);
    standalone.addEventListener("change", update);
    return () => {
      handheld.removeEventListener("change", update);
      standalone.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    // Chromium fires this when the app is installable. Holding onto it turns
    // the bar's button into a one-tap install; without it (iOS, Firefox) the
    // button has to send the reader to the written instructions instead.
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallPrompt(null);
      setEligible(false);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // Publish the real rendered height rather than a number written down twice.
  // The text wraps to two lines on a narrow phone and one on a wide one, and
  // a hardcoded height is wrong on one of them.
  useEffect(() => {
    const root = document.documentElement;
    const clear = () => root.style.removeProperty(HEIGHT_VAR);
    if (!visible || !node) {
      clear();
      return;
    }
    const apply = () => root.style.setProperty(HEIGHT_VAR, `${node.offsetHeight}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => {
      observer.disconnect();
      clear();
    };
  }, [visible, node]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* nothing to remember it with; it will be back next render */
    }
  }, []);

  const install = useCallback(async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    // The prompt is single-use either way — a second prompt() throws.
    setInstallPrompt(null);
    if (outcome === "accepted") setEligible(false);
  }, [installPrompt]);

  if (!visible) return null;

  return (
    <div ref={setNode} className={styles.bar} role="region" aria-label={`Install ${HOME_SCREEN_NAME}`}>
      <span className={styles.mark} aria-hidden="true">
        Y
      </span>
      <p className={styles.text}>
        <strong className={styles.lead}>Open {HOME_SCREEN_NAME} from your home screen.</strong>{" "}
        Notifications about your roster only arrive in the installed app.
      </p>
      {installPrompt ? (
        <button type="button" className={styles.action} onClick={install}>
          Install
        </button>
      ) : (
        <Link href={setupGuideRoute(platform)} className={styles.action}>
          Set up
        </Link>
      )}
      <button
        type="button"
        className={styles.close}
        onClick={dismiss}
        aria-label="Hide until next time"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
