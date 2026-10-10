// Bakes the card backs, their foil masks and the face's plastic stock into assets/images/cards/.
//
//   node scripts/bake-card-art.mjs [outDir]
//
// The drawing is the-lantern-table mockup's `backURL`, plus felt-and-card-materials' grain and foil
// (origin/research/lantern-assets). CanvasKit's wasm raster and WebP encoder are the same bytes on
// every OS, which tests/tooling/cardArt.test.ts relies on; a browser canvas is not.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { CardBacks, CardFaceGradient, CardGloss } from "../lib/tokens.ts";
import { CARD_BACK_H, CARD_BACK_W, CARD_H, CARD_W } from "../components/cardFaceModel.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(process.argv[2] ?? path.join(repoRoot, "assets", "images", "cards"));

// @1x covers a card drawn at up to twice the table's base scale.
const BASE_SCALE = 2;
const DENSITIES = [["", 1], ["@2x", 2], ["@3x", 3]];
const QUALITY = 90;
const GRAIN = 4;

const skiaRequire = createRequire(createRequire(import.meta.url).resolve("@shopify/react-native-skia/package.json"));
const CanvasKitInit = skiaRequire("canvaskit-wasm/bin/full/canvaskit.js");
const CK = await CanvasKitInit({ locateFile: (f) => skiaRequire.resolve(`canvaskit-wasm/bin/full/${f}`) });

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const shade = (hex, k) => rgb(hex).map((v) => Math.min(255, Math.round(v * (1 - k))));
const color = ([r, g, b], a = 1) => CK.Color(r, g, b, a);
const f = (n) => n.toFixed(1);

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function starPath(cx, cy, r, n) {
  const ri = r * (n <= 4 ? 0.36 : 0.46);
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const q = i % 2 ? ri : r;
    pts.push(`${f(cx + Math.cos(a) * q)} ${f(cy + Math.sin(a) * q)}`);
  }
  return `M${pts.join("L")}Z`;
}

function paint(style, rgba, width = 0) {
  const p = new CK.Paint();
  p.setAntiAlias(true);
  p.setStyle(style === "stroke" ? CK.PaintStyle.Stroke : CK.PaintStyle.Fill);
  p.setColor(rgba);
  if (width) p.setStrokeWidth(width);
  return p;
}

function render(w, h, draw, grain) {
  const surface = CK.MakeSurface(w, h);
  const canvas = surface.getCanvas();
  canvas.clear(CK.TRANSPARENT);
  draw(canvas, w, h);
  const snap = surface.makeImageSnapshot();
  let image = snap;
  if (grain) {
    const info = { width: w, height: h, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB };
    const px = snap.readPixels(0, 0, info);
    const next = mulberry32(3);
    for (let i = 0; i < px.length; i += 4) {
      if (!px[i + 3]) continue;
      const v = (next() - 0.5) * grain;
      for (let c = 0; c < 3; c++) px[i + c] = Math.max(0, Math.min(255, Math.round(px[i + c] + v)));
    }
    image = CK.MakeImage(info, px, w * 4);
  }
  const bytes = image.encodeToBytes(CK.ImageFormat.WEBP, QUALITY);
  if (image !== snap) image.delete();
  snap.delete();
  surface.delete();
  return bytes;
}

function backGeometry(spec, ww, hh) {
  const m = ww * 0.12;
  const iw = ww - 2 * m;
  const ih = hh - 2 * m;
  const st = ih / spec.lattice;
  let lattice = "";
  for (let k = -ih; k < iw + ih; k += st) {
    const x = m + k;
    lattice += `M${f(x)} ${f(m)}L${f(x - ih)} ${f(m + ih)}M${f(x - ih)} ${f(m)}L${f(x)} ${f(m + ih)}`;
  }
  return {
    lw: ww * 0.018,
    frame: CK.RRectXY(CK.XYWHRect(m, m, iw, ih), ww * 0.05, ww * 0.05),
    lattice: CK.Path.MakeFromSVGString(lattice),
    star: CK.Path.MakeFromSVGString(starPath(ww / 2, hh / 2, ww * 0.19, spec.starPoints)),
    disc: [ww / 2, hh / 2, ww * 0.19 * 1.15],
  };
}

function drawBack(spec) {
  return (canvas, ww, hh) => {
    const g = backGeometry(spec, ww, hh);
    const field = new CK.Paint();
    field.setShader(CK.Shader.MakeRadialGradient(
      [ww / 2, hh / 2], Math.hypot(ww, hh) / 2, spec.field.map((c) => color(rgb(c))), [0, 0.25, 0.5, 0.75, 1], CK.TileMode.Clamp,
    ));
    canvas.drawRect(CK.XYWHRect(0, 0, ww, hh), field);
    canvas.save();
    canvas.clipRRect(g.frame, CK.ClipOp.Intersect, true);
    if (spec.emboss) {
      for (const [d, ink] of [[0.6, color([0, 0, 0], 0.6)], [-0.6, color([255, 236, 210], 0.16)]]) {
        canvas.save();
        canvas.translate(g.lw * d, g.lw * d);
        canvas.drawPath(g.lattice, paint("stroke", ink, g.lw));
        canvas.restore();
      }
    } else {
      canvas.drawPath(g.lattice, paint("stroke", color(shade(spec.ink, 0.3)), g.lw));
    }
    canvas.restore();
    const edge = spec.emboss ? color([0, 0, 0], 0.55) : color(shade(spec.ink, 0.3));
    canvas.drawRRect(g.frame, paint("stroke", edge, g.lw * 1.3));
    canvas.drawCircle(...g.disc, paint("fill", color(rgb(spec.field[4]))));
    canvas.drawPath(g.star, paint("fill", color(shade(spec.ink, 0.12))));
  };
}

function drawFoil(spec) {
  return (canvas, ww, hh) => {
    const g = backGeometry(spec, ww, hh);
    const white = color([255, 255, 255]);
    if (!spec.emboss) {
      canvas.save();
      canvas.clipRRect(g.frame, CK.ClipOp.Intersect, true);
      canvas.drawPath(g.lattice, paint("stroke", white, g.lw));
      canvas.restore();
      canvas.drawRRect(g.frame, paint("stroke", white, g.lw * 1.3));
    }
    canvas.drawPath(g.star, paint("fill", white));
  };
}

function drawStock(canvas, w, h) {
  const p = new CK.Paint();
  p.setShader(CK.Shader.MakeLinearGradient(
    [0.1 * w, 0], [0.9 * w, h], CardFaceGradient.map((c) => color(rgb(c))), [0, 0.55, 1], CK.TileMode.Clamp,
  ));
  canvas.drawRect(CK.XYWHRect(0, 0, w, h), p);
}

// At full alpha: the overlay's opacity carries the mockup's `.3·L`, so the mid stop is `.1 / .3` of it.
function drawGlossSpot(canvas, w) {
  const { spot } = CardGloss;
  const mid = spot.mid.alpha / spot.alpha;
  const p = new CK.Paint();
  p.setShader(CK.Shader.MakeRadialGradient(
    [w / 2, w / 2], w / 2,
    [color(rgb(spot.color)), color(rgb(spot.mid.color), mid), color(rgb(spot.mid.color), 0)],
    [0, spot.mid.at, 1], CK.TileMode.Clamp, undefined, 1,
  ));
  canvas.drawRect(CK.XYWHRect(0, 0, w, w), p);
}

const jobs = [
  ...Object.entries(CardBacks).flatMap(([id, spec]) => [
    [`back_${id}`, CARD_BACK_W(BASE_SCALE), CARD_BACK_H(BASE_SCALE), drawBack(spec), GRAIN],
    [`foil_${id}`, CARD_BACK_W(BASE_SCALE), CARD_BACK_H(BASE_SCALE), drawFoil(spec), 0],
  ]),
  ["stock", CARD_W(BASE_SCALE), CARD_H(BASE_SCALE), drawStock, GRAIN],
  ["gloss_spot", 2 * CardGloss.spot.radius * BASE_SCALE, 2 * CardGloss.spot.radius * BASE_SCALE, drawGlossSpot, 0],
];

mkdirSync(outDir, { recursive: true });
for (const [name, w, h, draw, grain] of jobs) {
  for (const [suffix, density] of DENSITIES) {
    writeFileSync(path.join(outDir, `${name}${suffix}.webp`), render(w * density, h * density, draw, grain));
  }
}
