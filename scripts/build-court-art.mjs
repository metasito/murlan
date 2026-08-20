// Regenerates assets/images/cards/ — the twelve court figures drawn on J/Q/K.
//
//   node scripts/build-court-art.mjs
//
// Source: Byron Knoll's "Vector Playing Cards", public domain, mirrored at
// github.com/hayeah/playing-cards-assets. Downloaded on demand rather than
// vendored: the SVGs are ~7.5 MB and only the rendered PNGs are shipped.
//
// The source cards carry their own border and index corners; this app draws
// those itself, so they are cropped away. The crop is done in pixels after
// rendering — rewriting the SVG viewBox does not clip reliably, because an SVG
// root does not hide content outside its viewBox in every renderer.
//
// COURT_ART_BOX in components/cardFaceModel.ts must stay equal to CROP below:
// the source deck and this app's card have the same aspect ratio (0.688 vs
// 0.690), so placing the art at the fractions it was cut from reproduces a real
// card's proportions instead of approximating them.
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "assets", "images", "cards");
const BASE =
  "https://raw.githubusercontent.com/hayeah/playing-cards-assets/master/svg-cards";

// Keep in step with COURT_ART_BOX in components/cardFaceModel.ts.
const CROP = { x0: 0.305, x1: 0.695, y0: 0.105, y1: 0.895 };

// The card is 58pt wide and the art spans 0.39 of that — about 23pt. Rendering
// the crop at 82px is roughly 3.6x, so it stays sharp on a 3x screen without
// shipping detail no one can see.
const RENDER_W = 210;

const RANKS = { jack: "jack", queen: "queen", king: "king" };
const SUITS = ["clubs", "diamonds", "hearts", "spades"];
const NAMES = Object.values(RANKS).flatMap((r) => SUITS.map((s) => `${r}_of_${s}`));

const tmp = mkdtempSync(path.join(tmpdir(), "murlan-cards-"));
mkdirSync(OUT, { recursive: true });

try {
  for (const name of NAMES) {
    const res = await fetch(`${BASE}/${name}.svg`);
    if (!res.ok) throw new Error(`${name}.svg: HTTP ${res.status}`);
    writeFileSync(path.join(tmp, `${name}.svg`), await res.text());
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });

  for (const name of NAMES) {
    const svg = readFileSync(path.join(tmp, `${name}.svg`), "utf8");
    const [, , vw, vh] = /viewBox="([\d.\-\s]+)"/
      .exec(svg)[1]
      .trim()
      .split(/\s+/)
      .map(Number);
    const renderH = Math.round((RENDER_W * vh) / vw);

    await page.setViewportSize({ width: RENDER_W, height: renderH });
    await page.setContent(
      `<!doctype html><style>
         html,body{margin:0;padding:0;background:transparent}
         #wrap{width:${RENDER_W}px;height:${renderH}px}
         #wrap svg{display:block;width:${RENDER_W}px;height:${renderH}px}
       </style><div id="wrap">${svg}</div>`
    );
    await page.waitForTimeout(150);

    const buf = await page.screenshot({
      omitBackground: true,
      clip: {
        x: Math.round(RENDER_W * CROP.x0),
        y: Math.round(renderH * CROP.y0),
        width: Math.round(RENDER_W * (CROP.x1 - CROP.x0)),
        height: Math.round(renderH * (CROP.y1 - CROP.y0)),
      },
    });
    writeFileSync(path.join(OUT, `${name}.png`), buf);
    console.log(`${name}.png  ${(buf.length / 1024).toFixed(1)} KB`);
  }

  await browser.close();

  // Chromium writes a deflate stream tuned for encoding speed; recompressing
  // recovers a third of what it emits, so the sizes below are the ones shipped.
  const { status, error } = spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts", "optimize-images.mjs"), OUT],
    { stdio: "inherit" }
  );
  if (status !== 0) {
    throw new Error(`optimize-images.mjs did not run (${error?.message ?? `exit ${status}`})`);
  }

  const total = NAMES.reduce((sum, n) => sum + statSync(path.join(OUT, `${n}.png`)).size, 0);
  console.log(`\n${NAMES.length} files, ${(total / 1024).toFixed(0)} KB total`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
