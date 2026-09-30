"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HOME_SCREEN_NAME } from "@/lib/brand";
import { isSetupGuidePath, setupGuideRoute } from "@/lib/routes";
import {
  clearInstallPrompt,
  detectGuidePlatform,
  INSTALL_PROMPT_READY,
  isStandaloneDisplay,
  readInstallPrompt,
  STANDALONE_QUERY,
  type GuidePlatform,
  type InstallPromptEvent,
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
 * Shown on the setup guide too. On Chromium it is the shortest path there
 * is — the guide's own first step is "open the menu and find Install", and
 * this bar is that, as a button, above the picture describing it. What it
 * drops on those pages is the link to the guide, because a button that
 * navigates to the page already on screen is a button that does nothing.
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

  const guideHref = setupGuideRoute(platform);
  const onGuide = isSetupGuidePath(pathname);
  // Never offer the guide to somebody already reading it. The bar still says
  // its piece there; it just stops offering the way.
  //
  // Asked of the path, not of `guideHref`. Comparing the two was the same
  // question only on a device we can name: everywhere else — a desktop, an
  // iPad, Firefox — `platform` is null, `guideHref` falls back to the chooser,
  // and the bar put a "Set up" button on the android guide that walked the
  // reader to the chooser and, once its own detection ran, straight back to
  // the page they started on. A button that does nothing, slowly.
  const showGuideLink = !onGuide;
  // Dismissal is for the pages where this bar is an interruption laid over
  // the thing somebody came to read. On the setup guide it is not covering
  // the content, it is part of it: the Install button lives in here, and that
  // button is the entire reason the link was texted to them.
  //
  // So the guide does not honour a dismissal, and does not offer one. The X
  // sat exactly where a thumb reaches for Install, and hitting it took the
  // only one-tap install away for the rest of the browser session with
  // nothing on the page able to bring it back — the bar was simply gone, on
  // every guide page, until the tab was closed.
  const visible = eligible && (onGuide || !dismissed);

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
    // Chromium fires `beforeinstallprompt` when the app is installable, and it
    // has almost always fired before this component exists — so the prompt is
    // collected from the stash the head script keeps rather than waited for
    // here. Holding onto it turns the bar's button into a one-tap install;
    // without it (iOS, Firefox) the button falls back to the instructions.
    const collect = () => setInstallPrompt(readInstallPrompt());
    const onInstalled = () => setEligible(false);

    collect();
    window.addEventListener(INSTALL_PROMPT_READY, collect);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener(INSTALL_PROMPT_READY, collect);
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
    // The prompt is single-use either way — a second prompt() throws. Cleared
    // in the stash as well, or the next mount collects a spent event.
    clearInstallPrompt();
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
      ) : showGuideLink ? (
        <Link href={guideHref} className={styles.action}>
          Set up
        </Link>
      ) : null}
      {!onGuide && (
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
      )}
    </div>
  );
}
