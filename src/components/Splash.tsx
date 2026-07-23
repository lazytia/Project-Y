"use client";

import { useSyncExternalStore } from "react";
import { isBootSplashVisible } from "@/lib/boot-splash";
import styles from "./Splash.module.css";

type Props = {
  /** Optional sub-text under the wordmark. Defaults to nothing. */
  label?: string;
};

function subscribeBootSplash(onStoreChange: () => void) {
  const el = document.getElementById("boot-splash");
  if (!el) return () => {};
  const observer = new MutationObserver(onStoreChange);
  observer.observe(el, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

export default function Splash({ label }: Props) {
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
