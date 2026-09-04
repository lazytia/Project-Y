/**
 * What the app calls itself.
 *
 * It has been "Project Y" and is now "Project YURICA", which is reason enough
 * not to spell it out in the places where a mismatch is a real defect rather
 * than a typo: the manifest name and the two Apple meta tags have to agree or
 * iOS shows one name on the home screen and another in Settings, and the
 * splash wordmark has to match the manifest or the app appears to change
 * identity while it boots.
 *
 * Running prose is deliberately left as prose. A sentence like "log in to
 * Project YURICA" reads as copy, and a translator working through the
 * Japanese table should not have to know this constant exists.
 */
export const APP_NAME = "Project YURICA";
