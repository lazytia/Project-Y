/**
 * What the app calls itself.
 *
 * It has been "Project Y" and is now "Project YURICA", which is reason enough
 * not to spell it out in the places where a mismatch is a real defect rather
 * than a typo: the splash wordmark has to match the window title or the app
 * appears to change identity while it boots.
 *
 * Running prose is deliberately left as prose. A sentence like "log in to
 * Project YURICA" reads as copy, and a translator working through the
 * Japanese table should not have to know this constant exists.
 */
export const APP_NAME = "Project YURICA";

/**
 * What the icon says under it once the app is on a home screen.
 *
 * Deliberately shorter than APP_NAME. iOS gives a home-screen label around
 * twelve characters before it elides, so "Project YURICA" would sit there as
 * "Project YU…" — the half of the name that says nothing about who it belongs
 * to. Dropping "Project" keeps the word that matters.
 *
 * The two places that set this are not interchangeable: Android reads
 * `short_name` from the manifest, iOS prefers the `apple-mobile-web-app-title`
 * meta tag. Both have to carry this value or the same phone shows one name and
 * the other shows another.
 *
 * It also names the entry under iPhone Settings > Notifications, which is why
 * the login screen's "notifications are blocked" instructions point at this
 * and not at APP_NAME — an instruction that names a row the user cannot find
 * is worse than no instruction.
 */
export const HOME_SCREEN_NAME = "YURICA";
