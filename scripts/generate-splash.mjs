/**
 * iOS launch screens — public/splash-logo.svg centered on a white canvas.
 *
 * iOS paints these PNGs before a single line of the app's HTML runs, so they
 * are the first thing anyone sees and nothing in the codebase can correct them
 * afterwards. That is what makes them worth generating rather than drawing:
 * the wordmark baked in here has to say exactly what the boot splash says a
 * moment later, or the app appears to rename itself while it opens.
 *
 * The sizes are read from the files already in public/splash rather than
 * listed here. Every one of them is also named in a <link
 * rel="apple-touch-startup-image"> tag in layout.tsx, and a size that exists
 * in one place but not the other is a device that falls back to a blank
 * screen — so the directory stays the single list and this script just
 * refreshes what it finds.
 *
 * Run: node scripts/generate-splash.mjs
 */
import sharp from "sharp";
import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const splashDir = join(here, "..", "public", "splash");
const logoPath = join(here, "..", "public", "splash-logo.svg");

/** Matches the launch screens shipped before this script existed. */
const BG = "#ffffff";
const LOGO_WIDTH_RATIO = 0.6;

const logo = readFileSync(logoPath);

const targets = readdirSync(splashDir)
  .map((name) => {
    const match = /^apple-splash-(\d+)-(\d+)\.png$/.exec(name);
    return match
      ? { name, width: Number(match[1]), height: Number(match[2]) }
      : null;
  })
  .filter(Boolean)
  .sort((a, b) => a.width - b.width || a.height - b.height);

if (targets.length === 0) {
  throw new Error(`no apple-splash-<w>-<h>.png files found in ${splashDir}`);
}

for (const { name, width, height } of targets) {
  // Scaled off width alone: these are all portrait, so width is the dimension
  // that decides whether the mark looks cramped, and tying it to the shorter
  // side keeps the logo the same physical size across every device.
  const logoSize = Math.round(width * LOGO_WIDTH_RATIO);
  const rendered = await sharp(logo, { density: 384 })
    .resize(logoSize, logoSize)
    .png()
    .toBuffer();

  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: BG,
    },
  })
    .composite([
      {
        input: rendered,
        left: Math.round((width - logoSize) / 2),
        top: Math.round((height - logoSize) / 2),
      },
    ])
    .png({ compressionLevel: 9 })
    .toFile(join(splashDir, name));

  console.log("wrote", name);
}

console.log(`${targets.length} launch screens regenerated`);
