/**
 * The setup guide — the link in a new employee's welcome text.
 *
 * It is the only page in the app that is read by someone with no account yet,
 * which is why it sits outside the sign-in wall (see PUBLIC_ROUTE_PREFIXES in
 * lib/routes). Everything it says has to make sense to a person who has been
 * given a username, a password and no idea what any of it is for.
 *
 * All it does is ask which phone they have. Installing to a home screen is
 * genuinely different on the two, and a single page covering both would be a
 * page where half the sentences are for somebody else.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME, HOME_SCREEN_NAME, TAGLINE } from "@/lib/brand";
import { ROUTES } from "@/lib/routes";
import { AndroidMark, AppleMark, PLATFORMS, PLATFORM_KEYS } from "./platforms";
import styles from "./guide.module.css";

export const metadata: Metadata = {
  title: `Set up ${APP_NAME}`,
  description: "Get your roster, payslips and important staff updates.",
};

const MARKS = {
  iphone: { Mark: AppleMark, className: styles.markApple },
  android: { Mark: AndroidMark, className: styles.markAndroid },
} as const;

export default function SetupGuidePage() {
  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <p className={styles.wordmark}>{HOME_SCREEN_NAME}</p>
        <p className={styles.kicker}>Setup guide</p>
        <h1 className={styles.title}>Set up {APP_NAME}</h1>
        <p className={styles.sub}>
          Get your roster, payslips and important staff updates.
        </p>
      </header>

      <div className={styles.choices}>
        {PLATFORM_KEYS.map((key) => {
          const platform = PLATFORMS[key];
          const { Mark, className } = MARKS[key];
          return (
            <Link
              key={key}
              href={`${ROUTES.setupGuide}/${platform.slug}`}
              className={styles.choice}
            >
              <span className={`${styles.choiceMark} ${className}`}>
                <Mark />
              </span>
              <span className={styles.choiceLabel}>{platform.choice}</span>
              <span className={styles.choiceBrowser}>{platform.browser}</span>
              <span className={styles.choiceGo} aria-hidden="true">
                &rarr;
              </span>
            </Link>
          );
        })}
      </div>

      <p className={styles.hint}>Choose your phone type to see the setup guide.</p>

      <footer className={styles.footer}>
        <span className={styles.footerRule} aria-hidden="true" />
        <p className={styles.tagline}>{TAGLINE}</p>
      </footer>
    </main>
  );
}
