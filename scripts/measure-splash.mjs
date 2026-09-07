/**
 * Checks that the baked launch screens land where the boot splash does.
 *
 * The failure this guards against is not a crash, it is a flicker: iOS shows
 * public/splash/*.png first and the .bootSplash* markup a moment later, and if
 * the logo is a few pixels or a few percent off between the two, the app looks
 * like it flinches as it opens. Nothing in the build can notice that, and on a
 * phone it is over before you can point at it — so it gets measured here.
 *
 * Ink is what gets measured, not metrics. Where a browser puts a glyph inside
 * its line box is a property of the typeface, and guessing it is how a gap ends
 * up a few units off what the source says it is; so this reads the rendered
 * pixels back and compares them against the geometry in
 * src/lib/splash-screens.json, in CSS pixels.
 *
 * Run: node scripts/measure-splash.mjs   (after scripts/generate-splash.mjs)
 */
import sharp from "sharp";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const splashDir = join(root, "public", "splash");

const { screens, geometry } = JSON.parse(
  readFileSync(join(root, "src", "lib", "splash-screens.json"), "utf8"),
);
const { logoSize, gap, wordFontSize } = geometry;
const BLOCK_HEIGHT = logoSize + gap + wordFontSize;

/** Anything darker than this counts as ink on the white background. */
const INK = 128;
/** Rasterising rounded corners and glyph edges costs about a pixel either way. */
const TOLERANCE = 1;

/**
 * The runs of rows that contain ink — the mark, then the word — with each
 * one's own horizontal extent, all in CSS pixels.
 *
 * Per band, not per image: the logo is the widest thing on the canvas, so a
 * single extent for the whole picture would be the logo's every time and the
 * word's centring would go unchecked.
 */
async function measure(file, scale) {
  const { data, info } = await sharp(join(splashDir, file))
    .flatten({ background: "#ffffff" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rows = [];
  for (let y = 0; y < info.height; y++) {
    let left = info.width;
    let right = -1;
    for (let x = 0; x < info.width; x++) {
      if (data[y * info.width + x] < INK) {
        if (x < left) left = x;
        right = x;
      }
    }
    rows.push(right < 0 ? null : { left, right });
  }

  const bands = [];
  let band = null;
  for (let y = 0; y <= info.height; y++) {
    const row = rows[y] ?? null;
    if (row && !band) band = { top: y, bottom: y, left: row.left, right: row.right };
    else if (row) {
      band.bottom = y;
      band.left = Math.min(band.left, row.left);
      band.right = Math.max(band.right, row.right);
    } else if (band) {
      bands.push({
        top: band.top / scale,
        bottom: (band.bottom + 1) / scale,
        left: band.left / scale,
        right: (band.right + 1) / scale,
      });
      band = null;
    }
  }

  return bands;
}

const failures = [];

function expect(file, what, actual, wanted) {
  const off = Math.abs(actual - wanted);
  const ok = off <= TOLERANCE;
  if (!ok) failures.push(`${file}: ${what} is ${actual.toFixed(2)}, expected ${wanted.toFixed(2)}`);
  return `${ok ? "ok  " : "BAD "} ${what.padEnd(24)} ${actual.toFixed(2).padStart(8)}  want ${wanted.toFixed(2)}`;
}

for (const { file, cssWidth, cssHeight, scale } of screens) {
  const bands = await measure(file, scale);
  console.log(`\n${file}  ${cssWidth}x${cssHeight} @${scale}x`);

  if (bands.length !== 2) {
    failures.push(`${file}: expected 2 bands of ink (mark, word), found ${bands.length}`);
    continue;
  }

  const [logo, word] = bands;
  // .bootSplash centres .bootSplashBrand alone; the status line and the dots
  // are out of flow, so the block's own centre is the screen's centre.
  const blockTop = (cssHeight - BLOCK_HEIGHT) / 2;

  console.log(" ", expect(file, "logo top", logo.top, blockTop));
  console.log(" ", expect(file, "logo height", logo.bottom - logo.top, logoSize));
  console.log(" ", expect(file, "logo width", logo.right - logo.left, logoSize));
  console.log(" ", expect(file, "logo centred on x", (logo.left + logo.right) / 2, cssWidth / 2));
  console.log(" ", expect(file, "word centred on x", (word.left + word.right) / 2, cssWidth / 2));
  // The word's ink is its cap height, sitting inside a line box of
  // wordFontSize — so it starts below the box's top and ends above its bottom.
  const spill = Math.max(
    0,
    blockTop + logoSize + gap - word.top,
    word.bottom - (blockTop + BLOCK_HEIGHT),
  );
  console.log(" ", expect(file, "word outside line box", spill, 0));
  console.log(`  --  white under the logo: ${(word.top - logo.bottom).toFixed(2)}`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} problem(s):`);
  for (const line of failures) console.error(`  ${line}`);
  process.exit(1);
}
console.log("\nall launch screens match the boot splash geometry");
