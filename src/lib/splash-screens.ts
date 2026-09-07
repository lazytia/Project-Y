/**
 * The iOS launch screens, and the geometry they are drawn to.
 *
 * iOS paints one of these PNGs before a single line of the app's HTML runs,
 * and swaps it for the boot splash the instant the document paints. The two
 * are drawn by completely different renderers, so the only thing that stops
 * the logo from visibly hopping across that handover is both of them putting
 * it in the same place at the same size. That is what this file is for.
 *
 * The data lives in splash-screens.json rather than here because
 * scripts/generate-splash.mjs has to read it too, and Node cannot import a
 * .ts module. Three things depend on it staying one list:
 *
 *   - RootLayout emits an <link rel="apple-touch-startup-image"> per screen.
 *     A file with no entry is never served; an entry with no file is a device
 *     that launches to a blank white screen.
 *   - scripts/generate-splash.mjs draws each PNG at cssWidth x cssHeight and
 *     renders it at `scale` device pixels per CSS pixel. The whole point of
 *     carrying the CSS size rather than the pixel size is that the artwork can
 *     then be laid out in the same units as the stylesheet.
 *   - `geometry` mirrors the .bootSplash* rules. Those exist in two hand-kept
 *     copies already (globals.css and the inline critical CSS in layout.tsx);
 *     this is the third, and it is the one that decides what iOS paints first.
 *     Change one, change all three, then re-run the generator.
 */
import data from "./splash-screens.json";

export type SplashScreen = {
  /** File name under public/splash. */
  file: string;
  /** Portrait CSS width the device reports — matched by the media query. */
  cssWidth: number;
  /** Portrait CSS height the device reports — matched by the media query. */
  cssHeight: number;
  /** Device pixel ratio; cssWidth * scale is the PNG's pixel width. */
  scale: number;
};

export const SPLASH_SCREENS: readonly SplashScreen[] = data.screens;

/**
 * The media query iOS matches a launch image on. Portrait only — landscape
 * launches fall back to the plain background, which is what the boot splash
 * paints anyway, so there is nothing to mismatch.
 */
export function splashMediaQuery({ cssWidth, cssHeight, scale }: SplashScreen): string {
  return (
    `(device-width: ${cssWidth}px) and (device-height: ${cssHeight}px) and ` +
    `(-webkit-device-pixel-ratio: ${scale}) and (orientation: portrait)`
  );
}
