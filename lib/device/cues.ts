export type CueSound =
  | "select"
  | "deselect"
  | "play"
  | "combo"
  | "pass"
  | "bomb"
  | "deal"
  | "exchange"
  | "turn"
  | "clockRunningOut"
  | "mancheWon"
  | "mancheLost"
  | "partitaWon"
  | "partitaLost"
  | "reconnected"
  | "reject";

export type HapticHelper =
  | "hapticSelection"
  | "hapticLight"
  | "hapticMedium"
  | "hapticHeavy"
  | "hapticRigid"
  | "hapticSuccess"
  | "hapticWarn";

export type Moment =
  | { kind: "landing"; cards: number; bomb: boolean; mine: boolean }
  | { kind: "mancheOver" | "partitaOver"; won: boolean }
  | {
      kind:
        | "select"
        | "deselect"
        | "reject"
        | "give"
        | "pass"
        | "deal"
        | "exchange"
        | "turn"
        | "clockRunningOut"
        | "reconnected";
    };

export interface Cue {
  sound: CueSound;
  /** `atMs` is from the sound's onset, and may be negative. */
  haptics: { helper: HapticHelper; atMs: number }[];
}

export const isCombo = (cards: number): boolean => cards > 1;

// The bomb's second and third pulses land on the table kick's first two jolt stops
// (`KICK_JOLTS` in components/useTableFeedback.ts).
const BOMB_PULSES: Cue["haptics"] = [
  { helper: "hapticRigid", atMs: 0 },
  { helper: "hapticHeavy", atMs: 256 },
  { helper: "hapticLight", atMs: 416 },
];
const PARTITA_LEAD_MS = -300;

const tap = (helper: HapticHelper): Cue["haptics"] => [{ helper, atMs: 0 }];

export function cueFor(moment: Moment): Cue {
  switch (moment.kind) {
    case "landing": {
      if (moment.bomb) return { sound: "bomb", haptics: BOMB_PULSES };
      const combo = isCombo(moment.cards);
      return {
        sound: combo ? "combo" : "play",
        haptics: moment.mine ? tap(combo ? "hapticMedium" : "hapticLight") : [],
      };
    }
    case "mancheOver":
      return moment.won
        ? { sound: "mancheWon", haptics: tap("hapticSuccess") }
        : { sound: "mancheLost", haptics: tap("hapticWarn") };
    case "partitaOver":
      return {
        sound: moment.won ? "partitaWon" : "partitaLost",
        haptics: [
          { helper: "hapticMedium", atMs: PARTITA_LEAD_MS },
          { helper: moment.won ? "hapticSuccess" : "hapticWarn", atMs: 0 },
        ],
      };
    case "select":
    case "deselect":
      return { sound: moment.kind, haptics: tap("hapticSelection") };
    case "reject":
      return { sound: "reject", haptics: tap("hapticRigid") };
    case "give":
      return { sound: "play", haptics: tap("hapticMedium") };
    case "turn":
      return { sound: "turn", haptics: tap("hapticLight") };
    case "pass":
    case "deal":
    case "exchange":
    case "clockRunningOut":
    case "reconnected":
      return { sound: moment.kind, haptics: [] };
  }
}
