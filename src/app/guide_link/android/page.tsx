import type { Metadata } from "next";
import { HOME_SCREEN_NAME } from "@/lib/brand";
import { PUBLIC_ORIGIN } from "@/lib/routes";
/* Imported rather than referenced by URL so the optimiser can re-encode and
   resize it, and so the intrinsic size comes from the file. Kept in public/
   because that is where the owner drops a re-export; nothing in src/ has to be
   touched to change the artwork. */
import poster from "../../../../public/guide/android.png";
import SetupPoster, { type PosterLink } from "../SetupPoster";
import { PLATFORMS } from "../platforms";

export const metadata: Metadata = {
  title: `Add ${HOME_SCREEN_NAME} to your home screen — ${PLATFORMS.android.kicker}`,
};

/** What the picture says, for a reader who cannot see it. */
const ALT = `Installing ${HOME_SCREEN_NAME} on Android, in six steps. \
1. Open the link: tap project.yurica.com.au to open Project YURICA in Chrome. \
2. Tap Menu: the three-dot menu in Chrome. \
3. Install and create shortcut: tap Install, then create shortcut. \
4. Open from Home Screen: close Chrome, then open the new YURICA icon from your Home Screen. \
5. Allow notifications: tap Allow to receive roster, payslip and important staff updates. \
6. Log in and complete onboarding, using the username and password sent to you.`;

/* The address drawn in step 1. Measured on android.png (1024 x 1469): the text
   occupies x 184-431, y 332-354, so the centre is 307.5/1024 by 343/1469 and
   it is 247/1024 wide. Re-measure if the artwork is re-exported — see the note
   on PosterLink. */
const LINK: PosterLink = {
  href: PUBLIC_ORIGIN,
  label: `Open ${PUBLIC_ORIGIN.replace("https://", "")} in a new tab`,
  x: 307.5 / 1024,
  y: 343 / 1469,
  width: 247 / 1024,
};

export default function AndroidSetupPage() {
  return <SetupPoster poster={poster} alt={ALT} link={LINK} />;
}
