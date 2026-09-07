/**
 * What the app calls itself.
 *
 * It has been "Project Y" and is now "Project YURICA", which is reason enough
 * not to spell it out anywhere a mismatch would be a real defect rather than a
 * typo — the window title, the manifest and the login heading all have to move
 * together or the app appears to change identity between one screen and the
 * next.
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
 *
 * The splash uses it too, so the name under the mark is the same one that sits
 * under the icon the user just tapped. That the boot splash therefore says
 * something shorter than the window title behind it is deliberate; a wordmark
 * is not a sentence and does not have to spell out the whole name.
 */
export const HOME_SCREEN_NAME = "YURICA";
