// The named regions tests/e2e/helpers/mockupParity.ts reads brightness from, in table points of the
// 874 × 402 table: the pool and the pile on each side's own layout, the rest on the mockup's #score and rail.
import type { Page } from "@playwright/test";

export const TABLE = { width: 874, height: 402 };

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Point = { x: number; y: number };

/** Where one side laid out what its regions sit on, in table points; the viewer is the seat on move. */
export interface SideLayout {
  pile: Point;
  light: Point;
  /** The highest edge of any card in the viewer's hand. */
  handTop: number;
}

/** The mockup's `.card` box-shadow blurs 10 pt above the hand. */
const HAND_SHADOW = 10;

export function regionsFor({ pile, light, handTop }: SideLayout): Record<string, Region> {
  return {
    // The light hangs over the hand, so its pool's nearest open felt is straight up from it, past the hand's shadow.
    pool: { x: light.x - 20, y: handTop - HAND_SHADOW - 8, w: 40, h: 8 },
    rim: { x: 64, y: 180, w: 8, h: 40 },
    rightBand: { x: 640, y: 150, w: 60, h: 100 },
    pile: { x: pile.x - 30, y: pile.y - 20, w: 60, h: 40 },
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
