/**
 * Generates PWA icons — boot-splash mark: white canvas, black rounded tile, white Y.
 * Geometric paths (no font metrics) for perfect centering on every size.
 * Run: node scripts/generate-pwa-icons.mjs
 */
import sharp from "sharp";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const appIcon = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "app", "icon.png");

const COLORS = {
  canvas: "#ffffff",
  tile: "#111111",
  mark: "#ffffff",
  maskCanvas: "#111111",
};

/** Filled Y letter — optically centered in a square of side `box`. */
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
  const pad = maskable ? Math.round(size * 0.12) : 0;
  const inner = size - pad * 2;
  const tileRatio = maskable ? 0.58 : 0.625;
  const tile = Math.round(inner * tileRatio);
  const tileX = pad + (inner - tile) / 2;
  const tileY = pad + (inner - tile) / 2;
  const radius = Math.round(tile * 0.25);
  const bg = maskable ? COLORS.maskCanvas : COLORS.canvas;
  const mark = maskable ? COLORS.mark : COLORS.mark;
  const tileFill = maskable ? COLORS.tile : COLORS.tile;

  const tileRect =
    maskable
      ? ""
      : `<rect x="${tileX}" y="${tileY}" width="${tile}" height="${tile}" rx="${radius}" fill="${tileFill}"/>`;

  const markBox = maskable ? inner * 0.52 : tile;
  const markX = maskable ? pad + (inner - markBox) / 2 : tileX;
  const markY = maskable ? pad + (inner - markBox) / 2 : tileY;

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${bg}"/>
  ${tileRect}
  <svg x="${markX}" y="${markY}" width="${markBox}" height="${markBox}" viewBox="0 0 ${markBox} ${markBox}">
    <path d="${yMarkPath(markBox)}" fill="${mark}"/>
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

const faviconPng = await sharp(iconSvg(32)).png().toBuffer();
writeFileSync(join(root, "favicon.ico"), faviconPng);
console.log("wrote favicon.ico");

await sharp(iconSvg(512)).png({ compressionLevel: 9 }).toFile(appIcon);
console.log("wrote src/app/icon.png");
