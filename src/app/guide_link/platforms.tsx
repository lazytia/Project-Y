/**
 * The two phones a new employee turns up with, and how each one installs the app.
 *
 * Kept as data rather than two hand-written pages because the steps differ in
 * four words and a menu name. Written out separately anyway — not merged into
 * one page with "on Android, tap…" asides — because the person reading this is
 * standing in a doorway holding one phone, and every instruction that is not
 * about the phone in their hand is something to read past.
 *
 * The marks are drawn here rather than pulled from an icon set: these are two
 * SVGs, and a dependency that ships several hundred is not worth carrying for
 * a page most people open once.
 */

export const PLATFORM_KEYS = ["iphone", "android"] as const;

export type PlatformKey = (typeof PLATFORM_KEYS)[number];

export type SetupStep = {
  title: string;
  body: string;
};

export type Platform = {
  /** Path segment under the setup guide. */
  slug: PlatformKey;
  /** How the chooser names it — phrased as the reader, not as the device. */
  choice: string;
  /** The browser that can actually do the install, named on the card. */
  browser: string;
  /** Kicker above the steps. */
  kicker: string;
  intro: string;
  steps: readonly SetupStep[];
};

/* ── marks ── */

export function AppleMark() {
  return (
    <svg width="46" height="46" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {/* Two lobes meeting in a notch, and the arc on the right edge is the
          bite — without it this is a tomato. */}
      <path d="M11.9 7.4C12.9 6.6 14.1 6.4 15.1 6.7C16 6.95 16.75 7.6 17.3 8.6A2.3 2.3 0 0 0 17.3 13C17 14.5 16.4 15.9 15.6 16.95C14.9 17.9 14.2 18.6 13.4 18.6C12.7 18.6 12.35 18.15 11.75 18.15C11.15 18.15 10.75 18.6 10.05 18.6C9.25 18.6 8.5 17.85 7.8 16.85C6.6 15.15 5.8 12.8 5.8 10.7C5.8 8.25 7.45 6.7 9.3 6.7C10.25 6.7 11.15 7.05 11.9 7.4Z" />
      <path d="M12.2 7C12 5.4 13.3 3.8 15.4 3.3C15.7 5.1 14.6 6.8 12.2 7Z" />
    </svg>
  );
}

export function AndroidMark() {
  return (
    <svg width="46" height="46" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {/* antennae */}
      <path
        d="M8 5.2 6.9 3.4M16 5.2l1.1-1.8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        fill="none"
      />
      {/* head, flat side down */}
      <path d="M5.6 9.4a6.4 6.4 0 0 1 12.8 0z" />
      <circle cx="9.1" cy="7.3" r=".85" fill="var(--color-bg)" />
      <circle cx="14.9" cy="7.3" r=".85" fill="var(--color-bg)" />
      {/* body */}
      <path d="M5.6 10.6h12.8v6.6a1.4 1.4 0 0 1-1.4 1.4H7a1.4 1.4 0 0 1-1.4-1.4z" />
      {/* arms */}
      <rect x="2.1" y="10.6" width="2.4" height="7" rx="1.2" />
      <rect x="19.5" y="10.6" width="2.4" height="7" rx="1.2" />
      {/* legs */}
      <rect x="8.2" y="18.4" width="2.4" height="4.4" rx="1.2" />
      <rect x="13.4" y="18.4" width="2.4" height="4.4" rx="1.2" />
    </svg>
  );
}

/* ── the steps ── */

/**
 * Step one is "open it in the right browser" on both phones, and it is there
 * because a link tapped inside Messages or Instagram opens in that app's own
 * browser, which has no Add to Home Screen at all. Somebody following the rest
 * of the list in one of those will simply never find the button.
 */
export const PLATFORMS: Record<PlatformKey, Platform> = {
  iphone: {
    slug: "iphone",
    choice: "I use iPhone",
    browser: "Safari",
    kicker: "iPhone · Safari",
    intro: "Five steps, about a minute.",
    steps: [
      {
        title: "Open this page in Safari",
        body: "If you opened the link inside another app, tap the arrow or the dots at the top and choose Open in Safari. The next steps only work there.",
      },
      {
        title: "Tap the Share button",
        body: "The square with an arrow coming out of it, at the bottom of the screen.",
      },
      {
        title: "Choose Add to Home Screen",
        body: "Scroll down the list of options until you see it.",
      },
      {
        title: "Tap Add",
        body: "Top right. The icon then appears on your home screen with your other apps.",
      },
      {
        title: "Open it and log in",
        body: "Use the username and password from your welcome message, and tap Allow when it asks about notifications — that is how you are told about shift changes.",
      },
    ],
  },
  android: {
    slug: "android",
    choice: "I use Android",
    browser: "Chrome",
    kicker: "Android · Chrome",
    intro: "Five steps, about a minute.",
    steps: [
      {
        title: "Open this page in Chrome",
        body: "If you opened the link inside another app, tap the dots at the top and choose Open in Chrome. The next steps only work there.",
      },
      {
        title: "Tap the menu button",
        body: "The three dots in the top right corner.",
      },
      {
        title: "Choose Add to Home screen",
        body: "Some phones call it Install app. Either one is the right option.",
      },
      {
        title: "Tap Install",
        body: "The icon then appears on your home screen with your other apps.",
      },
      {
        title: "Open it and log in",
        body: "Use the username and password from your welcome message, and tap Allow when it asks about notifications — that is how you are told about shift changes.",
      },
    ],
  },
};
