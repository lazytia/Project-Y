/**
 * Prints the white space between the bands of ink in public/splash-logo.svg.
 *
 * The splash puts the logo, "Project" and "YURICA" in a column with the same
 * air between each, and the baselines that produce that are not round numbers
 * — "Project" hangs a "j" below its baseline and "YURICA" has nothing below
 * its own, so evenly spaced baselines look unevenly spaced. Rather than trust
 * font metrics, this renders the file and measures the result.
 *
 * Both gaps should read 30. If you move any text in splash-logo.svg, run this,
 * nudge the baselines until they match again, then regenerate the launch
 * screens with scripts/generate-splash.mjs.
 *
 * Run: node scripts/measure-splash.mjs
 */
import sharp from "sharp";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const logoPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "splash-logo.svg",
);

/** The SVG is 512 units wide; supersample so band edges land inside a unit. */
const VIEWBOX = 512;
const SAMPLE = 4;
const INK = 128;

const { data, info } = await sharp(readFileSync(logoPath), {
  density: 96 * SAMPLE,
})
  .resize(VIEWBOX * SAMPLE, VIEWBOX * SAMPLE)
  .flatten({ background: "#ffffff" })
  .greyscale()
  .raw()
  .toBuffer({ resolveWithObject: true });

// A band is a run of rows that contain at least one dark pixel — the logo, then
// each word. Measuring ink rather than baselines is the whole point: ink is
// what the eye spaces things by.
const bands = [];
let start = null;
for (let y = 0; y < info.height; y++) {
  let inked = false;
  for (let x = 0; x < info.width && !inked; x++) {
    if (data[y * info.width + x] < INK) inked = true;
  }
  if (inked && start === null) start = y;
  if (!inked && start !== null) {
    bands.push([start / SAMPLE, (y - 1) / SAMPLE]);
    start = null;
  }
}
if (start !== null) bands.push([start / SAMPLE, (info.height - 1) / SAMPLE]);

for (const [top, bottom] of bands) {
  console.log(`band  top ${top.toFixed(2)}  bottom ${bottom.toFixed(2)}`);
}
for (let i = 1; i < bands.length; i++) {
  console.log(`gap ${i}: ${(bands[i][0] - bands[i - 1][1]).toFixed(2)}`);
}
