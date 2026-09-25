// The named regions tests/e2e/helpers/mockupParity.ts reads brightness from, in table points of the
// 874 × 402 table, placed on the Lantern Table mockup's own geometry (its POOL, PILE and #score).
import type { Page } from "@playwright/test";

export const TABLE = { width: 874, height: 402 };

export type Seat = "you" | "luan" | "besnik" | "gent";

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

const POOL: Record<Seat, [number, number]> = {
  you: [457, 292],
  luan: [712, 196],
  besnik: [457, 116],
  gent: [202, 196],
};

export function regionsFor(seatOnMove: Seat): Record<string, Region> {
  const [px, py] = POOL[seatOnMove];
  return {
    // Between the mockup's pile chip and the hand's shadow, which cross the pool at `you`.
    pool: { x: px - 20, y: py - 2, w: 40, h: 8 },
    rim: { x: 64, y: 180, w: 8, h: 40 },
    rightBand: { x: 640, y: 150, w: 60, h: 100 },
    pile: { x: 427, y: 202, w: 60, h: 40 },
    scorePill: { x: 740, y: 16, w: 90, h: 18 },
  };
}

/** Mean Rec. 601 luma of each region of a frame, 0–255, decoded on `decoder` — a page with no clock of its own. */
export async function regionBrightness(
  decoder: Page,
  jpeg: Buffer,
  dpr: number,
  regions: Record<string, Region>
): Promise<Record<string, number>> {
  return decoder.evaluate(
    async ({ src, dpr, regions }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = new OffscreenCanvas(img.width, img.height);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const out: Record<string, number> = {};
      for (const [name, r] of Object.entries(regions)) {
        const { data } = ctx.getImageData(r.x * dpr, r.y * dpr, r.w * dpr, r.h * dpr);
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        out[name] = sum / (data.length / 4);
      }
      return out;
    },
    { src: `data:image/jpeg;base64,${jpeg.toString("base64")}`, dpr, regions }
  );
}
