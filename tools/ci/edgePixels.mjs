/**
 * Fails a simulator screenshot of the table where rotated card edges are aliased: along each
 * straight, tilted run where a card meets the felt, the share of lines whose boundary pixels hold
 * an intermediate blend of the two. A staircase has none; an anti-aliased edge has most.
 * Usage: node tools/ci/edgePixels.mjs <png>...
 */
import { readFileSync } from "node:fs";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { decodePng } from "./feltPixels.mjs";

export const SOFT_MIN = 0.4;
const MIN_LINES = 100;
const RUN_MIN = 40;
const TRIM = 16;
const DRIFT_MIN = 2;
const GAP_MAX = 4;
const BLEND = [0.15, 0.85];
const [OTHER, CARD, FELT] = [0, 1, 2];

function classify([r, g, b]) {
  const [lo, hi] = [Math.min(r, g, b), Math.max(r, g, b)];
  if (lo >= 140 && hi - lo <= 48) return CARD;
  return r <= 40 && g >= r + 25 ? FELT : OTHER;
}

function transitions(lines, length, kindAt, step) {
  const runs = [];
  let open = [];
  for (let line = 0; line < lines; line += 1) {
    const next = [];
    for (let a = 0; a < length; a += 1) {
      if (kindAt(line, a) !== CARD) continue;
      for (let b = a + step; Math.abs(b - a) <= GAP_MAX + 1; b += step) {
        if (b + step < 0 || b + step >= length) break;
        const kind = kindAt(line, b);
        if (kind === CARD) break;
        if (kind !== FELT) continue;
        const point = { line, a, b };
        const run = open.find((r) => Math.abs(r.at(-1).b - b) <= 1 && !next.includes(r));
        if (run) run.push(point);
        else runs.push([point]);
        next.push(run ?? runs.at(-1));
        break;
      }
    }
    open = next;
  }
  return runs;
}

export function edgeVerdict({ width, height, data }) {
  const rgb = (x, y) => {
    const i = (y * width + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const kinds = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) kinds[y * width + x] = classify(rgb(x, y));
  const scans = [
    { lines: height, length: width, at: (line, i) => [i, line] },
    { lines: width, length: height, at: (line, i) => [line, i] },
  ];
  let lines = 0;
  let soft = 0;
  for (const { lines: count, length, at } of scans)
    for (const step of [1, -1]) {
      const kindAt = (line, i) => {
        const [x, y] = at(line, i);
        return kinds[y * width + x];
      };
      const colour = (line, i) => rgb(...at(line, i));
      for (const run of transitions(count, length, kindAt, step)) {
        const kept = run.slice(TRIM, -TRIM);
        const ends = kept.map(({ b }) => b);
        if (kept.length < RUN_MIN || Math.max(...ends) - Math.min(...ends) < DRIFT_MIN) continue;
        const card = [0, 1, 2].map((c) => kept.map(({ line, a }) => colour(line, a)[c]).sort((p, q) => p - q)[kept.length >> 1]);
        for (const { line, a, b } of kept) {
          const felt = colour(line, b + step);
          const span = card.map((c, i) => c - felt[i]);
          const norm = span.reduce((s, d) => s + d * d, 0);
          let blended = false;
          for (let i = a; i !== b + step; i += step) {
            const t = colour(line, i).reduce((s, c, k) => s + (c - felt[k]) * span[k], 0) / norm;
            blended ||= t >= BLEND[0] && t <= BLEND[1];
          }
          lines += 1;
          soft += blended ? 1 : 0;
        }
      }
    }
  const score = lines ? soft / lines : 0;
  return { pass: lines >= MIN_LINES && score >= SOFT_MIN, lines, score };
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("::error::no screenshots to read");
    process.exit(1);
  }
  let failed = false;
  for (const file of files) {
    const image = decodePng(readFileSync(file));
    const { pass, lines, score } = edgeVerdict(image);
    const summary = `${file}: ${image.width}x${image.height}, blended edge ${(score * 100).toFixed(1)} % of ${lines} lines (needs ${SOFT_MIN * 100} % of ${MIN_LINES})`;
    console.log(pass ? summary : `::error::${summary}`);
    failed ||= !pass;
  }
  process.exit(failed ? 1 : 0);
}
