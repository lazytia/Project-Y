/**
 * iOS launch screens — the boot splash's brand block, baked to PNG.
 *
 * iOS paints one of these before any of the app's HTML runs, then replaces it
 * with the real boot splash the moment the document paints. Both draw the same
 * thing, so the handover is invisible only if the logo lands on the same pixel
 * at the same size. It used to miss on both counts: the artwork was one square
 * SVG scaled to 60% of the screen *width*, which made the logo grow with the
 * device (60px on an SE, 192px on an iPad) while the boot splash's logo is a
 * fixed 72px — and it was centred on the whole canvas, while the boot splash
 * centres a column that also carries the status line and the dots, which lifts
 * the logo well above the middle. The result was a logo that hopped up and
 * shrank as the app opened.
 *
 * So the layout here is done in CSS pixels, not in artwork units: each screen
 * is drawn at its cssWidth x cssHeight from src/lib/splash-screens.json, using
 * the same numbers as the .bootSplash* rules, and only then rendered at the
 * device's pixel ratio. Nothing scales with screen size except the canvas.
 *
 * Run: node scripts/generate-splash.mjs
 */
import sharp from "sharp";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const splashDir = join(root, "public", "splash");

const { screens, geometry } = JSON.parse(
  readFileSync(join(root, "src", "lib", "splash-screens.json"), "utf8"),
);

// Read rather than repeat. The wordmark under the mark is the one string that
// has to say exactly what the boot splash says a moment later, and it has
// already shipped wrong twice by being copied. brand.ts is the source; a regex
// is the only way a .mjs can reach a .ts, and it fails loudly if the shape of
// the declaration changes.
const brandSrc = readFileSync(join(root, "src", "lib", "brand.ts"), "utf8");
const wordMatch = /HOME_SCREEN_NAME\s*=\s*"([^"]+)"/.exec(brandSrc);
if (!wordMatch) {
  throw new Error("could not read HOME_SCREEN_NAME out of src/lib/brand.ts");
}
const WORD = wordMatch[1];

const {
  background,
  foreground,
  logoSize,
  logoRadius,
  markFontFamily,
  markFontSize,
  markFontWeight,
  markLetterSpacing,
  markColor,
  markFontAscent,
  markFontDescent,
  gap,
  wordFontFamily,
  wordFontSize,
  wordFontWeight,
  wordLetterSpacing,
  wordFontAscent,
  wordFontDescent,
} = geometry;

/**
 * The height of .bootSplashBrand: the logo box, the flex gap, and the word's
 * line box. The word is `line-height: 1`, so its box is exactly its font size
 * — that is the whole reason the rule sets it, and why this can be a sum.
 */
const BLOCK_HEIGHT = logoSize + gap + wordFontSize;

/**
 * Where a browser puts the baseline inside a line box of `height`, for text of
 * `fontSize`.
 *
 * SVG positions text by its baseline; CSS positions it by a box, and the two
 * differ by an offset that belongs to the typeface, not to the layout. The
 * font's ascent and descent usually add up to more than one em, so a
 * `line-height: 1` box is *smaller* than the text it holds and the overflow is
 * split evenly above and below — that is the half-leading. Get this wrong and
 * the glyph sits a couple of pixels off where the stylesheet puts it, which is
 * exactly the sort of thing that reads as a flicker rather than as an error.
 *
 * The ascent and descent are per face, and Arial Black is not Arial with a
 * heavier pen: its ascent is a whole em and a bit (2100/2048 against Arial's
 * 1854/2048), so sharing one pair of numbers between the mark and the word put
 * the Y two pixels high inside its square. These were checked against what
 * Chrome actually reports for a `line-height: 1` box — the mark's baseline
 * lands 36.0px into a 40px box and the word's 13.5px into a 16px one.
 */
function baselineIn(boxTop, boxHeight, fontSize, ascent, descent) {
  const halfLeading = (boxHeight - fontSize * (ascent + descent)) / 2;
  return boxTop + halfLeading + fontSize * ascent;
}

function splashSvg(cssWidth, cssHeight) {
  // .bootSplash centres .bootSplashBrand and nothing else — the status line
  // and the dots are taken out of flow precisely so they cannot shift it.
  const blockTop = (cssHeight - BLOCK_HEIGHT) / 2;
  const centreX = cssWidth / 2;

  // The mark's line box is markFontSize tall, centred in the logo square by
  // the square's own `align-items: center`.
  const markBaseline = baselineIn(
    blockTop + (logoSize - markFontSize) / 2,
    markFontSize,
    markFontSize,
    markFontAscent,
    markFontDescent,
  );
  const wordBaseline = baselineIn(
    blockTop + logoSize + gap,
    wordFontSize,
    wordFontSize,
    wordFontAscent,
    wordFontDescent,
  );

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cssWidth}" height="${cssHeight}" viewBox="0 0 ${cssWidth} ${cssHeight}">` +
      `<rect width="${cssWidth}" height="${cssHeight}" fill="${background}"/>` +
      `<rect x="${centreX - logoSize / 2}" y="${blockTop}" width="${logoSize}" height="${logoSize}" rx="${logoRadius}" fill="${foreground}"/>` +
      `<text x="${centreX}" y="${markBaseline}" text-anchor="middle"` +
      ` font-family="${markFontFamily}" font-weight="${markFontWeight}"` +
      ` font-size="${markFontSize}" letter-spacing="${markLetterSpacing}"` +
      ` fill="${markColor}">Y</text>` +
      `<text x="${centreX}" y="${wordBaseline}" text-anchor="middle"` +
      ` font-family="${wordFontFamily}" font-weight="${wordFontWeight}"` +
      ` font-size="${wordFontSize}" letter-spacing="${wordLetterSpacing}"` +
      ` fill="${foreground}">${WORD}</text>` +
      `</svg>`,
  );
}

for (const { file, cssWidth, cssHeight, scale } of screens) {
  const pixelWidth = cssWidth * scale;
  const pixelHeight = cssHeight * scale;

  // The file name carries the pixel size, so it is a free check that the CSS
  // size and the ratio next to it are the ones this device actually reports.
  const named = /^apple-splash-(\d+)-(\d+)\.png$/.exec(file);
  if (!named) throw new Error(`unexpected launch screen name: ${file}`);
  if (Number(named[1]) !== pixelWidth || Number(named[2]) !== pixelHeight) {
    throw new Error(
      `${file}: ${cssWidth}x${cssHeight} at ${scale}x is ${pixelWidth}x${pixelHeight}`,
    );
  }

  // 96 dpi is one SVG unit per pixel, so the density *is* the pixel ratio —
  // the artwork is described once in CSS pixels and rasterised per device.
  await sharp(splashSvg(cssWidth, cssHeight), { density: 96 * scale })
    .resize(pixelWidth, pixelHeight)
    .flatten({ background })
    .png({ compressionLevel: 9 })
    .toFile(join(splashDir, file));

  console.log(`wrote ${file}  ${cssWidth}x${cssHeight} @${scale}x`);
}

console.log(`${screens.length} launch screens regenerated`);
