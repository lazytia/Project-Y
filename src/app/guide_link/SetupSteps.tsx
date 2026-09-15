/**
 * One phone's worth of setup instructions.
 *
 * Both routes under the guide render this; only the data differs. The page is
 * static markup on purpose — no hooks, no auth, nothing to hydrate — because
 * it is opened from a text message on whatever signal the reader happens to
 * have, and the fastest version of this page is the one that is only HTML.
 */

import Link from "next/link";
import { HOME_SCREEN_NAME, TAGLINE } from "@/lib/brand";
import { ROUTES } from "@/lib/routes";
import { PLATFORMS, type PlatformKey } from "./platforms";
import styles from "./guide.module.css";

export default function SetupSteps({ platform }: { platform: PlatformKey }) {
  const { kicker, intro, steps } = PLATFORMS[platform];

  return (
    <main className={styles.page}>
      <Link href={ROUTES.setupGuide} className={styles.backLink}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Back
      </Link>

      <header className={styles.head}>
        <p className={styles.wordmark}>{HOME_SCREEN_NAME}</p>
        <p className={styles.kicker}>{kicker}</p>
        <h1 className={styles.title}>Add {HOME_SCREEN_NAME} to your home screen</h1>
        <p className={styles.sub}>{intro}</p>
      </header>

      <ol className={styles.steps}>
        {steps.map((step, i) => (
          <li key={step.title} className={styles.step}>
            <span className={styles.stepNo} aria-hidden="true">{i + 1}</span>
            <div className={styles.stepBody}>
              <p className={styles.stepTitle}>{step.title}</p>
              <p className={styles.stepText}>{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      {/* Said here as well as in step five: it is the one thing on the page a
          reader can get stuck on that no instruction of ours can fix. */}
      <p className={styles.note}>
        Your username and password are in the same message as this link. If you
        cannot find them, ask your manager.
      </p>

      <footer className={styles.footer}>
        <span className={styles.footerRule} aria-hidden="true" />
        <p className={styles.tagline}>{TAGLINE}</p>
      </footer>
    </main>
  );
}
