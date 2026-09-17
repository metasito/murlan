// Design system entry point: re-exports the pure tokens and adds the
// platform-aware Shadow.
import { Platform } from "react-native";

import { Colors } from "./tokens";

export * from "./tokens";

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

/**
 * A hex colour at reduced opacity, as the `rgba()` string a View style prop
 * takes. SVG strokes/fills carry their own separate opacity attribute and
 * never need this — it exists for the props that don't.
 */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Exported because the table's shadows scale with the card, so they cannot be
// frozen into the `Shadow` map below.
export function makeShadow(
  color: string,
  offsetX: number,
  offsetY: number,
  opacity: number,
  radius: number,
  elevation: number
): Record<string, any> {
  return makeLayeredShadow([{ color, offsetX, offsetY, opacity, radius }], elevation);
}

export interface ShadowLayer {
  color: string;
  offsetX?: number;
  offsetY: number;
  opacity: number;
  radius: number;
}

/**
 * A card lying on cloth casts two shadows, and having only one is what makes it
 * read as a sticker: a tight near-offsetless **contact** shadow in the
 * millimetre where card meets felt, and a softer **cast** shadow thrown away
 * from it. Lifting the card moves them in opposite directions — the contact
 * weakens and spreads as the card leaves the cloth, the cast travels and
 * softens.
 *
 * `boxShadow` takes a list, on web and — since RN 0.76, under the New
 * Architecture this app enables — on native too, so both layers ride one prop
 * on one node rather than a wrapper view per shadow.
 */
export function makeLayeredShadow(layers: ShadowLayer[], elevation: number): Record<string, any> {
  // Android draws an outset `boxShadow` only from 9. Below it the prop is
  // ignored outright, so those devices keep the single-shadow props, carrying
  // the cast layer. There Android reads only `elevation`, so it is floored:
  // a caller passing 0 would otherwise get no shadow at all.
  const api = Number(Platform.Version);
  if (Platform.OS === "android" && Number.isFinite(api) && api < 28) {
    const cast = layers[layers.length - 1];
    return {
      shadowColor: cast.color,
      shadowOffset: { width: cast.offsetX ?? 0, height: cast.offsetY },
      shadowOpacity: cast.opacity,
      shadowRadius: cast.radius,
      elevation: Math.max(elevation, Math.ceil(cast.radius / 2)),
    };
  }
  return {
    boxShadow: layers
      .map(({ color, offsetX = 0, offsetY, opacity, radius }) =>
        `${offsetX}px ${offsetY}px ${radius}px ${withAlpha(color, opacity)}`)
      .join(", "),
  };
}

// Authored at scale 1, where the table's own shadows are quoted. The art
// direction measures them at 2x, so every distance here is half the figure on
// artboard A.
export const Shadow = {
  gold: makeShadow(Colors.gold, 0, 0, 0.6, 12, 10),
  dark: makeShadow('#000000', 0, 4, 0.5, 8, 8),
  goldSoft: makeShadow(Colors.gold, 0, 0, 0.55, 14, 8),
  raised: makeShadow('#000000', 0, 2, 0.4, 8, 10),
  overlay: makeShadow('#000000', 0, 8, 0.5, 32, 20),
  /** A card resting on the felt. */
  card: makeLayeredShadow(
    [
      { color: '#000000', offsetY: 0.5, opacity: 0.62, radius: 0.75 },
      { color: '#000000', offsetY: 2, opacity: 0.34, radius: 4.5 },
    ],
    3
  ),
  /** A card held above the cloth. */
  cardLifted: makeLayeredShadow(
    [
      { color: '#000000', offsetY: 1, opacity: 0.34, radius: 3 },
      { color: '#000000', offsetY: 6, opacity: 0.3, radius: 13 },
    ],
    14
  ),
  /** A card back — an opponent's fan resting on the felt, same contact+cast split as the face. */
  cardBack: makeLayeredShadow(
    [
      { color: '#000000', offsetY: 0.5, opacity: 0.7, radius: 1 },
      { color: '#000000', offsetY: 3, opacity: 0.36, radius: 6.5 },
    ],
    5
  ),
};
