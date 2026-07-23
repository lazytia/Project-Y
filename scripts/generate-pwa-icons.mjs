/**
 * PWA icons — boot-splash mark on full black: #111 canvas + centered white Y.
 * Run: node scripts/generate-pwa-icons.mjs
 */
import sharp from "sharp";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const appIcon = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "app", "icon.png");

const BG = "#111111";
const MARK = "#ffffff";

/** Geometric Y tuned to match bootSplashMark proportions. */
function yMarkPath(box) {
  const s = box / 512;
  return `
    M ${(156 * s).toFixed(2)} ${(118 * s).toFixed(2)}
    L ${(256 * s).toFixed(2)} ${(292 * s).toFixed(2)}
    L ${(356 * s).toFixed(2)} ${(118 * s).toFixed(2)}
    L ${(318 * s).toFixed(2)} ${(118 * s).toFixed(2)}
    L ${(256 * s).toFixed(2)} ${(228 * s).toFixed(2)}
    L ${(194 * s).toFixed(2)} ${(118 * s).toFixed(2)} Z
    M ${(232 * s).toFixed(2)} ${(228 * s).toFixed(2)}
    L ${(232 * s).toFixed(2)} ${(394 * s).toFixed(2)}
    L ${(280 * s).toFixed(2)} ${(394 * s).toFixed(2)}
    L ${(280 * s).toFixed(2)} ${(228 * s).toFixed(2)} Z
  `.trim();
}

function iconSvg(size, { maskable = false } = {}) {
  const pad = maskable ? Math.round(size * 0.14) : Math.round(size * 0.19);
  const inner = size - pad * 2;

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <svg x="${pad}" y="${pad}" width="${inner}" height="${inner}" viewBox="0 0 ${inner} ${inner}">
    <path d="${yMarkPath(inner)}" fill="${MARK}"/>
  </svg>
</svg>`);
}

async function writeIcon(name, size, opts) {
  const out = join(root, name);
  await sharp(iconSvg(size, opts)).png({ compressionLevel: 9 }).toFile(out);
  console.log("wrote", name);
}

await writeIcon("icon-192.png", 192);
await writeIcon("icon-512.png", 512);
await writeIcon("apple-touch-icon.png", 180);
await writeIcon("icon-maskable-512.png", 512, { maskable: true });

writeFileSync(join(root, "favicon.ico"), await sharp(iconSvg(32)).png().toBuffer());
console.log("wrote favicon.ico");

await sharp(iconSvg(512)).png({ compressionLevel: 9 }).toFile(appIcon);
console.log("wrote src/app/icon.png");
