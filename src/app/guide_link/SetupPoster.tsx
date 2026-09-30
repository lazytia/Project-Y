/**
 * One phone's worth of setup instructions, delivered as a single drawn page.
 *
 * The owner designs these as artwork rather than as markup, so the page is the
 * artwork: there is nothing here to lay out except the image, the way back,
 * and the one line that is deliberately not part of the picture.
 *
 * `next/image` rather than a bare `<img>` is not a style preference. The source
 * files are ~1.5MB PNGs, and this page is opened from a text message on
 * whatever signal the reader happens to have while standing in a doorway. The
 * optimiser re-encodes to WebP/AVIF and serves a width that matches the device
 * instead of the export, which is the difference between this page and a blank
 * screen with a spinner on it. The static import is what makes that possible
 * and also carries the intrinsic size, so no dimensions are written down here
 * to drift the next time the artwork is re-exported.
 */

import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import { SETUP_GUIDE_CHOOSER } from "@/lib/routes";
import styles from "./guide.module.css";

export default function SetupPoster({
  poster,
  alt,
}: {
  poster: StaticImageData;
  /** Everything the picture says, for a reader who cannot see it. */
  alt: string;
}) {
  return (
    <main className={styles.posterPage}>
      {/* The chooser asked for by name. A plain link to it would be a trap:
          it recognises the phone and sends the reader straight back here. */}
      <Link href={SETUP_GUIDE_CHOOSER} className={styles.backLink}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Back
      </Link>

      <Image
        src={poster}
        alt={alt}
        className={styles.poster}
        /* The whole page is this one image, so it is the largest paint by
           definition — there is nothing for it to be deprioritised behind. */
        priority
        placeholder="blur"
        sizes="(max-width: 520px) 100vw, 480px"
      />

      {/* Kept as real text, outside the picture, because it is the one thing a
          reader can get stuck on that no instruction of ours can fix — and the
          one line they may need to select, or have read aloud. */}
      <p className={styles.note}>
        Your username and password are in the same message as this link. If you
        cannot find them, ask your manager.
      </p>
    </main>
  );
}
