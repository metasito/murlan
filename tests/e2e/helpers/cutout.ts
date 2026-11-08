/**
 * The vertical span a landscape cutout occupies: a bar on the short edge, centred, never the whole
 * column, which is the entire reason two knobs can share the column with it. An iPhone X's notch is
 * 209pt on a 390pt edge; the Dynamic Island is smaller, so the notch is the worst case.
 */
const CUTOUT_HEIGHT_SHARE = 209 / 390;

export function cutoutBand(viewportHeight: number): { top: number; bottom: number } {
  const h = viewportHeight * CUTOUT_HEIGHT_SHARE;
  return { top: (viewportHeight - h) / 2, bottom: (viewportHeight + h) / 2 };
}
