/**
 * Recompresses the PNGs under assets/images/ in place, losslessly.
 *
 *   node scripts/optimize-images.mjs [dir]
 *
 * The icon and splash come out of Canva and the court art out of Chromium;
 * both write a deflate stream tuned for encoding speed. oxipng searches the
 * filter and Zopfli combinations they skipped and recovers 462 KB of 3.08 MB
 * with every decoded pixel unchanged, colour type and alpha included.
 *
 * WebP or AVIF would recover far more and are closed: Expo's prebuild pipeline
 * (`@expo/image-utils` -> `jimp-compact`) cannot decode either — issue #31.
 *
 * The output is committed, as assets/sounds/ is, so a Replit deploy needs no
 * extra tooling; oxipng is fetched by npx at a pinned version rather than
 * declared, because nothing at run time or build time needs it. oxipng only
 * rewrites a file it made smaller, so re-running is a no-op.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OXIPNG = "oxipng@1.0.1";
const target = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, "assets", "images");

// `safe` keeps every chunk that changes how the image renders (gAMA, pHYs,
// sRGB, tRNS) and drops the rest, which on the Canva exports is 6.8 KB of
// editor metadata.
//
// One command string through a shell, not an argv array: npx is a .cmd on
// Windows and Node refuses to spawn one directly (EINVAL).
const { status } = spawnSync(
  `npx --yes ${OXIPNG} -o max -Z --strip safe -r "${target}"`,
  { stdio: "inherit", shell: true }
);

process.exit(status ?? 1);
