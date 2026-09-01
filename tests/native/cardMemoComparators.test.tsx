// tests/native/cardMemoComparators.test.tsx — a hand-rolled memo comparator
// that skips a prop makes the card ignore it for the rest of the hand.
//
// The props are read out of the source because TypeScript has none of them at
// runtime, and then the comparator is *driven* rather than read: a scan for
// `a.<key>` passes on a comparison that is present and wrong.
import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";

import { cardViewPropsEqual } from "@/components/CardView";
import { cardItemPropsEqual } from "@/components/table/hand";

const repoRoot = path.resolve(__dirname, "..", "..");

/** The declared property names of one interface, in source order. */
function propsOf(file: string, name: string): string[] {
  const source = readFileSync(path.join(repoRoot, file), "utf8");
  const body = new RegExp(String.raw`^interface ${name} \{$([\s\S]*?)^\}$`, "m").exec(source);
  if (!body) throw new Error(`${name} not found in ${file}`);
  return [...body[1].matchAll(/^ {2}([a-zA-Z0-9]+)\??:/gm)].map((m) => m[1]);
}

/**
 * Two values per prop that must read as different. Written out rather than
 * generated so that adding prop 22 fails here, naming the prop, instead of
 * being quietly skipped.
 */
const CARD_A = { id: "3_spades", rank: "3", suit: "spades" };
const CARD_B = { id: "4_hearts", rank: "4", suit: "hearts" };
const noop = () => {};

const VALUES: Record<string, [unknown, unknown]> = {
  card: [CARD_A, CARD_B],
  selected: [false, true],
  isSelected: [false, true],
  onPress: [noop, () => {}],
  scale: [1, 2],
  cardScale: [1, 2],
  compact: [false, true],
  faceDown: [false, true],
  backId: ["classic", "lantern"],
  disabled: [false, true],
  style: [{ a: 1 }, { a: 1 }],
  noLift: [false, true],
  hitWidth: [40, 90],
  hitW: [40, 90],
  decorative: [false, true],
  hint: ["give this card", "play this card"],
  light: ["standing", "flat"],
  a11yActions: [[{ name: "left" }], [{ name: "right" }]],
  onA11yAction: [noop, () => {}],
  a11yActionKeys: [{ ArrowLeft: "left" }, { ArrowRight: "right" }],
  onMove: [noop, () => {}],
  left: [0, 10],
  bottom: [0, 10],
  arcRot: [0, 10],
  zIndex: [0, 10],
  giveable: [false, true],
  dealDelay: [0, 120],
  dealFromX: [0, 120],
  dealFade: [false, true],
  dealRise: [0, 120],
  cardW: [64, 92],
  cardH: [90, 128],
  shiftX: [0, 24],
};

/**
 * Props a comparator may leave out, and why. An exemption is a claim about the
 * component, so it is written here where it can be read, rather than being the
 * absence of a line in the comparator.
 */
const EXEMPT: Record<string, Record<string, string>> = {
  cardItemPropsEqual: {
    dealDelay:
      "the deal reads it once at mount (dealDelayRef), so a later change must " +
      "not restart a card that is already in flight",
  },
  cardViewPropsEqual: {},
};

const SUBJECTS = [
  {
    name: "cardViewPropsEqual",
    equal: cardViewPropsEqual as (a: object, b: object) => boolean,
    file: "components/CardView.tsx",
    type: "CardViewProps",
  },
  {
    name: "cardItemPropsEqual",
    equal: cardItemPropsEqual as (a: object, b: object) => boolean,
    file: "components/table/hand.tsx",
    type: "CardItemProps",
  },
];

describe.each(SUBJECTS)("$name compares every prop it is given", ({ name, equal, file, type }) => {
  const keys = propsOf(file, type);
  const exempt = EXEMPT[name];

  const base = Object.fromEntries(keys.map((k) => [k, VALUES[k]?.[0]]));

  it("has a value pair for every declared prop", () => {
    const missing = keys.filter((k) => !VALUES[k]);
    expect(missing).toEqual([]);
  });

  it("says two identical prop sets are identical", () => {
    expect(equal(base, { ...base })).toBe(true);
  });

  it.each(keys.filter((k) => !exempt[k]))("notices a change to %s", (key) => {
    const changed = { ...base, [key]: VALUES[key][1] };
    expect(equal(base, changed)).toBe(false);
  });

  it("exempts only props that are still declared", () => {
    const stale = Object.keys(exempt).filter((k) => !keys.includes(k));
    expect(stale).toEqual([]);
  });

  // The floor: `propsOf` returning nothing would make every assertion above
  // pass on an empty list.
  it("read the props out of the source", () => {
    expect(keys.length).toBeGreaterThan(10);
    expect(keys).toContain("card");
  });
});
