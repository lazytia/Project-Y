"use client";

import { useSyncExternalStore } from "react";
import { isBootSplashVisible, ssrShellVisible } from "@/lib/boot-splash";
import { hasClientSessionHint } from "@/lib/client-session-hint";
import styles from "./Splash.module.css";

type Props = {
  /** Optional sub-text under the wordmark. Defaults to nothing. */
  label?: string;
  /** Show the Y splash even when SSR chrome is visible (e.g. post-login handoff). */
  forceVisible?: boolean;
};

function subscribeBootSplash(onStoreChange: () => void) {
  const el = document.getElementById("boot-splash");
  if (!el) {
    queueMicrotask(onStoreChange);
    return () => {};
  }
  const observer = new MutationObserver(onStoreChange);
  observer.observe(el, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function chromeAlreadyVisible(): boolean {
  if (typeof document === "undefined") return false;
  const fallback = document.getElementById("static-chrome-fallback");
  const fallbackVisible = !!fallback && !fallback.hasAttribute("hidden");
  return ssrShellVisible() || fallbackVisible || hasClientSessionHint();
}

export default function Splash({ label, forceVisible = false }: Props) {
  const bootVisible = useSyncExternalStore(
    subscribeBootSplash,
    isBootSplashVisible,
    () => true,
  );

  // Keep the HTML boot splash on screen — don't mount a second splash layer
  // that would flash when boot splash dismisses.
  if (bootVisible) {
    return <div data-page-loading="true" hidden aria-hidden="true" />;
  }

  // SSR / static chrome is already visible — never cover it with a 2nd Y splash.
  if (!forceVisible && chromeAlreadyVisible()) {
    return <div data-page-loading="true" hidden aria-hidden="true" />;
  }

  return (
    <div className={styles.splash} data-splash="true" role="status" aria-live="polite">
      <div className={styles.logo} aria-hidden="true">
        <span className={styles.mark}>Y</span>
      </div>
      <div className={styles.wordmark}>Project Y</div>
      <div className={styles.dots} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      {label && <div className={styles.label}>{label}</div>}
    </div>
  );
}
