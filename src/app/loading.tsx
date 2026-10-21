"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/components/LanguageProvider";
import styles from "./loading.module.css";

/** How long a page may load before it is offered a way to try again. */
const SLOW_AFTER_MS = 8_000;

/**
 * Route segment loading.
 *
 * This used to render nothing, to avoid a second full-screen Y splash over the
 * server-drawn chrome. But it is what the page area shows for as long as a page
 * is on its way, and when the request for one never answers — a connection that
 * died while the app sat in another one — "nothing" is a white screen under a
 * working header, with no sign that anything is wrong and nothing to press.
 *
 * So it draws a small spinner inside the page area rather than over the whole
 * screen, and not for the first moments (the stylesheet fades it in late, so a
 * page that arrives quickly never shows it). After a while it says so and offers
 * a reload. The marker is what lib/boot-watchdog looks for: a page still loading
 * well after this should have gone is reloaded without anyone pressing anything.
 */
export default function Loading() {
  const { t } = useLang();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div className={styles.wrap} data-route-loading="true" role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      {slow && (
        <>
          <p className={styles.slowText}>{t("loading.slow")}</p>
          <button type="button" className={styles.reloadBtn} onClick={() => window.location.reload()}>
            {t("loading.reload")}
          </button>
        </>
      )}
    </div>
  );
}
