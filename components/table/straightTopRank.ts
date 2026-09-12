// A straight's top card as a rank character, for the spoken label. Its own `.ts`
// beside `spokenLabels.ts`, which resolves `@/` at runtime — see
// `components/flightPhysics.ts`'s header.

const FACE_VALUE_RANK: Record<number, string> = {
  1: "A", 2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10",
  11: "J", 12: "Q", 13: "K", 14: "A",
};

/**
 * Renders a straight's `Combination.strength` — already the correct
 * top-of-sequence face value, ace-high-vs-ace-low resolved by
 * `getStraightStrength` — back as a rank character, for the spoken top card.
 *
 * Taking `cards[cards.length - 1].rank` instead gets A-2-3-4-5 wrong: its top
 * card is 5.
 */
export function straightTopRankChar(strength: number): string {
  return FACE_VALUE_RANK[strength] ?? String(strength);
}
