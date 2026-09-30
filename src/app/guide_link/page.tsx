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
 *
 * Except on an Android phone that has handed us an install prompt, where the
 * answer to the question is worth less than the install itself and the card
 * does it on the spot — see PlatformChoices.
 *
 * On a phone it does not wait to be asked: PlatformRedirect recognises the
 * device and moves on. The markup below is still rendered in full, because it
 * is what a desktop reader, an unrecognised device and a reader with no
 * JavaScript get — and because `?choose=1` asks for it on purpose.
 */

import type { Metadata } from "next";
import { APP_NAME, HOME_SCREEN_NAME } from "@/lib/brand";
import { GUIDE_CHOOSE_PARAM } from "@/lib/routes";
import PlatformChoices from "./PlatformChoices";
import PlatformRedirect from "./PlatformRedirect";
import styles from "./guide.module.css";

export const metadata: Metadata = {
  title: `Set up ${APP_NAME}`,
  description: "Get your roster, payslips and important staff updates.",
};

export default async function SetupGuidePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const asked = Boolean((await searchParams)[GUIDE_CHOOSE_PARAM]);

  return (
    <main className={styles.page}>
      {!asked && <PlatformRedirect />}

      <header className={styles.head}>
        <p className={styles.wordmark}>{HOME_SCREEN_NAME}</p>
        <p className={styles.kicker}>Setup guide</p>
        <h1 className={styles.title}>Set up {APP_NAME}</h1>
        <p className={styles.sub}>
          Get your roster, payslips and important staff updates.
        </p>
      </header>

      <PlatformChoices />

      <p className={styles.hint}>Choose your phone type to see the setup guide.</p>
    </main>
  );
}
