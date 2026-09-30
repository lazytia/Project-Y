"use client";

/**
 * The two cards on the chooser, and the one of them that can do the job itself.
 *
 * On an Android phone the app can be installed from right here: Chrome hands
 * the page a `beforeinstallprompt`, and one tap on it puts the icon on the home
 * screen. When that is true the Android card stops being a link to a page of
 * instructions — a picture of a menu, followed by four steps describing how to
 * reach the very button we are already holding — and becomes the button.
 *
 * It only makes that offer while it can keep it. The prompt is the whole
 * mechanism, and Chrome withholds it when the app is already installed on the
 * profile, when the install prompt was dismissed recently, and always in
 * incognito. With nothing in hand the card stays a link to the guide, because a
 * card labelled Install that installs nothing is worse than the guide it
 * replaced.
 *
 * Both halves of that condition are load-bearing. The prompt alone is not
 * enough: desktop Chrome fires it too, and a desktop reader who pressed "I use
 * Android" is asking what to do on the phone in their other hand, not for this
 * laptop to grow an app. So the device has to say Android as well.
 *
 * iPhone has no equivalent and is not waiting for one. Safari has no install
 * API at all; Add to Home Screen is a menu item the reader has to find, which
 * is exactly what that card's guide is for.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ROUTES } from "@/lib/routes";
import { detectGuidePlatform, type GuidePlatform } from "@/lib/pwa-display";
import { useInstallPrompt } from "@/lib/use-install-prompt";
import { AndroidMark, AppleMark, PLATFORMS, PLATFORM_KEYS } from "./platforms";
import styles from "./guide.module.css";

const MARKS = {
  iphone: { Mark: AppleMark, className: styles.markApple },
  android: { Mark: AndroidMark, className: styles.markAndroid },
} as const;

/** Stands where the browser name stands, because it is the same line answering
 *  the same question: what happens when you press this. "Chrome" is the answer
 *  when pressing it opens instructions for Chrome; once pressing it installs,
 *  the honest answer is Install. */
const INSTALL_LABEL = "Install";

export default function PlatformChoices() {
  const [device, setDevice] = useState<GuidePlatform | null>(null);
  const { installPrompt, install } = useInstallPrompt();

  // Client-only, and deliberately left out of the first render rather than
  // guessed at: the server cannot know, and the fallback — a link to the
  // guide — is the right thing to have been showing if it turns out this is
  // not a phone we can install on.
  useEffect(() => setDevice(detectGuidePlatform()), []);

  // Spending the prompt drops it, so the card returns to being a link to the
  // guide. That is the right place to land either way: the guide's last step
  // is opening the new icon and logging in.
  const canInstallHere = device === "android" && installPrompt !== null;

  return (
    <div className={styles.choices}>
      {PLATFORM_KEYS.map((key) => {
        const platform = PLATFORMS[key];
        const { Mark, className } = MARKS[key];
        const installs = key === "android" && canInstallHere;
        const face = (
          <>
            <span className={`${styles.choiceMark} ${className}`}>
              <Mark />
            </span>
            <span className={styles.choiceLabel}>{platform.choice}</span>
            <span className={styles.choiceBrowser}>
              {installs ? INSTALL_LABEL : platform.browser}
            </span>
            <span className={styles.choiceGo} aria-hidden="true">
              &rarr;
            </span>
          </>
        );

        return installs ? (
          <button key={key} type="button" className={styles.choice} onClick={install}>
            {face}
          </button>
        ) : (
          <Link
            key={key}
            href={`${ROUTES.setupGuide}/${platform.slug}`}
            className={styles.choice}
          >
            {face}
          </Link>
        );
      })}
    </div>
  );
}
