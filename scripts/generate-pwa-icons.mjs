/**
 * Generates PWA icons from the boot-splash mark: black canvas + white Y.
 * Run: node scripts/generate-pwa-icons.mjs
 */
import sharp from "sharp";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

function iconSvg(size, { maskable = false } = {}) {
  const pad = maskable ? Math.round(size * 0.1) : 0;
  const inner = size - pad * 2;
  const markSize = Math.round(inner * 0.42);
  const y = pad + inner * 0.56;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#111111"/>
  <text x="${size / 2}" y="${y}"
        text-anchor="middle"
        font-family="Arial Black, Arial, sans-serif"
        font-weight="900"
        font-size="${markSize}"
        fill="#ffffff">Y</text>
</svg>`);
}

async function writeIcon(name, size, opts) {
  const out = join(root, name);
  await sharp(iconSvg(size, opts)).png().toFile(out);
  console.log("wrote", name);
}

await writeIcon("icon-192.png", 192);
await writeIcon("icon-512.png", 512);
await writeIcon("apple-touch-icon.png", 180);
await writeIcon("icon-maskable-512.png", 512, { maskable: true });

writeFileSync(
  join(root, "favicon.ico"),
  await sharp(iconSvg(32)).png().toBuffer(),
);
console.log("wrote favicon.ico");
