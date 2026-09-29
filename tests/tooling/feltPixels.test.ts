import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, deflateSync } from "node:zlib";
import { decodePng, feltVerdict } from "../../tools/ci/feltPixels.mjs";

const W = 40;
const H = 24;
const FELT = [22, 64, 44];
const ROOM = [4, 6, 5];

type Paint = (x: number, y: number) => number[];

function rgba(paint: Paint): Uint8Array {
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y += 1)
    for (let x = 0; x < W; x += 1) data.set([...paint(x, y), 255], (y * W + x) * 4);
  return data;
}

const felt: Paint = (x, y) => (x === 0 || y === H - 1 ? ROOM : FELT.map((c, i) => c + ((x * 7 + y * 3 + i) % 11)));

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])));
  return Buffer.concat([head, body, crc]);
}

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c;
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

function encodePng(data: Uint8Array, filter: (y: number) => number, channels = 4): Buffer {
  const stride = W * channels;
  const px = (y: number, i: number) =>
    y < 0 || i < 0 ? 0 : data[(y * W + Math.floor(i / channels)) * 4 + (i % channels)];
  const rows: number[] = [];
  for (let y = 0; y < H; y += 1) {
    const f = filter(y);
    rows.push(f);
    for (let i = 0; i < stride; i += 1) {
      const [x, a, b, c] = [px(y, i), px(y, i - channels), px(y - 1, i), px(y - 1, i - channels)];
      const predicted = [0, a, b, (a + b) >> 1, paeth(a, b, c)][f];
      rows.push((x - predicted) & 0xff);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr.set([8, channels === 4 ? 6 : 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("each PNG row filter decodes to the pixels it encoded", () => {
  const data = rgba(felt);
  for (const f of [0, 1, 2, 3, 4]) {
    const image = decodePng(encodePng(data, () => f));
    assert.deepEqual([image.width, image.height], [W, H]);
    assert.deepEqual(image.data, data, `filter ${f}`);
  }
  assert.deepEqual(decodePng(encodePng(data, (y) => y % 5)).data, data, "mixed filters");
  assert.deepEqual(decodePng(encodePng(data, (y) => y % 5, 3)).data, data, "RGB without alpha");
});

test("the felt passes, its near-black room included", () => {
  assert.equal(feltVerdict(decodePng(encodePng(rgba(felt), () => 0))).pass, true);
});

test("a black band along the top fails", () => {
  const banded: Paint = (x, y) => (y < 3 ? [0, 0, 0] : felt(x, y));
  const verdict = feltVerdict(decodePng(encodePng(rgba(banded), () => 1)));
  assert.equal(verdict.pass, false);
  assert.deepEqual(verdict.bands, ["top"]);
});

test("a black band along the right fails", () => {
  const banded: Paint = (x, y) => (x >= W - 2 ? [0, 0, 0] : felt(x, y));
  assert.deepEqual(feltVerdict(decodePng(encodePng(rgba(banded), () => 2))).bands, ["right"]);
});

test("black over 5 % of the frame fails with no band", () => {
  const spotted: Paint = (x, y) => (x > 10 && x < 15 && y > 5 && y < 20 ? [0, 0, 0] : felt(x, y));
  const verdict = feltVerdict(decodePng(encodePng(rgba(spotted), () => 4)));
  assert.deepEqual(verdict.bands, []);
  assert.ok(verdict.black > 0.05, String(verdict.black));
  assert.equal(verdict.pass, false);
});
