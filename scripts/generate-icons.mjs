// Regenerates every home-screen icon PNG (public/icons/) from one inline
// SVG source, via a headless Chromium screenshot rather than an image
// library. Keeps this script dependency-free (Playwright's already a
// devDependency for e2e) at the cost of needing a browser to run it.
//
// Three purposes, per the W3C manifest icon spec and Android's adaptive/
// themed-icon rules:
//   - "any": a plain full-bleed square. Platforms that don't apply their
//     own mask (desktop browsers, iOS's home screen) show this as-is.
//   - "maskable": also full-bleed (the background must reach every edge;
//     Android crops it to whichever shape the launcher uses), but the
//     glyph itself is kept inside the "safe zone": a circle 80% of the
//     icon's width, centered, the largest area every mask shape leaves
//     unclipped. Getting this wrong means Android launchers cut off the
//     glyph.
//   - "monochrome": Android 13+'s themed-icon layer. Only the alpha
//     channel is used (the OS recolors it to match the wallpaper/theme),
//     so this is the glyph alone, opaque black, on a transparent ground
//     (this is the "grayscale option" adaptive icons need).
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

const ACCENT = "#2563eb"; // matches --accent in style.css
const CREAM = "#fcfcfb"; // matches --stats-surface (light) in style.css

// The "x" glyph: two rounded bars crossing at 45°/-45°, sized so the
// whole glyph's bounding diagonal sits inside the 80%-diameter safe-zone
// circle used by the maskable variants.
function glyphSvg(size, { background, glyphColor, transparent }) {
  const barLength = size * 0.5;
  const barThickness = size * 0.14;
  const radius = barThickness / 2;
  const cx = size / 2;
  const cy = size / 2;
  const bg = transparent ? "" : `<rect width="${size}" height="${size}" fill="${background}" />`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${bg}
    <g fill="${glyphColor}">
      <rect x="${cx - barLength / 2}" y="${cy - barThickness / 2}" width="${barLength}" height="${barThickness}" rx="${radius}" transform="rotate(45 ${cx} ${cy})" />
      <rect x="${cx - barLength / 2}" y="${cy - barThickness / 2}" width="${barLength}" height="${barThickness}" rx="${radius}" transform="rotate(-45 ${cx} ${cy})" />
    </g>
  </svg>`;
}

const targets = [
  // purpose "any": plain square, shown as-is on platforms with no masking.
  { file: "icon-any-192.png", size: 192, background: ACCENT, glyphColor: CREAM, transparent: false },
  { file: "icon-any-512.png", size: 512, background: ACCENT, glyphColor: CREAM, transparent: false },
  // purpose "maskable": same art (already safe-zone-aware); a separate
  // file per the manifest spec's per-purpose sizing, not because the
  // pixels differ from "any" here.
  { file: "icon-maskable-192.png", size: 192, background: ACCENT, glyphColor: CREAM, transparent: false },
  { file: "icon-maskable-512.png", size: 512, background: ACCENT, glyphColor: CREAM, transparent: false },
  // purpose "monochrome": Android 13+ themed icon, alpha-only glyph.
  { file: "icon-monochrome-192.png", size: 192, background: "none", glyphColor: "#000000", transparent: true },
  { file: "icon-monochrome-512.png", size: 512, background: "none", glyphColor: "#000000", transparent: true },
  // iOS home screen (no OS masking to rely on; iOS rounds it itself).
  { file: "apple-touch-icon-180.png", size: 180, background: ACCENT, glyphColor: CREAM, transparent: false },
  // Browser tab favicon.
  { file: "favicon-48.png", size: 48, background: ACCENT, glyphColor: CREAM, transparent: false },
];

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });

for (const target of targets) {
  const svg = glyphSvg(target.size, target);
  await page.setViewportSize({ width: target.size, height: target.size });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;padding:0;">${svg}</body></html>`,
  );
  const buffer = await page.screenshot({ omitBackground: target.transparent });
  await writeFile(path.join(outDir, target.file), buffer);
  console.log("wrote", target.file);
}

await browser.close();
