import type { Metadata } from "next";
import { HOME_SCREEN_NAME } from "@/lib/brand";
import { PUBLIC_ORIGIN } from "@/lib/routes";
/* See the note on the Android page: imported rather than referenced by URL so
   the optimiser can re-encode it and the intrinsic size comes from the file. */
import poster from "../../../../public/guide/iphone.png";
import SetupPoster, { type PosterLink } from "../SetupPoster";
import { PLATFORMS } from "../platforms";

export const metadata: Metadata = {
  title: `Add ${HOME_SCREEN_NAME} to your home screen — ${PLATFORMS.iphone.kicker}`,
};

/** What the picture says, for a reader who cannot see it. */
const ALT = `Installing ${HOME_SCREEN_NAME} on iPhone with Safari, in four steps. \
1. Open the link in Safari: go to project.yurica.com.au. \
2. Add to Home Screen, following these steps in Safari: tap the tab menu, the three dots, \
then Share, then View More, then Add to Home Screen. \
3. Open the YURICA icon: close Safari, then open Project YURICA from your Home Screen. \
This is important so notifications can be enabled. \
4. Allow notifications, then log in: tap Allow, then sign in and complete onboarding. \
After setup, you will receive roster, payslips and important staff updates.`;

/* The address drawn in step 1. Measured on iphone.png (941 x 1612): the text
   occupies x 152-429, y 345-372, so the centre is 290.5/941 by 358.5/1612 and
   it is 277/941 wide. Re-measure if the artwork is re-exported — see the note
   on PosterLink. */
const LINK: PosterLink = {
  href: PUBLIC_ORIGIN,
  label: `Open ${PUBLIC_ORIGIN.replace("https://", "")} in a new tab`,
  x: 290.5 / 941,
  y: 358.5 / 1612,
  width: 277 / 941,
};

export default function IPhoneSetupPage() {
  return <SetupPoster poster={poster} alt={ALT} link={LINK} />;
}
