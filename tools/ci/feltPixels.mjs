/**
 * Fails a simulator screenshot of the table where an opaque felt layer shows black: a band along
 * an edge (a drawable that no longer matches its layer), or black over 5 % of the frame.
 * Usage: node tools/ci/feltPixels.mjs <png>...
 */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

/** The room around the felt is #040605, so black is stricter than "dark". */
const BLACK_MAX = 2;
const BLACK_SHARE = 0.05;
const BAND_PX = 2;
const BAND_SHARE = 0.5;

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

export function decodePng(buffer) {
  let offset = 8;
  let header = null;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") header = body;
    if (type === "IDAT") idat.push(body);
    if (type === "IEND") break;
    offset += 12 + length;
  }
  if (!header) throw new Error("no IHDR");
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const [depth, colour, , , interlace] = header.subarray(8);
  const channels = { 2: 3, 6: 4 }[colour];
  if (depth !== 8 || !channels || interlace !== 0) {
    throw new Error(`unsupported PNG: depth ${depth}, colour type ${colour}, interlace ${interlace}`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? rows[y * stride + i - channels] : 0;
      const b = y > 0 ? rows[(y - 1) * stride + i] : 0;
      const c = y > 0 && i >= channels ? rows[(y - 1) * stride + i - channels] : 0;
      const predicted = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
      if (predicted === undefined) throw new Error(`row ${y}: unknown filter ${filter}`);
      rows[y * stride + i] = (src[i] + predicted) & 0xff;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p += 1) {
    data.set(rows.subarray(p * channels, p * channels + 3), p * 4);
    data[p * 4 + 3] = channels === 4 ? rows[p * channels + 3] : 255;
  }
  return { width, height, data };
}

export function feltVerdict({ width, height, data }) {
  const isBlack = (x, y) => {
    const i = (y * width + x) * 4;
    return Math.max(data[i], data[i + 1], data[i + 2]) <= BLACK_MAX;
  };
  const share = (points) => points.filter(([x, y]) => isBlack(x, y)).length / points.length;
  const line = (length, at) => Array.from({ length }, (_, i) => at(i));
  const edges = {
    top: (d) => line(width, (x) => [x, d]),
    right: (d) => line(height, (y) => [width - 1 - d, y]),
    bottom: (d) => line(width, (x) => [x, height - 1 - d]),
    left: (d) => line(height, (y) => [d, y]),
  };
  const bands = Object.entries(edges)
    .filter(([, at]) => line(BAND_PX, at).every((points) => share(points) >= BAND_SHARE))
    .map(([edge]) => edge);
  let black = 0;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) black += isBlack(x, y) ? 1 : 0;
  black /= width * height;
  return { pass: bands.length === 0 && black <= BLACK_SHARE, bands, black };
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
    const { pass, bands, black } = feltVerdict(image);
    const summary = `${file}: ${image.width}x${image.height}, black ${(black * 100).toFixed(2)} %, bands [${bands.join(", ")}]`;
    console.log(pass ? summary : `::error::${summary}`);
    failed ||= !pass;
  }
  process.exit(failed ? 1 : 0);
}
